const express = require("express");
const Transcript = require("../models/Transcript");
const Conversation = require("../models/Conversation");
const { requireAuth } = require("../middleware/auth");
const { generateTranscript } = require("../services/transcriptService");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const query = { team: req.user.team };
  if (req.query.q) {
    query.txt = { $regex: req.query.q, $options: "i" };
  }
  const transcripts = await Transcript.find(query)
    .select("-pdfBuffer")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.json(transcripts);
});

router.post("/generate/:conversationId", async (req, res) => {
  const conversation = await Conversation.findOne({ _id: req.params.conversationId, team: req.user.team });
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }
  const transcript = await generateTranscript(conversation, req.body.reason || "manual_request");
  res.status(201).json({ id: transcript._id });
});

module.exports = router;
