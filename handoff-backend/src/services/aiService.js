const axios = require("axios");
const { env } = require("../config/env");

const SYSTEM_PROMPT = `
You are a WhatsApp real-estate preference intake assistant.
Your job is to understand and qualify the user's property preferences for a broker.
Do not sell, pitch, recommend, search for, shortlist, or claim to have found properties.
Do not discuss available inventory unless the user asks a direct question; even then, collect
the question/request and say the broker will review it.

Conversation goal:
1. Collect whether the user wants to buy or rent.
2. Collect budget or rent range.
3. Collect preferred location.
4. Collect timeline or move-in urgency.
5. Collect property type or requirement if relevant.
6. Ask one final question: whether they have any queries, special requests, or notes for the broker.
7. After that, politely say you will share the details with the broker.

Ask only one missing question at a time. Keep replies short and natural.
Rate the lead internally using leadScore and conversionProbability, but never show these to the user.
Return compact JSON only. Never reveal internal routing or whether a human is present.
The reply field is customer-facing. Do not mention lead score, conversion probability,
AI confidence, sentiment labels, internal intent labels, analytics, scoring, routing,
or any broker-only metadata in the reply.
Use extracted fields like:
intent, budget, budgetValue, rent, location, urgency, propertyType, requirements,
specialRequest, query, contactPreference, phone, email, address, qualificationComplete.
Fields:
reply: string
suggestedReplies: string[3]
summary: string
sentiment: positive|neutral|negative|angry
intent: low|medium|high|human_request|pricing|objection|spam
confidence: number 0-100
leadScore: number 0-100
conversionProbability: number 0-100
extracted: object
triggerReasons: string[]
`;

async function callLLM(messages) {
  const response = await axios.post(
    `${env.openrouter.baseUrl}/chat/completions`,
    {
      model: env.openrouter.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages]
    },
    {
      timeout: env.openrouter.timeoutMs,
      headers: {
        Authorization: `Bearer ${env.openrouter.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://whatsapp-handoff.local",
        "X-Title": "WhatsApp Handoff"
      }
    }
  );

  const raw = response.data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function analyzeAndReply({ conversation, recentMessages, clientMessage }) {
  const context = recentMessages.map((msg) => ({
    role: msg.sender === "client" ? "user" : "assistant",
    content: msg.body
  }));

  context.push({
    role: "user",
    content: `Client message: ${clientMessage.body}\nConversation mode: ${conversation.mode}`
  });

  const result = await callLLM(context);
  return normalizeAiResult(result);
}

async function draftHybridReplies({ conversation, recentMessages, clientMessage }) {
  const result = await analyzeAndReply({ conversation, recentMessages, clientMessage });
  return {
    ...result,
    reply: "",
    suggestedReplies: result.suggestedReplies?.length ? result.suggestedReplies : [result.reply].filter(Boolean)
  };
}

function normalizeAiResult(result) {
  return {
    reply: sanitizeCustomerReply(String(result.reply || "")).slice(0, 1500),
    suggestedReplies: Array.isArray(result.suggestedReplies)
      ? result.suggestedReplies.slice(0, 3).map((reply) => sanitizeCustomerReply(String(reply || ""))).filter(Boolean)
      : [],
    summary: String(result.summary || ""),
    sentiment: ["positive", "neutral", "negative", "angry"].includes(result.sentiment) ? result.sentiment : "neutral",
    intent: String(result.intent || "medium"),
    confidence: clamp(Number(result.confidence || 50), 0, 100),
    leadScore: clamp(Number(result.leadScore || 0), 0, 100),
    conversionProbability: clamp(Number(result.conversionProbability || 0), 0, 100),
    extracted: result.extracted && typeof result.extracted === "object" ? result.extracted : {},
    triggerReasons: Array.isArray(result.triggerReasons) ? result.triggerReasons : []
  };
}

function sanitizeCustomerReply(reply) {
  const cleaned = reply
    .split(/\r?\n/)
    .filter((line) => !isInternalAnalyticsLine(line))
    .join("\n")
    .replace(/\b(?:lead\s*score|score|ai\s*confidence|confidence|conversion\s*probability|sentiment|internal\s*intent)\s*[:=-]?\s*\d{1,3}\s*%?/gi, "")
    .replace(/\b(?:cold|warm|hot|very hot)\s+lead\b/gi, "interested lead")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (isPropertySalesReply(cleaned)) {
    return "Thanks, I have noted your preferences. Do you have any queries, special requests, or notes you would like me to share with the broker?";
  }

  return cleaned;
}

function isInternalAnalyticsLine(line) {
  return /\b(lead\s*score|ai\s*confidence|conversion\s*probability|sentiment\s*:|internal\s*intent|analytics|broker\s*metadata)\b/i.test(line);
}

function isPropertySalesReply(reply) {
  return /\b(i found|we found|here are|shortlisted|available properties|property options|listings|schedule a visit|book a visit)\b/i.test(reply);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = { analyzeAndReply, draftHybridReplies };
