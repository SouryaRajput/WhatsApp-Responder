const express = require("express");
const Team = require("../models/Team");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);
// Only platform_admin can access these routes
router.use(requireRole("platform_admin"));

// Get all workspaces (Teams) and their primary admin
router.get("/workspaces", async (req, res) => {
  try {
    const teams = await Team.find().sort({ createdAt: -1 }).lean();
    
    // For each team, let's find their super_admin
    const enrichedTeams = await Promise.all(
      teams.map(async (team) => {
        const superAdmins = await User.find({ team: team._id, role: "super_admin" })
          .select("name email")
          .lean();
        
        return {
          ...team,
          admins: superAdmins
        };
      })
    );
    
    res.json(enrichedTeams);
  } catch (error) {
    console.error("[platform:workspaces:get]", error);
    res.status(500).json({ error: "Failed to fetch workspaces" });
  }
});

// Update a workspace (e.g., attach Twilio number)
router.patch("/workspaces/:id", async (req, res) => {
  try {
    const { twilioPhoneNumber, twilioSid } = req.body;
    
    const updates = {};
    if (twilioPhoneNumber !== undefined) updates.twilioPhoneNumber = twilioPhoneNumber;
    if (twilioSid !== undefined) updates.twilioSid = twilioSid;

    const team = await Team.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true }
    );

    if (!team) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    res.json({ success: true, team });
  } catch (error) {
    console.error("[platform:workspaces:patch]", error);
    res.status(500).json({ error: "Failed to update workspace" });
  }
});

module.exports = router;
