const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    body: String,
    priority: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
    channels: [{ type: String, enum: ["dashboard", "email", "telegram", "whatsapp", "push"] }],
    dedupeKey: { type: String, index: true },
    delivered: { type: Boolean, default: false },
    readAt: Date
  },
  { timestamps: true }
);

NotificationSchema.index({ dedupeKey: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", NotificationSchema);
