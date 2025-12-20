import mongoose, { Document, Types } from "mongoose";

import bcrypt from "bcryptjs";

export interface IUser extends Document {
 _id: Types.ObjectId;   
  name: string;
  username: string;
  email: string;
  password: string;
  mobileNumber?: string;
  profileImage?: string;
  isVerified: boolean;
  authProvider: "local" | "google";
  comparePassword(password: string): Promise<boolean>;
}

const userSchema = new mongoose.Schema<IUser>(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    mobileNumber: String,
    profileImage: String,
    isVerified: {
      type: Boolean,
      default: true // ✅ always true now
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local"
    }
  },
  { timestamps: true }
);

// Hash password
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || this.authProvider === "google") {
    return next();
  }

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model<IUser>("User", userSchema);
