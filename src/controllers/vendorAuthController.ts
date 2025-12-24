import { Request,Response } from "express";
import User, { IUser } from "../models/User.js";
import { generateOtp } from "../utils/generateOtp.js";
import { sendEmail } from "../utils/sendEmail.js";
import { AuthRequest, generateToken } from "./authController.js";
import bcrypt from "bcryptjs";

// ================= VENDOR LOGIN =================
export const vendorLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email, role: "admin" });
  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  // 🔐 Generate OTP
  const otp = generateOtp();
  user.adminOtp = await bcrypt.hash(otp, 10);
  user.adminOtpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 min

  await user.save();

  // 📧 Send Email
  await sendEmail(
    user.email,
    "Vendor Verification Code",
    `<h2>Your Vendor verification code</h2>
     <h1>${otp}</h1>
     <p>Expires in 5 minutes</p>`
  );

  res.json({
    success: true,
    message: "Verification code sent to email"
  });
};

// ================= VENDOR PROFILE =================

export const getVendorProfile = async (req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    user: req.user
  });
};

// ================= VERIFY VENDOR OTP =================
export const verifyVendorOtp = async (req: Request, res: Response) => {
  const { email, otp } = req.body;

  const user = await User.findOne({ email, role: "admin" });
  if (!user || !user.adminOtp || !user.adminOtpExpires) {
    return res.status(400).json({ success: false, message: "Invalid request" });
  }

  if (user.adminOtpExpires < new Date()) {
    return res.status(400).json({ success: false, message: "OTP expired" });
  }

  const isValid = await bcrypt.compare(otp, user.adminOtp);
  if (!isValid) {
    return res.status(400).json({ success: false, message: "Invalid OTP" });
  }

  // ✅ Clear OTP
  user.adminOtp = undefined;
  user.adminOtpExpires = undefined;
  await user.save();

  // 🔐 FINAL JWT
  const token = generateToken(user._id.toString(), user.role);

  res.json({
    success: true,
    data: { token }
  });
};
