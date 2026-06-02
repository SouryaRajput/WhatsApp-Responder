require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Team = require('./src/models/Team');
const Conversation = require('./src/models/Conversation');
const Message = require('./src/models/Message');
const Transcript = require('./src/models/Transcript');
const Notification = require('./src/models/Notification');
const { env } = require('./src/config/env');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    const defaultTeam = await Team.findOneAndUpdate(
      { twilioPhoneNumber: env.twilio.whatsappNumber || "+14155238886" },
      { 
        name: "Default Workspace", 
        twilioPhoneNumber: env.twilio.whatsappNumber || "+14155238886"
      },
      { upsert: true, new: true }
    );
    console.log("Default team ID:", defaultTeam._id);

    const userRes = await User.updateMany({ team: { $exists: false } }, { $set: { team: defaultTeam._id } });
    console.log("Users updated:", userRes.modifiedCount);

    const convRes = await Conversation.updateMany({ team: { $exists: false } }, { $set: { team: defaultTeam._id } });
    console.log("Conversations updated:", convRes.modifiedCount);

    const msgRes = await Message.updateMany({ team: { $exists: false } }, { $set: { team: defaultTeam._id } });
    console.log("Messages updated:", msgRes.modifiedCount);

    const trRes = await Transcript.updateMany({ team: { $exists: false } }, { $set: { team: defaultTeam._id } });
    console.log("Transcripts updated:", trRes.modifiedCount);

    const notifRes = await Notification.updateMany({ team: { $exists: false } }, { $set: { team: defaultTeam._id } });
    console.log("Notifications updated:", notifRes.modifiedCount);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
})();
