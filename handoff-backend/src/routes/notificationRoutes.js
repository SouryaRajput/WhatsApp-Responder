const express = require("express");
const Notification = require("../models/Notification");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const notifications = await Notification.find({ team: req.user.team }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(notifications);
});

router.post("/:id/read", async (req, res) => {
  const notification = await Notification.findOneAndUpdate({ _id: req.params.id, team: req.user.team }, { readAt: new Date() }, { new: true });
  res.json(notification);
});

module.exports = router;
