import Prize from "../models/Prize.js";
import UserPoints from "../models/UserPoints.js";

class PrizeService {
  // Initialize default prizes
  async initializeDefaultPrizes() {
    const defaultPrizes = [
      {
        name: "Bronze Collector",
        description: "Earned your first 100 points!",
        pointsThreshold: 100,
        prizeType: "badge",
        imageUrl: "/images/badges/bronze.png"
      },
      {
        name: "Silver Explorer",
        description: "Reached 500 points milestone!",
        pointsThreshold: 500,
        prizeType: "badge", 
        imageUrl: "/images/badges/silver.png"
      },
      {
        name: "Gold Master",
        description: "Achieved 1000 points! You're a true champion!",
        pointsThreshold: 1000,
        prizeType: "badge",
        imageUrl: "/images/badges/gold.png"
      }
    ];

    for (const prizeData of defaultPrizes) {
      const existingPrize = await Prize.findOne({ 
        pointsThreshold: prizeData.pointsThreshold 
      });
      
      if (!existingPrize) {
        await Prize.create(prizeData);
        console.log(`Created prize: ${prizeData.name}`);
      }
    }
  }

  // Get all active prizes
  async getActivePrizes() {
    return await Prize.find({ isActive: true }).sort({ pointsThreshold: 1 });
  }

  // Get user's earned prizes
  async getUserPrizes(userId) {
    const userPoints = await UserPoints.findOne({ userId })
      .populate('prizesEarned.prizeId');
    
    return userPoints ? userPoints.prizesEarned : [];
  }
}

export default new PrizeService();