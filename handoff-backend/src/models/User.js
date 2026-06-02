const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["platform_admin", "super_admin", "admin", "broker", "viewer"], default: "broker" },
    active: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: String,
    passwordResetTokenHash: String,
    passwordResetExpiresAt: Date,
    lastLoginAt: Date,
    lastSeenAt: Date,
    permissions: [{ type: String }],
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
