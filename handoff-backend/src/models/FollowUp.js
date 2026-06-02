const mongoose = require("mongoose");

const FollowUpSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    broker: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    scheduledFor: { type: Date, required: true, index: true },
    status: { type: String, enum: ["scheduled", "snoozed", "sent", "cancelled"], default: "scheduled", index: true },
    type: { type: String, enum: ["manual", "ai", "inactivity"], default: "manual" },
    template: String,
    notes: String,
    sentAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("FollowUp", FollowUpSchema);
