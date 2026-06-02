const express = require("express");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Transcript = require("../models/Transcript");
const { brokerSendMessage, setConversationMode } = require("../services/routingEngine");
const { generateTranscript } = require("../services/transcriptService");
const { requireAuth, requireRole } = require("../middleware/auth");

function conversationRoutes(io) {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    const conversations = await Conversation.find({ team: req.user.team, status: { $ne: "closed" } })
      .sort({ lastMessageAt: -1 })
      .limit(100)
      .lean();
    res.json(conversations);
  });

  router.get("/:id/messages", async (req, res) => {
    const messages = await Message.find({ conversation: req.params.id, team: req.user.team }).sort({ createdAt: 1 }).lean();
    res.json(messages);
  });

  router.post("/:id/mode", requireRole("super_admin", "admin", "broker"), async (req, res) => {
    const conversation = await setConversationMode({
      conversationId: req.params.id,
      brokerId: req.user._id,
      mode: req.body.mode,
      reason: req.body.reason,
      io
    });
    res.json(conversation);
  });

  router.post("/:id/messages", requireRole("super_admin", "admin", "broker"), async (req, res) => {
    const message = await brokerSendMessage({
      conversationId: req.params.id,
      brokerId: req.user._id,
      body: req.body.body,
      io
    });
    res.status(201).json(message);
  });

  router.post("/:id/assign", requireRole("super_admin", "admin"), async (req, res) => {
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, team: req.user.team },
      { assignedBroker: req.body.brokerId, lastBrokerActivityAt: new Date() },
      { new: true }
    );
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    io.to("brokers").emit("conversation:update", conversation);
    res.json(conversation);
  });

  router.post("/:id/notes", requireRole("super_admin", "admin", "broker"), async (req, res) => {
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, team: req.user.team },
      {
        $addToSet: { tags: req.body.tag },
        $push: { brokerNotes: { broker: req.user._id, body: req.body.note } }
      },
      { new: true }
    );
    io.to("brokers").emit("conversation:update", conversation);
    res.json(conversation);
  });

  router.post("/:id/snooze", async (req, res) => {
    const conversation = await Conversation.findOneAndUpdate({ _id: req.params.id, team: req.user.team }, { status: "snoozed" }, { new: true });
    io.to(`team:${req.user.team}`).emit("conversation:update", conversation);
    res.json(conversation);
  });

  router.post("/:id/close", async (req, res) => {
    const conversation = await Conversation.findOneAndUpdate({ _id: req.params.id, team: req.user.team }, { status: "closed" }, { new: true });
    if (!conversation) return res.status(404).json({ error: "Not found" });
    const transcript = await generateTranscript(conversation, "conversation_closed");
    io.to(`team:${req.user.team}`).emit("conversation:closed", { conversation, transcriptId: transcript._id });
    res.json({ conversation, transcriptId: transcript._id });
  });

  router.get("/:id/transcripts", async (req, res) => {
    const transcripts = await Transcript.find({ conversation: req.params.id, team: req.user.team })
      .select("-pdfBuffer")
      .sort({ createdAt: -1 })
      .lean();
    res.json(transcripts);
  });

  router.get("/:id/transcripts/:transcriptId/:format", async (req, res) => {
    const transcript = await Transcript.findOne({ _id: req.params.transcriptId, team: req.user.team });
    if (!transcript) {
      return res.status(404).json({ error: "Transcript not found" });
    }
    if (req.params.format === "json") {
      return res.json(transcript.json);
    }
    if (req.params.format === "txt") {
      res.type("text/plain").send(transcript.txt);
      return;
    }
    if (req.params.format === "pdf") {
      res.type("application/pdf").send(transcript.pdfBuffer);
      return;
    }
    return res.status(400).json({ error: "Unsupported format" });
  });

  return router;
}

module.exports = { conversationRoutes };
