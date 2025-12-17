import mongoose from "mongoose";

const gameSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  coinIndex: {
    type: Number,
    required: true,
    min: 0,
    max: 4
  },
  pointsEarned: {
    type: Number,
    required: true,
    min: 1,
    max: 1000
  },
  ipAddress: {
    type: String,
    required: true
  },
  userAgent: String,
  isPrizeEarned: {
    type: Boolean,
    default: false
  },
  prizeName: String
}, {
  timestamps: true
});

// Compound index for user and time-based queries
gameSessionSchema.index({ userId: 1, createdAt: -1 });
gameSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model('GameSession', gameSessionSchema);