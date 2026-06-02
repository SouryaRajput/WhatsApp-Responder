const axios = require("axios");
const Notification = require("../models/Notification");
const { sendWhatsapp } = require("./twilioService");
const { env } = require("../config/env");

const COOLDOWN_MS = 10 * 60 * 1000;

async function maybeNotify({ conversation, analysis, clientMessage, io }) {
  const triggers = buildTriggers(conversation, analysis, clientMessage);
  const notifications = [];

  for (const trigger of triggers) {
    const dedupeKey = `${conversation._id}:${trigger.type}`;
    const recent = await Notification.findOne({
      dedupeKey,
      createdAt: { $gte: new Date(Date.now() - COOLDOWN_MS) }
    });
    if (recent) {
      continue;
    }

    const notification = await Notification.create({
      conversation: conversation._id,
      type: trigger.type,
      title: trigger.title,
      body: trigger.body,
      priority: trigger.priority,
      channels: trigger.channels,
      dedupeKey
    });
    notifications.push(notification);
    io.to("brokers").emit("notification:new", notification);
    await deliverExternal(notification, conversation);
  }

  return notifications;
}

function buildTriggers(conversation, analysis, clientMessage) {
  const body = clientMessage.body.toLowerCase();
  const triggers = [];
  const extracted = {
    ...(conversation.extracted?.toObject?.() || conversation.extracted || {}),
    ...(analysis.extracted || {})
  };

  if (isQualificationReady(extracted)) {
    triggers.push(trigger("qualification_ready", "Lead preferences ready for broker", summarizePreferences(extracted), "high"));
  }
  if (analysis.leadScore >= 75 || analysis.intent === "high") {
    triggers.push(trigger("high_intent", "High-intent lead detected", `Lead score ${analysis.leadScore}`, "high"));
  }
  if (analysis.confidence < 40) {
    triggers.push(trigger("low_confidence", "AI confidence dropped below 40%", `Confidence ${analysis.confidence}%`, "medium"));
  }
  if (analysis.sentiment === "angry" || /\b(angry|frustrated|bad service|complaint)\b/.test(body)) {
    triggers.push(trigger("angry_customer", "Angry customer detected", clientMessage.body, "critical"));
  }
  if (/\b(human|agent|broker|call me|callback|talk to someone)\b/.test(body)) {
    triggers.push(trigger("human_request", "Client requesting callback", clientMessage.body, "high"));
  }
  if (/\b(price|pricing|payment|pay|discount|negotiate|final rate)\b/.test(body)) {
    triggers.push(trigger("pricing", "Pricing or payment question", clientMessage.body, "medium"));
  }
  if (/\b\d{10}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(clientMessage.body)) {
    triggers.push(trigger("contact_shared", "Client shared contact details", clientMessage.body, "high"));
  }
  if (extracted.budgetValue >= 10000000) {
    triggers.push(trigger("high_value", "High deal value detected", `Budget ${extracted.budgetValue}`, "high"));
  }

  return triggers;
}

function isQualificationReady(extracted) {
  const hasIntent = Boolean(extracted.intent);
  const hasBudget = Boolean(extracted.budget || extracted.budgetValue || extracted.rent);
  const hasLocation = Boolean(extracted.location);
  const hasUrgency = Boolean(extracted.urgency || extracted.timeline || extracted.moveInTimeline);
  const hasFinalRequest = Boolean(extracted.specialRequest || extracted.query || extracted.notes || extracted.qualificationComplete);
  return hasIntent && hasBudget && hasLocation && hasUrgency && hasFinalRequest;
}

function summarizePreferences(extracted) {
  return [
    extracted.intent ? `Intent: ${extracted.intent}` : "",
    extracted.budget || extracted.rent ? `Budget: ${extracted.budget || extracted.rent}` : "",
    extracted.location ? `Location: ${extracted.location}` : "",
    extracted.urgency ? `Urgency: ${extracted.urgency}` : "",
    extracted.propertyType ? `Type: ${extracted.propertyType}` : "",
    extracted.specialRequest || extracted.query ? `Request: ${extracted.specialRequest || extracted.query}` : ""
  ].filter(Boolean).join("\n");
}

function trigger(type, title, body, priority) {
  return {
    type,
    title,
    body,
    priority,
    channels: ["dashboard", "whatsapp", "telegram", "email"]
  };
}

async function deliverExternal(notification, conversation) {
  const text = `${notification.title}\n${notification.body || ""}\nClient: ${conversation.clientPhone}`;
  const whatsappText = `${notification.title}\nClient: ${conversation.clientPhone}`;
  const jobs = [];

  if (env.notifications.brokerWhatsappNumber && ["high", "critical"].includes(notification.priority)) {
    if (samePhone(env.notifications.brokerWhatsappNumber, conversation.clientPhone)) {
      console.warn("[notifications] skipped broker WhatsApp alert because broker number matches client", {
        conversationId: conversation._id.toString(),
        clientPhone: conversation.clientPhone
      });
    } else {
      jobs.push(sendWhatsapp(env.notifications.brokerWhatsappNumber, whatsappText).catch(() => null));
    }
  }
  if (env.notifications.emailWebhookUrl) {
    jobs.push(axios.post(env.notifications.emailWebhookUrl, { notification, conversation }).catch(() => null));
  }
  if (env.notifications.telegramBotToken && env.notifications.telegramChatId) {
    const url = `https://api.telegram.org/bot${env.notifications.telegramBotToken}/sendMessage`;
    jobs.push(axios.post(url, { chat_id: env.notifications.telegramChatId, text }).catch(() => null));
  }

  await Promise.all(jobs);
  notification.delivered = true;
  await notification.save();
}

function samePhone(left, right) {
  return normalizePhone(left) === normalizePhone(right);
}

function normalizePhone(phone) {
  return String(phone || "").replace(/^whatsapp:/, "").replace(/[^\d+]/g, "");
}

module.exports = { maybeNotify };
