const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const AuditLog = require("../models/AuditLog");
const BrokerSession = require("../models/BrokerSession");
const { sendWhatsapp } = require("./twilioService");
const { analyzeAndReply, draftHybridReplies } = require("./aiService");
const { maybeNotify } = require("./notificationService");
const { generateTranscript } = require("./transcriptService");

const locks = new Map();

async function withConversationLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(key, queued);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === queued) {
      locks.delete(key);
    }
  }
}

async function handleClientWebhook(payload, io) {
  const clientPhone = normalizePhone(payload.From);
  if (!clientPhone) {
    console.warn("[routing] ignored webhook without From", payload);
    return { ignored: "missing_phone" };
  }

  return withConversationLock(clientPhone, async () => {
    if (payload.MessageSid) {
      const duplicate = await Message.findOne({ twilioSid: payload.MessageSid });
      if (duplicate) {
        console.log("[routing] duplicate message ignored", {
          clientPhone,
          sid: payload.MessageSid
        });
        return { duplicate: true };
      }
    }

    const conversation = await getOrCreateConversation(clientPhone, payload.ProfileName, payload._teamId);
    const clientMessage = await Message.create({
      conversation: conversation._id,
      team: conversation.team,
      twilioSid: payload.MessageSid,
      sender: "client",
      source: "client",
      body: (payload.Body || "").trim() || mediaFallback(payload),
      mode: conversation.mode,
      status: "received"
    });

    conversation.lastMessageAt = new Date();
    conversation.lastClientMessageAt = new Date();
    conversation.unreadForBroker += 1;
    await conversation.save();

    io.to(`team:${conversation.team}`).emit("message:new", { conversation, message: clientMessage });
    io.to(`conversation:${conversation._id}`).emit("typing:client", { conversationId: conversation._id });

    console.log("[routing] client message stored", {
      conversationId: conversation._id.toString(),
      teamId: conversation.team?.toString(),
      clientPhone,
      mode: conversation.mode
    });

    return routeConversation({ conversation, clientMessage, io });
  });
}

async function routeConversation({ conversation, clientMessage, io }) {
  const recentMessages = await Message.find({ conversation: conversation._id }).sort({ createdAt: -1 }).limit(20);
  const orderedRecent = recentMessages.reverse();

  if (conversation.mode === "HUMAN") {
    await maybeAutoResume(conversation, io);
    io.to(`team:${conversation.team}`).emit("handoff:client_message", { conversation, message: clientMessage });
    return { routedTo: "broker" };
  }

  if (conversation.mode === "HYBRID") {
    const draft = await draftHybridReplies({ conversation, recentMessages: orderedRecent, clientMessage });
    await updateConversationAnalytics(conversation, draft);
    await saveSystemDraft(conversation, draft);
    await maybeNotify({ conversation, analysis: draft, clientMessage, io });
    io.to(`team:${conversation.team}`).emit("ai:draft", { conversation, draft });
    return { routedTo: "hybrid_draft" };
  }

  let analysis;
  try {
    analysis = await analyzeAndReply({ conversation, recentMessages: orderedRecent, clientMessage });
  } catch (error) {
    console.error("[routing] AI response failed, using fallback", {
      conversationId: conversation._id.toString(),
      error: error.message
    });
    analysis = fallbackAnalysis(clientMessage);
  }

  await updateConversationAnalytics(conversation, analysis);
  await maybeNotify({ conversation, analysis, clientMessage, io });

  if (conversation.mode === "SHADOW") {
    io.to(`team:${conversation.team}`).emit("ai:reasoning", { conversation, analysis });
  }

  if (analysis.reply) {
    const sid = await sendWhatsapp(conversation.team, conversation.clientPhone, analysis.reply);
    const aiMessage = await Message.create({
      conversation: conversation._id,
      team: conversation.team,
      twilioSid: sid,
      sender: "ai",
      source: "AI",
      body: analysis.reply,
      mode: conversation.mode,
      status: "sent",
      metadata: {
        aiConfidence: analysis.confidence,
        aiReasoning: analysis.summary,
        suggestedReplies: analysis.suggestedReplies,
        sentiment: analysis.sentiment,
        intent: analysis.intent,
        triggerReasons: analysis.triggerReasons
      }
    });
    io.to(`team:${conversation.team}`).emit("message:new", { conversation, message: aiMessage });
  }

  return { routedTo: "ai" };
}

