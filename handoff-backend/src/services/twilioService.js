const twilio = require("twilio");
const { env } = require("../config/env");

const client = twilio(env.twilio.accountSid, env.twilio.authToken);

function toWhatsapp(phone) {
  return `whatsapp:${phone.replace(/^whatsapp:/, "")}`;
}

async function sendWhatsapp(teamId, to, body) {
  const Team = require("../models/Team");
  const team = await Team.findById(teamId);
  if (!team || !team.twilioPhoneNumber) {
    throw new Error("Team Twilio number not configured");
  }

  const message = await client.messages.create({
    from: toWhatsapp(team.twilioPhoneNumber),
    to: toWhatsapp(to),
    body
  });
  return message.sid;
}

function validateTwilioWebhook(req) {
  if (env.nodeEnv !== "production") {
    return true;
  }

  const signature = req.header("X-Twilio-Signature");
  const publicUrl = `${env.twilio.publicWebhookBaseUrl}${req.originalUrl}`;
  return twilio.validateRequest(env.twilio.authToken, signature, publicUrl, req.body);
}

module.exports = { sendWhatsapp, validateTwilioWebhook };
