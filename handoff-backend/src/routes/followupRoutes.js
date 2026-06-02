const express = require("express");
const FollowUp = require("../models/FollowUp");
const Conversation = require("../models/Conversation");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const followUps = await FollowUp.find({ team: req.user.team })
    .populate("conversation", "clientPhone clientName leadScore status")
    .populate("broker", "name email")
    .sort({ scheduledFor: 1 })
    .limit(100)
    .lean();
  res.json(followUps);
});

router.post("/", async (req, res) => {
  const conversation = await Conversation.findOne({ _id: req.body.conversationId, team: req.user.team });
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const followUp = await FollowUp.create({
    conversation: conversation._id,
    team: req.user.team,
    broker: req.user._id,
    scheduledFor: new Date(req.body.scheduledFor),
    type: req.body.type || "manual",
    template: req.body.template,
    notes: req.body.notes
  });
  res.status(201).json(followUp);
});

router.patch("/:id", async (req, res) => {
  const followUp = await FollowUp.findOneAndUpdate({ _id: req.params.id, team: req.user.team }, req.body, { new: true });
  if (!followUp) {
    return res.status(404).json({ error: "Follow-up not found" });
  }
  res.json(followUp);
});

module.exports = router;
