const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { hashToken, publicUser } = require("../services/tokenService");

const router = express.Router();

router.post("/signup", rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "signup" }), async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({ error: "name, email, and an 8+ character password are required" });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ error: "User with this email already exists" });
  }

  const verificationToken = crypto.randomBytes(32).toString("hex");
  const passwordHash = await bcrypt.hash(password, 12);
  
  const Team = require("../models/Team");
  const team = await Team.create({
    name: `${name}'s Workspace`
  });

  const user = await User.create({
    name,
    email,
    passwordHash,
    role: "super_admin",
    team: team._id,
    emailVerificationTokenHash: hashToken(verificationToken)
  });

  req.session.userId = user._id;

  return res.status(201).json({
    user: publicUser(user),
    verificationToken
  });
});

router.post("/login", rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "login" }), async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  user.lastLoginAt = new Date();
  user.lastSeenAt = new Date();
  await user.save();

  req.session.userId = user._id;

  return res.json({
    user: publicUser(user)
  });
});

router.post("/refresh", async (req, res) => {
  // Backwards compatibility for old clients, just return user if session is valid
  if (req.session && req.session.userId) {
    const user = await User.findById(req.session.userId);
    if (user && user.active) {
      return res.json({ user: publicUser(user) });
    }
  }
  return res.status(401).json({ error: "Invalid session" });
});

router.post("/logout", requireAuth, async (req, res) => {
  req.session.destroy();
  res.clearCookie("connect.sid");
  return res.json({ ok: true });
});

router.post("/logout-all", requireAuth, async (req, res) => {
  // Optional: In a production app, we would clear all sessions for this user from the store
  req.session.destroy();
  res.clearCookie("connect.sid");
  return res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  req.user.lastSeenAt = new Date();
  await req.user.save();
  return res.json({ user: publicUser(req.user) });
});

router.post("/forgot-password", rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "forgot" }), async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    return res.json({ ok: true });
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  user.passwordResetTokenHash = hashToken(resetToken);
  user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();

  return res.json({ ok: true, resetToken });
});

router.post("/reset-password", rateLimit({ windowMs: 60_000, max: 8, keyPrefix: "reset" }), async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: "token and an 8+ character password are required" });
  }

  const user = await User.findOne({
    passwordResetTokenHash: hashToken(token),
    passwordResetExpiresAt: { $gt: new Date() }
  });
  if (!user) {
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }

  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  await user.save();
  return res.json({ ok: true });
});

router.post("/verify-email", async (req, res) => {
  const { token } = req.body;
  const user = await User.findOne({ emailVerificationTokenHash: hashToken(token || "") });
  if (!user) {
    return res.status(400).json({ error: "Invalid verification token" });
  }

  user.emailVerified = true;
  user.emailVerificationTokenHash = undefined;
  await user.save();
  return res.json({ ok: true });
});

module.exports = router;
