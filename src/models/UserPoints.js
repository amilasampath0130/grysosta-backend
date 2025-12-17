import mongoose from "mongoose";

const userPointsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true // This creates an index automatically
  },
  totalPoints: {
    type: Number,
    default: 0
  },
  lifetimePoints: {
    type: Number,
    default: 0
  },
  consecutiveDays: {
    type: Number,
    default: 0
  },
  lastTapTime: {
    type: Date,
    default: null
  },
  prizesEarned: [{
    prizeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prize"
    },
    earnedAt: {
      type: Date,
      default: Date.now
    },
    prizeName: String,
    pointsCost: Number
  }]
}, {
  timestamps: true
});

// Remove this if you have it - it's duplicate with the unique: true above
// userPointsSchema.index({ userId: 1 });

export default mongoose.model("UserPoints", userPointsSchema);