async function brokerSendMessage({ conversationId, brokerId, body, io }) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  if (!["HUMAN", "HYBRID"].includes(conversation.mode)) {
    throw new Error("Broker can only send in HUMAN or HYBRID mode");
  }

  const sid = await sendWhatsapp(conversation.team, conversation.clientPhone, body);
  const message = await Message.create({
    conversation: conversation._id,
    team: conversation.team,
    twilioSid: sid,
    sender: "broker",
    source: "broker",
    body,
    mode: conversation.mode,
    status: "sent"
  });

  conversation.lastMessageAt = new Date();
  conversation.lastBrokerActivityAt = new Date();
  await conversation.save();

  await AuditLog.create({
    actor: brokerId,
    action: "broker_message_sent",
    conversation: conversation._id,
    metadata: { messageId: message._id }
  });

  io.to(`team:${conversation.team}`).emit("message:new", { conversation, message });
  return message;
}

async function setConversationMode({ conversationId, brokerId, mode, reason, io }) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const previousMode = conversation.mode;
  conversation.mode = mode;
  conversation.assignedBroker = brokerId || conversation.assignedBroker;
  conversation.lastBrokerActivityAt = new Date();

  if (mode === "HUMAN") {
    conversation.handoff.takenOverAt = new Date();
    conversation.handoff.reason = reason || "manual_takeover";
    conversation.handoff.autoResumeAt = new Date(Date.now() + 20 * 60 * 1000);
  }
  if (mode === "AI" && previousMode === "HUMAN") {
    conversation.handoff.releasedAt = new Date();
  }

  await conversation.save();
  await BrokerSession.create({
    broker: brokerId,
    conversation: conversation._id,
    mode: mode === "AI" ? "SHADOW" : mode,
    active: mode !== "AI",
    takeoverAt: mode === "HUMAN" ? new Date() : undefined
  });
  await AuditLog.create({
    actor: brokerId,
    action: "conversation_mode_changed",
    conversation: conversation._id,
    metadata: { from: previousMode, to: mode, reason }
  });

  if (mode === "HUMAN") {
    await generateTranscript(conversation, "broker_takeover");
  }

  io.to(`team:${conversation.team}`).emit("conversation:mode", { conversation });
  return conversation;
}

async function maybeAutoResume(conversation, io) {
  if (conversation.mode !== "HUMAN") {
    return;
  }
  const autoResumeAt = conversation.handoff?.autoResumeAt;
  if (autoResumeAt && new Date(autoResumeAt).getTime() < Date.now()) {
    conversation.mode = "AI";
    conversation.handoff.releasedAt = new Date();
    await conversation.save();
    io.to(`team:${conversation.team}`).emit("conversation:mode", { conversation });
  }
}

async function updateConversationAnalytics(conversation, analysis) {
  conversation.leadScore = analysis.leadScore;
  conversation.sentiment = analysis.sentiment;
  conversation.aiConfidence = analysis.confidence;
  conversation.conversionProbability = analysis.conversionProbability;
  conversation.summary = {
    text: analysis.summary,
    pendingQuestions: analysis.extracted?.pendingQuestions || [],
    lastGeneratedAt: new Date()
  };
  conversation.extracted = { ...conversation.extracted?.toObject?.(), ...analysis.extracted };
  conversation.tags = Array.from(new Set([...(conversation.tags || []), analysis.intent].filter(Boolean)));
  await conversation.save();
}

async function saveSystemDraft(conversation, draft) {
  return Message.create({
    conversation: conversation._id,
    team: conversation.team,
    sender: "system",
    source: "AI",
    body: draft.suggestedReplies.join("\n"),
    mode: "HYBRID",
    status: "queued",
    metadata: {
      aiConfidence: draft.confidence,
      aiReasoning: draft.summary,
      suggestedReplies: draft.suggestedReplies,
      sentiment: draft.sentiment,
      intent: draft.intent,
      triggerReasons: draft.triggerReasons
    }
  });
}

async function getOrCreateConversation(clientPhone, clientName, teamId) {
  const existing = await Conversation.findOne({ clientPhone });
  if (existing) {
    if (teamId && String(existing.team) !== String(teamId)) {
       existing.team = teamId;
       await existing.save();
    }
    return existing;
  }
  return Conversation.create({
    clientPhone,
    clientName,
    team: teamId,
    mode: "AI",
    status: "active"
  });
}

function normalizePhone(phone) {
  return String(phone || "").replace(/^whatsapp:/, "");
}

function mediaFallback(payload) {
  return Number(payload.NumMedia || 0) > 0 ? "[media message]" : "";
}

function fallbackAnalysis(clientMessage) {
  return {
    reply: "Thanks for your message. I am checking that for you and will continue shortly.",
    suggestedReplies: [],
    summary: `Fallback response used after AI failure. Last client message: ${clientMessage.body}`,
    sentiment: "neutral",
    intent: "medium",
    confidence: 20,
    leadScore: 0,
    conversionProbability: 0,
    extracted: {},
    triggerReasons: ["ai_failure_fallback"]
  };
}

module.exports = {
  handleClientWebhook,
  brokerSendMessage,
  setConversationMode
};
