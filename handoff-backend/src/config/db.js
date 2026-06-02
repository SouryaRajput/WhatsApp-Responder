const mongoose = require("mongoose");
const { env } = require("./env");

const dbState = {
  connected: false,
  lastError: null,
  lastCheckedAt: null
};

async function connectDb() {
  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10000
    });
    dbState.connected = true;
    dbState.lastError = null;
    dbState.lastCheckedAt = new Date();
    console.log("MongoDB connected");
    return true;
  } catch (error) {
    dbState.connected = false;
    dbState.lastError = error.message;
    dbState.lastCheckedAt = new Date();
    console.error("MongoDB unavailable. Starting backend in degraded mode.");
    console.error(error.message);
    return false;
  }
}

async function checkDb() {
  dbState.lastCheckedAt = new Date();
  if (mongoose.connection.readyState === 1) {
    dbState.connected = true;
    dbState.lastError = null;
    return true;
  }

  try {
    await mongoose.connection.db.admin().ping();
    dbState.connected = true;
    dbState.lastError = null;
    return true;
  } catch (error) {
    dbState.connected = false;
    dbState.lastError = error.message;
    return false;
  }
}

function requireDb(req, res, next) {
  if (mongoose.connection.readyState === 1) {
    return next();
  }
  return res.status(503).json({
    error: "MongoDB unavailable",
    detail: dbState.lastError,
    hint: "Check MongoDB Atlas Network Access/IP whitelist, cluster status, and MONGO_URI credentials."
  });
}

module.exports = { checkDb, connectDb, dbState, requireDb };
