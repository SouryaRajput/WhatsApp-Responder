const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const BrokerSession = require("../models/BrokerSession");
const AuditLog = require("../models/AuditLog");
const { requireAuth, requireRole } = require("../middleware/auth");
const { publicUser, revokeAllUserSessions } = require("../services/tokenService");

const router = express.Router();
router.use(requireAuth);

router.get("/", requireRole("super_admin", "admin"), async (req, res) => {
  const users = await User.find({ team: req.user.team }).sort({ createdAt: -1 }).lean();
  const conversations = await Conversation.aggregate([
    { $match: { team: req.user.team, assignedBroker: { $ne: null }, status: { $ne: "closed" } } },
    { $group: { _id: "$assignedBroker", activeConversationCount: { $sum: 1 }, avgLeadScore: { $avg: "$leadScore" } } }
  ]);
  const activity = await BrokerSession.aggregate([
    { $match: { team: req.user.team } },
    { $group: { _id: "$broker", interventions: { $sum: 1 }, lastSeenAt: { $max: "$lastSeenAt" } } }
  ]);

  const statsByUser = new Map([...conversations, ...activity].map((item) => [String(item._id), item]));
  const enriched = users.map((user) => ({
    ...publicUser(user),
    createdAt: user.createdAt,
    lastSeenAt: user.lastSeenAt,
    stats: statsByUser.get(String(user._id)) || {}
  }));

  res.json(enriched);
});

router.post("/", requireRole("super_admin", "admin"), async (req, res) => {
  const { name, email, password, role = "broker" } = req.body;
  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({ error: "name, email, and an 8+ character password are required" });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ error: "User with this email already exists" });
  }

  const user = await User.create({
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role,
    team: req.user.team,
    emailVerified: true
  });
  await AuditLog.create({ actor: req.user._id, action: "broker_created", metadata: { userId: user._id, role } });
  res.status(201).json(publicUser(user));
});

router.patch("/:id", requireRole("super_admin", "admin"), async (req, res) => {
  const allowed = {};
  for (const key of ["name", "role", "active", "permissions"]) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      allowed[key] = req.body[key];
    }
  }

  const user = await User.findByIdAndUpdate(req.params.id, allowed, { new: true });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  if (allowed.active === false) {
    await revokeAllUserSessions(user._id);
  }
  await AuditLog.create({ actor: req.user._id, action: "broker_updated", metadata: { userId: user._id, changes: allowed } });
  res.json(publicUser(user));
});

router.delete("/:id", requireRole("super_admin"), async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  await revokeAllUserSessions(user._id);
  await AuditLog.create({ actor: req.user._id, action: "broker_suspended", metadata: { userId: user._id } });
  res.json(publicUser(user));
});

router.get("/:id/activity", requireRole("super_admin", "admin"), async (req, res) => {
  const logs = await AuditLog.find({ actor: req.params.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(logs);
});

module.exports = router;
