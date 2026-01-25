import mongoose, { Document, Types } from "mongoose";
import bcrypt from "bcryptjs";

/* =======================
   Interfaces
======================= */

export interface IUser extends Document {
  _id: Types.ObjectId;

  // Basic user info
  name: string;
  username: string;
  email: string;
  password: string;
  mobileNumber?: string;
  profileImage?: string;

  // Auth & role
  role: "user" | "admin" | "vendor";
  isVerified: boolean;
  authProvider: "local" | "google";

  // Admin OTP (admin login flow)
  adminOtp?: string;
  adminOtpExpires?: Date;
  adminOtpSentAt?: Date;

  // Vendor onboarding flow
  vendorStatus?: "NEW" | "PENDING" | "APPROVED" | "REJECTED";
  vendorInfo?: {
    businessName: string;
    ownerName: string;
    phone: string;
    address: string;
  };
  vendorApproval?: {
    approvedAt?: Date;
    approvedBy?: Types.ObjectId;
  };

  // Methods
  comparePassword(password: string): Promise<boolean>;
}

/* =======================
   Sub Schemas
======================= */

// Vendor information (submitted by vendor)
const vendorInfoSchema = new mongoose.Schema(
  {
    businessName: { type: String },
    ownerName: { type: String },
    phone: { type: String },
    address: { type: String },
  },
  { _id: false },
);

// Vendor approval metadata (admin side)
const vendorApprovalSchema = new mongoose.Schema(
  {
    approvedAt: { type: Date },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { _id: false },
);

/* =======================
   Main User Schema
======================= */

const userSchema = new mongoose.Schema<IUser>(
  {
    // Basic fields
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    mobileNumber: { type: String },
    profileImage: { type: String },

    // Auth
    role: {
      type: String,
      enum: ["user", "admin", "vendor"],
      default: "user",
    },

    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },

    isVerified: {
      type: Boolean,
      default: true, // email already verified via OTP flow
    },

    // Admin OTP
    adminOtp: { type: String },
    adminOtpExpires: { type: Date },
    adminOtpSentAt: { type: Date },

    // Vendor flow
    vendorStatus: {
      type: String,
      enum: ["NEW", "PENDING", "APPROVED", "REJECTED"],
      default: function () {
        return this.role === "vendor" ? "NEW" : undefined;
      },
    },

    vendorInfo: vendorInfoSchema,
    vendorApproval: vendorApprovalSchema,
  },
  { timestamps: true },
);

/* =======================
   Hooks
======================= */

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || this.authProvider === "google") {
    return next();
  }

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/* =======================
   Methods
======================= */

userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

/* =======================
   Export
======================= */

export default mongoose.model<IUser>("User", userSchema);
