const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true, index: true },
    userAgent: String,
    ip: String,
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("Session", SessionSchema);
