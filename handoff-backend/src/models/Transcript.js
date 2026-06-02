const mongoose = require("mongoose");

const TranscriptSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    reason: { type: String, enum: ["conversation_closed", "broker_takeover", "deal_completed", "manual_request", "inactivity"], required: true },
    summary: String,
    extracted: Object,
    analytics: Object,
    json: Object,
    txt: String,
    pdfBuffer: Buffer
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transcript", TranscriptSchema);
