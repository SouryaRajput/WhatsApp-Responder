const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema(
  {
    clientPhone: { type: String, required: true, index: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    clientName: String,
    mode: { type: String, enum: ["AI", "SHADOW", "HUMAN", "HYBRID"], default: "AI", index: true },
    status: { type: String, enum: ["active", "snoozed", "closed"], default: "active", index: true },
    assignedBroker: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastClientMessageAt: Date,
    lastBrokerActivityAt: Date,
    unreadForBroker: { type: Number, default: 0 },
    leadScore: { type: Number, default: 0 },
    sentiment: { type: String, default: "neutral" },
    aiConfidence: { type: Number, default: 100 },
    conversionProbability: { type: Number, default: 0 },
    tags: [{ type: String }],
    extracted: {
      name: String,
      budget: String,
      budgetValue: Number,
      rent: String,
      requirements: String,
      location: String,
      urgency: String,
      timeline: String,
      moveInTimeline: String,
      intent: String,
      propertyType: String,
      specialRequest: String,
      query: String,
      notes: String,
      qualificationComplete: Boolean,
      objections: [String],
      source: String,
      phone: String,
      email: String,
      address: String
    },
    summary: {
      text: String,
      pendingQuestions: [String],
      lastGeneratedAt: Date
    },
    brokerNotes: [
      {
        broker: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        body: String,
        createdAt: { type: Date, default: Date.now }
      }
    ],
    handoff: {
      takenOverAt: Date,
      releasedAt: Date,
      autoResumeAt: Date,
      reason: String
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversation", ConversationSchema);
