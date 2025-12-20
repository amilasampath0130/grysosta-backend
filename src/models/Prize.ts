import mongoose from "mongoose";

const prizeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String,
    required: true
  },
  pointsThreshold: {
    type: Number,
    required: true,
    unique: true
  },
  prizeType: {
    type: String,
    enum: ['badge', 'coupon', 'feature', 'physical'],
    required: true
  },
  imageUrl: String,
  isActive: {
    type: Boolean,
    default: true
  },
  totalRedeemed: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

export default mongoose.model('Prize', prizeSchema);