const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const { Server } = require("socket.io");
const { env } = require("./config/env");
const { checkDb, connectDb, dbState, requireDb } = require("./config/db");
const { configureSocket } = require("./realtime/socket");
const { webhookRoutes } = require("./routes/webhookRoutes");
const { conversationRoutes } = require("./routes/conversationRoutes");
const authRoutes = require("./routes/authRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const teamRoutes = require("./routes/teamRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const transcriptRoutes = require("./routes/transcriptRoutes");
const followupRoutes = require("./routes/followupRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const twilioRoutes = require("./routes/twilioRoutes");
const platformRoutes = require("./routes/platformRoutes");
const { rateLimit } = require("./middleware/rateLimit");

async function main() {
  await connectDb();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: env.clientOrigin, credentials: true }
  });

  const sessionMiddleware = session({
    secret: env.jwtSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions"
    }),
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "lax"
    }
  });

  app.use(sessionMiddleware);
  io.engine.use(sessionMiddleware);

  configureSocket(io);

  app.use(helmet());
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(morgan("dev"));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: "1mb" }));

  app.use(rateLimit({ windowMs: 60_000, max: 180, keyPrefix: "api" }));

  app.get("/health", async (req, res) => {
    const mongo = await checkDb();
    res.status(mongo ? 200 : 503).json({
      ok: mongo,
      mode: env.nodeEnv,
      mongodb: mongo ? "connected" : "unavailable",
      dbError: mongo ? null : dbState.lastError,
      hint: mongo ? null : "Add your current IP in MongoDB Atlas Network Access or verify MONGO_URI."
    });
  });

  app.use("/auth", requireDb, authRoutes);
  app.use("/webhooks", webhookRoutes(io));
  app.use("/webhook", webhookRoutes(io));
  app.use("/conversations", requireDb, conversationRoutes(io));
  app.use("/notifications", requireDb, notificationRoutes);
  app.use("/team", requireDb, teamRoutes);
  app.use("/analytics", requireDb, analyticsRoutes);
  app.use("/transcripts", requireDb, transcriptRoutes);
  app.use("/followups", requireDb, followupRoutes);
  app.use("/settings", requireDb, settingsRoutes);
  app.use("/twilio", requireDb, twilioRoutes);
  app.use("/platform", requireDb, platformRoutes);

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  });

  server.listen(env.port, () => {
    console.log(`Handoff backend listening on ${env.port}`);
  });
}

main().catch((error) => {
  console.error("Startup failed", error);
  process.exit(1);
});
