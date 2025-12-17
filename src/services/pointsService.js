import UserPoints from "../models/UserPoints.js";
import Prize from "../models/Prize.js";

class PointsService {
  // Initialize user points record
  async initializeUserPoints(userId) {
    try {
      const existingPoints = await UserPoints.findOne({ userId });
      if (!existingPoints) {
        const userPoints = new UserPoints({ userId });
        await userPoints.save();
        return userPoints;
      }
      return existingPoints;
    } catch (error) {
      throw new Error(`Failed to initialize user points: ${error.message}`);
    }
  }

  // Get user points
  async getUserPoints(userId) {
    try {
      let userPoints = await UserPoints.findOne({ userId });
      
      if (!userPoints) {
        userPoints = await this.initializeUserPoints(userId);
      }
      
      return userPoints;
    } catch (error) {
      throw new Error(`Failed to get user points: ${error.message}`);
    }
  }

  // Add points to user
  async addPoints(userId, pointsEarned) {
    try {
      let userPoints = await UserPoints.findOne({ userId });
      
      if (!userPoints) {
        userPoints = new UserPoints({ userId });
      }

      // Update points
      userPoints.totalPoints += pointsEarned;
      userPoints.lifetimePoints += pointsEarned;
      userPoints.lastTapTime = new Date();
      
      // Check for consecutive days
      const now = new Date();
      const lastTap = userPoints.lastTapTime;
      
      if (lastTap) {
        const daysDiff = Math.floor((now - new Date(lastTap)) / (1000 * 60 * 60 * 24));
        if (daysDiff === 1) {
          userPoints.consecutiveDays += 1;
        } else if (daysDiff > 1) {
          userPoints.consecutiveDays = 1;
        }
      } else {
        userPoints.consecutiveDays = 1;
      }

      // Check for prizes
      const newPrizes = await this.checkForPrizes(userPoints);
      
      await userPoints.save();
      
      return {
        userPoints,
        newPrizes,
        pointsEarned
      };
      
    } catch (error) {
      throw new Error(`Failed to add points: ${error.message}`);
    }
  }

  // Check if user earned any new prizes
  async checkForPrizes(userPoints) {
    try {
      const prizes = await Prize.find({
        pointsThreshold: { $lte: userPoints.totalPoints },
        isActive: true
      });

      const newPrizes = [];
      
      for (const prize of prizes) {
        const alreadyEarned = userPoints.prizesEarned.some(
          earned => earned.prizeId && earned.prizeId.toString() === prize._id.toString()
        );
        
        if (!alreadyEarned) {
          userPoints.prizesEarned.push({
            prizeId: prize._id,
            prizeName: prize.name,
            pointsThreshold: prize.pointsThreshold
          });
          
          newPrizes.push(prize);
          
          // Update prize redemption count
          prize.totalRedeemed += 1;
          await prize.save();
        }
      }
      
      return newPrizes;
    } catch (error) {
      throw new Error(`Failed to check prizes: ${error.message}`);
    }
  }

  // Check if user can tap (24-hour cooldown)
  async canUserTap(userId) {
    try {
      const userPoints = await this.getUserPoints(userId);
      
      if (!userPoints.lastTapTime) {
        return { canTap: true };
      }
      
      const now = new Date();
      const lastTap = new Date(userPoints.lastTapTime);
      const hoursSinceLastTap = (now - lastTap) / (1000 * 60 * 60);
      
      const canTap = hoursSinceLastTap >= 24;
      const nextAvailableTime = canTap ? null : new Date(lastTap.getTime() + 24 * 60 * 60 * 1000);
      
      return {
        canTap,
        nextAvailableTime,
        hoursUntilNextTap: canTap ? 0 : Math.ceil(24 - hoursSinceLastTap)
      };
    } catch (error) {
      throw new Error(`Failed to check tap availability: ${error.message}`);
    }
  }
}

export default new PointsService();