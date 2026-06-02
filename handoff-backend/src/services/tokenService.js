const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const Session = require("../models/Session");
const { env } = require("../config/env");

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_DAYS = 30;

function signAccessToken(user) {
  return jwt.sign({ sub: user._id, role: user.role }, env.jwtSecret, { expiresIn: ACCESS_TOKEN_TTL });
}

async function createRefreshSession(user, req) {
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await Session.create({
    user: user._id,
    refreshTokenHash,
    userAgent: req.header("user-agent") || "",
    ip: req.ip,
    expiresAt
  });

  return refreshToken;
}

async function rotateRefreshToken(refreshToken, req) {
  const refreshTokenHash = hashToken(refreshToken);
  const session = await Session.findOne({ refreshTokenHash, revokedAt: null }).populate("user");
  if (!session || session.expiresAt.getTime() < Date.now() || !session.user?.active) {
    return null;
  }

  session.revokedAt = new Date();
  await session.save();

  const newRefreshToken = await createRefreshSession(session.user, req);
  return {
    token: signAccessToken(session.user),
    refreshToken: newRefreshToken,
    user: publicUser(session.user)
  };
}

async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) return;
  await Session.findOneAndUpdate({ refreshTokenHash: hashToken(refreshToken) }, { revokedAt: new Date() });
}

async function revokeAllUserSessions(userId) {
  await Session.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    active: user.active
  };
}

module.exports = {
  createRefreshSession,
  hashToken,
  publicUser,
  revokeAllUserSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken
};
