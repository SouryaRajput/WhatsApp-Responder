require("dotenv").config();

function required(name, fallback = undefined) {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8080),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  mongoUri: required("MONGO_URI"),
  jwtSecret: required("JWT_SECRET"),
  twilio: {
    accountSid: required("TWILIO_ACCOUNT_SID"),
    authToken: required("TWILIO_AUTH_TOKEN"),
    whatsappNumber: required("TWILIO_WHATSAPP_NUMBER"),
    publicWebhookBaseUrl: process.env.PUBLIC_WEBHOOK_BASE_URL || ""
  },
  openrouter: {
    apiKey: required("OPENROUTER_API_KEY"),
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    timeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS || 8000)
  },
  notifications: {
    brokerWhatsappNumber: process.env.BROKER_WHATSAPP_NUMBER || "",
    emailWebhookUrl: process.env.EMAIL_WEBHOOK_URL || "",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || ""
  }
};

module.exports = { env };
