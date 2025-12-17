import mongoose from "mongoose";

const verificationCodeSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  code: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['email_verification', 'password_reset'],
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: '15m' } // Auto delete after 15 minutes
  },
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 5
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
verificationCodeSchema.index({ email: 1, type: 1 });

export default mongoose.model('VerificationCode', verificationCodeSchema);