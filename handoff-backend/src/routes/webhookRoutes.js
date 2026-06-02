const express = require("express");
const Message = require("../models/Message");
const Team = require("../models/Team");
const { enqueueWebhookJob } = require("../services/processingQueue");
const { validateTwilioWebhook } = require("../services/twilioService");

function webhookRoutes(io) {
  const router = express.Router();

  router.get("/twilio/whatsapp", (req, res) => {
    res.json({
      ok: true,
      route: "POST /webhooks/twilio/whatsapp",
      note: "Twilio must call this route with POST form data."
    });
  });

  async function handleWhatsappPost(req, res, next) {
    try {
      console.log("[twilio:webhook] incoming WhatsApp message", {
        path: req.originalUrl,
        from: req.body.From,
        sid: req.body.MessageSid,
        body: req.body.Body,
        keys: Object.keys(req.body || {})
      });

      if (!validateTwilioWebhook(req)) {
        console.warn("[twilio:webhook] rejected invalid signature", {
          from: req.body.From,
          sid: req.body.MessageSid
        });
        return res.status(403).send("Invalid signature");
      }

      const team = await Team.findOne({ twilioPhoneNumber: req.body.To });
      if (!team) {
        console.warn("[twilio:webhook] No team found for number:", req.body.To);
        // Fallback or ignore? We can't attach it to a team.
        return res.status(200).send("");
      }

      res.status(200).send("");
      enqueueWebhookJob({ ...req.body, _teamId: team._id }, io);
    } catch (error) {
      next(error);
    }
  }

  router.post("/twilio/whatsapp", handleWhatsappPost);
  router.post("/whatsapp", handleWhatsappPost);

  router.post("/twilio/status", async (req, res) => {
    if (req.body.MessageSid && req.body.MessageStatus) {
      await Message.findOneAndUpdate(
        { twilioSid: req.body.MessageSid },
        {
          status: req.body.MessageStatus,
          $set: { "metadata.deliveryError": req.body.ErrorMessage || "" }
        }
      );
    }
    io.to("brokers").emit("message:status", req.body);
    res.status(200).send("");
  });

  return router;
}

module.exports = { webhookRoutes };
