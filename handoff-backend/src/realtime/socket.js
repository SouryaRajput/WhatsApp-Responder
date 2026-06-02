const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const User = require("../models/User");

function configureSocket(io) {
  io.use(async (socket, next) => {
    try {
      const session = socket.request.session;
      if (!session || !session.userId) {
        return next(new Error("Unauthorized"));
      }
      const user = await User.findById(session.userId);
      if (!user || !user.active) {
        return next(new Error("Unauthorized"));
      }
      socket.user = user;
      next();
    } catch (error) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`team:${socket.user.team}`);

    socket.on("conversation:join", (conversationId) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on("conversation:leave", (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on("typing:broker", ({ conversationId, typing }) => {
      socket.to(`team:${socket.user.team}`).emit("typing:broker", {
        conversationId,
        brokerId: socket.user._id,
        typing
      });
    });
  });
}

module.exports = { configureSocket };
