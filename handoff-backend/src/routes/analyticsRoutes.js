const express = require("express");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const FollowUp = require("../models/FollowUp");
const BrokerSession = require("../models/BrokerSession");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/overview", async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    activeConversations,
    hotLeads,
    closedLeads,
    pendingFollowUps,
    brokerInterventionsToday,
    avgAiConfidence,
    latestLeadActivity,
    urgentAlerts,
    brokerOnlineCount,
    messageVolume
  ] = await Promise.all([
    Conversation.countDocuments({ team: req.user.team, status: { $ne: "closed" } }),
    Conversation.countDocuments({ team: req.user.team, leadScore: { $gte: 70 }, status: { $ne: "closed" } }),
    Conversation.countDocuments({ team: req.user.team, status: "closed" }),
    FollowUp.countDocuments({ team: req.user.team, status: { $in: ["scheduled", "snoozed"] } }),
    BrokerSession.countDocuments({ team: req.user.team, takeoverAt: { $gte: startOfDay } }),
    Conversation.aggregate([{ $match: { team: req.user.team } }, { $group: { _id: null, value: { $avg: "$aiConfidence" } } }]),
    Conversation.find({ team: req.user.team }).sort({ lastMessageAt: -1 }).limit(8).lean(),
    Notification.find({ team: req.user.team, readAt: null }).sort({ createdAt: -1 }).limit(8).lean(),
    BrokerSession.distinct("broker", { team: req.user.team, lastSeenAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } }),
    Message.aggregate([
      { $match: { team: req.user.team, createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ])
  ]);

  const avgConfidence = Math.round(avgAiConfidence[0]?.value || 0);
  const totalLeads = activeConversations + closedLeads;

  res.json({
    metrics: {
      activeConversations,
      hotLeads,
      brokerInterventionsToday,
      aiResponseTime: "queued",
      conversionRate: totalLeads ? Math.round((closedLeads / totalLeads) * 100) : 0,
      pendingFollowUps,
      aiConfidenceAverage: avgConfidence,
      brokerOnlineCount: brokerOnlineCount.length
    },
    latestLeadActivity,
    urgentAlerts,
    messageVolume
  });
});

module.exports = router;
