const mongoose = require("mongoose");

const BrokerSessionSchema = new mongoose.Schema(
  {
    broker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    mode: { type: String, enum: ["SHADOW", "HUMAN", "HYBRID"], required: true },
    active: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
    takeoverAt: Date,
    releasedAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("BrokerSession", BrokerSessionSchema);
