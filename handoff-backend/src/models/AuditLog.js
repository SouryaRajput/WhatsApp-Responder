const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true, index: true },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
    metadata: Object
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditLog", AuditLogSchema);
