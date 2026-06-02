const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const User = require("../models/User");

async function requireAuth(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const user = await User.findById(req.session.userId);
    if (!user || !user.active) {
      req.session.destroy();
      return res.status(401).json({ error: "Account inactive or not found" });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid session" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
