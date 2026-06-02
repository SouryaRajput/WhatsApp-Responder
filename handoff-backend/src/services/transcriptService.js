const PDFDocument = require("pdfkit");
const Transcript = require("../models/Transcript");
const Message = require("../models/Message");

async function generateTranscript(conversation, reason) {
  const messages = await Message.find({ conversation: conversation._id }).sort({ createdAt: 1 });
  const json = {
    conversationId: conversation._id,
    clientPhone: conversation.clientPhone,
    reason,
    extracted: conversation.extracted,
    analytics: {
      leadScore: conversation.leadScore,
      sentiment: conversation.sentiment,
      aiConfidence: conversation.aiConfidence,
      conversionProbability: conversation.conversionProbability
    },
    summary: conversation.summary?.text || "",
    messages: messages.map((msg) => ({
      timestamp: msg.createdAt,
      speaker: msg.sender,
      source: msg.source,
      mode: msg.mode,
      body: msg.body,
      status: msg.status
    }))
  };

  const txt = [
    `Conversation: ${conversation._id}`,
    `Client: ${conversation.clientPhone}`,
    `Reason: ${reason}`,
    `Summary: ${json.summary}`,
    "",
    ...json.messages.map((msg) => `[${msg.timestamp.toISOString()}] ${msg.speaker}/${msg.source}: ${msg.body}`)
  ].join("\n");

  const pdfBuffer = await buildPdf(json);

  return Transcript.create({
    conversation: conversation._id,
    reason,
    summary: json.summary,
    extracted: conversation.extracted,
    analytics: json.analytics,
    json,
    txt,
    pdfBuffer
  });
}

function buildPdf(json) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(16).text("Conversation Transcript");
    doc.moveDown();
    doc.fontSize(10).text(`Conversation: ${json.conversationId}`);
    doc.text(`Client: ${json.clientPhone}`);
    doc.text(`Reason: ${json.reason}`);
    doc.moveDown();
    doc.fontSize(12).text("Summary");
    doc.fontSize(10).text(json.summary || "No summary available.");
    doc.moveDown();
    doc.fontSize(12).text("Messages");
    for (const msg of json.messages) {
      doc.fontSize(9).text(`[${new Date(msg.timestamp).toISOString()}] ${msg.speaker}/${msg.source}: ${msg.body}`);
    }
    doc.end();
  });
}

module.exports = { generateTranscript };
