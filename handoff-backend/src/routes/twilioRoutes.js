const express = require("express");
const twilio = require("twilio");
const { env } = require("../config/env");
const { requireAuth, requireRole } = require("../middleware/auth");
const Team = require("../models/Team");

const router = express.Router();
router.use(requireAuth);
router.use(requireRole("super_admin", "admin")); // Only admins can provision numbers

function getTwilioClient() {
  if (!env.twilio.accountSid || !env.twilio.authToken) {
    throw new Error("Twilio credentials not configured on the server.");
  }
  return twilio(env.twilio.accountSid, env.twilio.authToken);
}

// Search for available numbers
router.get("/available-numbers", async (req, res) => {
  try {
    const { country = "US", type = "local" } = req.query;
    const client = getTwilioClient();
    
    let numbers = [];
    try {
      if (type === "tollfree") {
        numbers = await client.availablePhoneNumbers(country).tollFree.list({ limit: 10 });
      } else if (type === "mobile") {
        numbers = await client.availablePhoneNumbers(country).mobile.list({ limit: 10 });
      } else {
        numbers = await client.availablePhoneNumbers(country).local.list({ limit: 10 });
      }
    } catch (searchError) {
      // Fallback: if mobile isn't available for this country, try local
      if (type === "mobile" && searchError.status === 404) {
        numbers = await client.availablePhoneNumbers(country).local.list({ limit: 10 });
      } else {
        throw searchError;
      }
    }
    
    res.json({
      numbers: numbers.map(n => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
        capabilities: n.capabilities
      }))
    });
  } catch (error) {
    console.error("[twilio:search]", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Buy a number
router.post("/buy-number", async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: "phoneNumber is required" });
    }

    const client = getTwilioClient();
    
    // Purchase the number
    const incomingPhoneNumber = await client.incomingPhoneNumbers.create({
      phoneNumber
    });

    console.log("[twilio:buy] Purchased number", incomingPhoneNumber.phoneNumber);

    // Update the team with the new number
    const team = await Team.findByIdAndUpdate(
      req.user.team,
      {
        twilioPhoneNumber: incomingPhoneNumber.phoneNumber,
        twilioSid: incomingPhoneNumber.sid
      },
      { new: true }
    );

    res.json({ success: true, team });
  } catch (error) {
    console.error("[twilio:buy]", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
