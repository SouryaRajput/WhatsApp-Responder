function enqueueWebhookJob(payload, io) {
  setImmediate(async () => {
    const mongoose = require("mongoose");
    const { handleClientWebhook } = require("./routingEngine");
    try {
      if (mongoose.connection.readyState !== 1) {
        console.error("[queue] skipped webhook job because MongoDB is unavailable", {
          sid: payload.MessageSid,
          from: payload.From
        });
        return;
      }
      const result = await handleClientWebhook(payload, io);
      console.log("[queue] webhook job processed", { sid: payload.MessageSid, result });
    } catch (error) {
      console.error("[queue] webhook job failed", { sid: payload.MessageSid, error: error.message });
      console.error(error);
    }
  });
}

module.exports = { enqueueWebhookJob };
