import { Request, Response } from "express";
import User, { IUser } from "../models/User.js";
import { generateOtp } from "../utils/generateOtp.js";
import { sendEmail } from "../utils/sendEmail.js";
import { AuthRequest, generateToken } from "./authController.js";
import bcrypt from "bcryptjs";

// ================= VENDOR LOGIN =================
export const vendorLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email, role: { $in: ["user", "admin"] } });
  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }


  const COOLDOWN_MINUTES = 1;
  if (user.adminOtpSentAt) {
    const elapsed = Date.now() - new Date(user.adminOtpSentAt).getTime();
    if (elapsed < COOLDOWN_MINUTES * 60 * 1000) {
      const minutesLeft = Math.ceil(
        (COOLDOWN_MINUTES * 60 * 1000 - elapsed) / (60 * 1000)
      );
      return res.status(429).json({
        success: false,
        message: `OTP already sent. Try again in ${minutesLeft} minute(s).`,
      });
    }
  }

  // 🔐 Generate OTP
  const otp = generateOtp();
  user.adminOtp = await bcrypt.hash(otp, 10);
  user.adminOtpExpires = new Date(Date.now() + 1 * 60 * 1000); // 5 min
  user.adminOtpSentAt = new Date();

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
    message: "Verification code sent to email",
  });
};

// ================= RESEND VENDOR OTP (no password) =================
export const resendVendorOtp = async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ success: false, message: "Email required" });

  const user = await User.findOne({ email, role: "admin" });
  if (!user)
    return res.status(404).json({ success: false, message: "User not found" });

  const COOLDOWN_MINUTES = 1;
  if (user.adminOtpSentAt) {
    const elapsed = Date.now() - new Date(user.adminOtpSentAt).getTime();
    if (elapsed < COOLDOWN_MINUTES * 60 * 1000) {
      const msLeft = COOLDOWN_MINUTES * 60 * 1000 - elapsed;
      return res
        .status(429)
        .json({ success: false, message: `OTP already sent`, msLeft });
    }
  }

  const otp = generateOtp();
  user.adminOtp = await bcrypt.hash(otp, 10);
  user.adminOtpExpires = new Date(Date.now() + 1*60*1000); // 5 min
  user.adminOtpSentAt = new Date();
  await user.save();

  await sendEmail(
    user.email,
    "Vendor Verification Code",
    `<h2>Your Vendor verification code</h2>
     <h1>${otp}</h1>
     <p>Expires in 5 minutes</p>`
  );

  res.json({ success: true, message: "Verification code sent to email" });
};

// ================= VENDOR OTP STATUS =================
export const vendorOtpStatus = async (req: Request, res: Response) => {
  const email = (req.query.email as string) || "";
  if (!email)
    return res.status(400).json({ success: false, message: "Email required" });

  const user = await User.findOne({ email, role: "admin" });
  if (!user)
    return res.status(404).json({ success: false, message: "User not found" });

  const COOLDOWN_MINUTES = 1;
  if (!user.adminOtpSentAt)
    return res.json({ success: true, canResend: true, msLeft: 0 });

  const elapsed = Date.now() - new Date(user.adminOtpSentAt).getTime();
  const msLeft = Math.max(0, COOLDOWN_MINUTES * 60 * 1000 - elapsed);
  res.json({ success: true, canResend: msLeft === 0, msLeft });
};

// ================= VENDOR PROFILE =================

export const getVendorProfile = async (req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    user: req.user,
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
  user.adminOtpSentAt = undefined;
  await user.save();

  // 🔐 FINAL JWT
  const token = generateToken(user._id.toString(), user.role);

  res.json({
    success: true,
    data: { token },
  });
};
