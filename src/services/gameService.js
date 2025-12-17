import GameSession from "../models/GameSession.js";
import PointsService from "./pointsService.js";

class GameService {
  // Generate random points with weighted distribution
  generateRandomPoints() {
    const random = Math.random();
    
    // Weighted distribution:
    // - 50% chance: 1-100 points
    // - 30% chance: 101-500 points  
    // - 15% chance: 501-800 points
    // - 5% chance: 801-1000 points
    
    if (random < 0.5) {
      return Math.floor(Math.random() * 100) + 1;
    } else if (random < 0.8) {
      return Math.floor(Math.random() * 400) + 101;
    } else if (random < 0.95) {
      return Math.floor(Math.random() * 300) + 501;
    } else {
      return Math.floor(Math.random() * 200) + 801;
    }
  }

  // Record game session
  async recordGameSession(userId, coinIndex, pointsEarned, req) {
    try {
      const session = new GameSession({
        userId,
        sessionId: this.generateSessionId(),
        coinIndex,
        pointsEarned,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent')
      });

      await session.save();
      return session;
    } catch (error) {
      console.error("Session recording error:", error);
      // Don't throw error - session recording is optional
    }
  }

  // Generate unique session ID
  generateSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Process coin tap
  async processCoinTap(userId, coinIndex, req) {
    try {
      // Check if user can tap
      const tapStatus = await PointsService.canUserTap(userId);
      if (!tapStatus.canTap) {
        return {
          success: false,
          message: "You can only tap one coin every 24 hours. Please come back tomorrow!",
          nextAvailableTime: tapStatus.nextAvailableTime
        };
      }

      // Generate random points
      const pointsEarned = this.generateRandomPoints();
      
      // Add points and check prizes
      const pointsResult = await PointsService.addPoints(userId, pointsEarned);
      
      // Record game session
      await this.recordGameSession(userId, coinIndex, pointsEarned, req);
      
      return {
        success: true,
        points: pointsEarned,
        totalPoints: pointsResult.userPoints.totalPoints,
        prizeEarned: pointsResult.newPrizes.length > 0,
        prizeName: pointsResult.newPrizes.length > 0 ? pointsResult.newPrizes[0].name : undefined,
        message: `You earned ${pointsEarned} points!`
      };
      
    } catch (error) {
      throw new Error(`Failed to process coin tap: ${error.message}`);
    }
  }
}

export default new GameService();