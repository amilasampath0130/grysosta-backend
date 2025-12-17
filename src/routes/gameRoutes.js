import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import UserPoints from "../models/UserPoints.js";
import GameSession from "../models/GameSession.js";
import Prize from "../models/Prize.js";

const router = express.Router();

// GET /api/game/points
router.get("/points", authenticateToken, async (req, res) => {
  try {
    console.log("Fetching points for user:", req.user._id);
    
    let userPoints = await UserPoints.findOne({ userId: req.user._id });
    
    if (!userPoints) {
      userPoints = new UserPoints({ 
        userId: req.user._id,
        totalPoints: 0,
        lifetimePoints: 0,
        consecutiveDays: 0
      });
      await userPoints.save();
      console.log("Created new user points record");
    }
    
    res.status(200).json({
      success: true,
      totalPoints: userPoints.totalPoints,
      lifetimePoints: userPoints.lifetimePoints,
      consecutiveDays: userPoints.consecutiveDays
    });
  } catch (error) {
    console.error("Error fetching points:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch points"
    });
  }
});

// GET /api/game/can-tap
router.get("/can-tap", authenticateToken, async (req, res) => {
  try {
    console.log("Checking tap availability for user:", req.user._id);
    
    const userPoints = await UserPoints.findOne({ userId: req.user._id });
    
    if (!userPoints || !userPoints.lastTapTime) {
      return res.json({
        success: true,
        canTap: true,
        nextAvailableTime: null,
        hoursUntilNextTap: 0
      });
    }
    
    const now = new Date();
    const lastTap = new Date(userPoints.lastTapTime);
    const hoursSinceLastTap = (now - lastTap) / (1000 * 60 * 60);
    
    const canTap = hoursSinceLastTap >= 24;
    const nextAvailableTime = canTap ? null : new Date(lastTap.getTime() + 24 * 60 * 60 * 1000);
    
    res.json({
      success: true,
      canTap,
      nextAvailableTime,
      hoursUntilNextTap: canTap ? 0 : Math.ceil(24 - hoursSinceLastTap)
    });
  } catch (error) {
    console.error("Error checking tap availability:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check tap availability"
    });
  }
});

// POST /api/game/tap-coin
router.post("/tap-coin", authenticateToken, async (req, res) => {
  try {
    const { coinIndex } = req.body;
    console.log(`Processing coin tap for user: ${req.user._id}, coin: ${coinIndex}`);
    
    // Check if user can tap
    const userPoints = await UserPoints.findOne({ userId: req.user._id });
    if (userPoints && userPoints.lastTapTime) {
      const now = new Date();
      const lastTap = new Date(userPoints.lastTapTime);
      const hoursSinceLastTap = (now - lastTap) / (1000 * 60 * 60);
      
      if (hoursSinceLastTap < 24) {
        return res.status(400).json({
          success: false,
          message: "You can only tap one coin every 24 hours. Please come back tomorrow!",
          nextAvailableTime: new Date(lastTap.getTime() + 24 * 60 * 60 * 1000)
        });
      }
    }
    
    // Generate random points with weighted distribution
    const random = Math.random();
    let pointsEarned;
    
    if (random < 0.5) {
      pointsEarned = Math.floor(Math.random() * 100) + 1; // 1-100 points (50%)
    } else if (random < 0.8) {
      pointsEarned = Math.floor(Math.random() * 400) + 101; // 101-500 points (30%)
    } else if (random < 0.95) {
      pointsEarned = Math.floor(Math.random() * 300) + 501; // 501-800 points (15%)
    } else {
      pointsEarned = Math.floor(Math.random() * 200) + 801; // 801-1000 points (5%)
    }
    
    // Update user points
    let updatedUserPoints = await UserPoints.findOne({ userId: req.user._id });
    if (!updatedUserPoints) {
      updatedUserPoints = new UserPoints({ 
        userId: req.user._id,
        totalPoints: 0,
        lifetimePoints: 0,
        consecutiveDays: 0
      });
    }
    
    // Update points
    updatedUserPoints.totalPoints += pointsEarned;
    updatedUserPoints.lifetimePoints += pointsEarned;
    updatedUserPoints.lastTapTime = new Date();
    
    // Check consecutive days
    const now = new Date();
    if (updatedUserPoints.lastTapTime) {
      const lastTap = new Date(updatedUserPoints.lastTapTime);
      const daysDiff = Math.floor((now - lastTap) / (1000 * 60 * 60 * 24));
      if (daysDiff === 1) {
        updatedUserPoints.consecutiveDays += 1;
      } else if (daysDiff > 1) {
        updatedUserPoints.consecutiveDays = 1;
      }
    } else {
      updatedUserPoints.consecutiveDays = 1;
    }
    
    await updatedUserPoints.save();
    
    // Record game session
    try {
      const gameSession = new GameSession({
        userId: req.user._id,
        sessionId: `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        coinIndex: coinIndex,
        pointsEarned: pointsEarned,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent')
      });
      await gameSession.save();
    } catch (sessionError) {
      console.error("Error recording game session:", sessionError);
      // Don't fail the request if session recording fails
    }
    
    res.status(200).json({
      success: true,
      points: pointsEarned,
      totalPoints: updatedUserPoints.totalPoints,
      prizeEarned: false, // Simplified for now
      prizeName: undefined,
      message: `You earned ${pointsEarned} points!`
    });
    
  } catch (error) {
    console.error("Error tapping coin:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process coin tap"
    });
  }
});

// GET /api/game/prizes
router.get("/prizes", authenticateToken, async (req, res) => {
  try {
    const userPoints = await UserPoints.findOne({ userId: req.user._id });
    const prizes = await Prize.find({ isActive: true }).sort({ pointsThreshold: 1 });
    
    res.json({
      success: true,
      data: {
        earnedPrizes: userPoints?.prizesEarned || [],
        availablePrizes: prizes
      }
    });
  } catch (error) {
    console.error("Error fetching prizes:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch prizes"
    });
  }
});

export default router;