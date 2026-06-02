const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    twilioSid: { type: String, unique: true, sparse: true, index: true },
    sender: { type: String, enum: ["client", "ai", "broker", "system"], required: true },
    source: { type: String, enum: ["client", "AI", "broker", "system"], required: true },
    body: { type: String, default: "" },
    media: [
      {
        url: String,
        contentType: String
      }
    ],
    mode: { type: String, enum: ["AI", "SHADOW", "HUMAN", "HYBRID"], required: true },
    status: { type: String, enum: ["received", "queued", "sent", "delivered", "read", "failed"], default: "received" },
    metadata: {
      aiConfidence: Number,
      aiReasoning: String,
      suggestedReplies: [String],
      sentiment: String,
      intent: String,
      triggerReasons: [String],
      deliveryError: String
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", MessageSchema);
