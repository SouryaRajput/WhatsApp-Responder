const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { requireAuth, requireRole } = require("../middleware/auth");
const { env } = require("../config/env");

const router = express.Router();
router.use(requireAuth);

/* ── GET /settings ─────────────────────────────────────────────── */
router.get("/", async (req, res) => {
  const isAdmin = ["super_admin", "admin"].includes(req.user.role);

  // Basic stats anyone can see
  const [totalConversations, totalMessages] = await Promise.all([
    Conversation.countDocuments({ team: req.user.team }).catch(() => 0),
    Message.countDocuments({ team: req.user.team }).catch(() => 0)
  ]);

  const payload = {
    workspace: "WhatsApp Handoff",
    modes: ["AI", "SHADOW", "HUMAN", "HYBRID"],
    notificationChannels: ["dashboard", "email", "telegram", "whatsapp"],
    queue: process.env.REDIS_URL ? "redis" : "in-memory",
    oauth: { google: Boolean(process.env.GOOGLE_CLIENT_ID) },
    twoFactor: { enabled: false, status: "planned" },
    stats: {
      totalConversations,
      totalMessages
    }
  };

  // Admin-only: include integration status
  if (isAdmin) {
    // Only return team specific integrations, prevent reading global env variables
    const Team = require("../models/Team");
    const team = await Team.findById(req.user.team);

    payload.integrations = {
      twilio: {
        connected: Boolean(team?.twilioPhoneNumber),
        whatsappNumber: team?.twilioPhoneNumber || "not configured",
        webhookBase: env.twilio.publicWebhookBaseUrl || "not configured"
      },
      ai: {
        model: env.openrouter.model,
        configured: Boolean(env.openrouter.apiKey)
      }
    };
  }

  res.json(payload);
});

/* ── PATCH /settings/profile ───────────────────────────────────── */
router.patch("/profile", async (req, res) => {
  const { name, currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (name && name.trim()) {
    user.name = name.trim();
  }

  if (newPassword) {
    if (!currentPassword) {
      return res.status(400).json({ error: "Current password is required to set a new password" });
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
  }

  await user.save();
  res.json({
    ok: true,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified
    }
  });
});

/* ── PATCH /settings/integrations (admin only) ─────────────────── */
router.patch("/integrations", requireRole("super_admin", "admin"), async (req, res) => {
  // In a production app you'd persist these to a Settings collection.
  // For now, return a confirmation that the values were received.
  res.json({
    ok: true,
    message: "Integration settings are managed via environment variables. Restart the server after changing .env values."
  });
});

module.exports = router;
