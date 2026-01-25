import { Request, Response } from "express";
import User, { IUser } from "../models/User.js";
import { generateOtp } from "../utils/generateOtp.js";
import { sendEmail } from "../utils/sendEmail.js";
import { AuthRequest, generateToken } from "./authController.js";
import bcrypt from "bcryptjs";

// ================= ADMIN LOGIN =================
export const adminLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email, role: "admin" });
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

  // Enforce resend cooldown (30 minutes)
  const COOLDOWN_MINUTES = 30;
  if (user.adminOtpSentAt) {
    const elapsed = Date.now() - new Date(user.adminOtpSentAt).getTime();
    if (elapsed < COOLDOWN_MINUTES * 60 * 1000) {
      const minutesLeft = Math.ceil(
        (COOLDOWN_MINUTES * 60 * 1000 - elapsed) / (60 * 1000),
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
  user.adminOtpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 min
  user.adminOtpSentAt = new Date();

  await user.save();

  // 📧 Send Email
  await sendEmail(
    user.email,
    "Admin Verification Code",
    `<h2>Your admin verification code</h2>
     <h1>${otp}</h1>
     <p>Expires in 5 minutes</p>`,
  );

  res.json({
    success: true,
    message: "Verification code sent to email",
  });
};

// ================= RESEND ADMIN OTP (no password) =================
export const resendAdminOtp = async (req: Request, res: Response) => {
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
  user.adminOtpExpires = new Date(Date.now() + 60 * 1000); // 1 min
  user.adminOtpSentAt = new Date();
  await user.save();

  await sendEmail(
    user.email,
    "Admin Verification Code",
    `<h2>Your admin verification code</h2>
     <h1>${otp}</h1>
     <p>Expires in 5 minutes</p>`,
  );

  res.json({ success: true, message: "Verification code sent to email" });
};

// ================= ADMIN OTP STATUS =================
export const adminOtpStatus = async (req: Request, res: Response) => {
  const email = (req.query.email as string) || "";
  if (!email)
    return res.status(400).json({ success: false, message: "Email required" });

  const user = await User.findOne({ email, role: "admin" });
  if (!user)
    return res.status(404).json({ success: false, message: "User not found" });

  const COOLDOWN_MINUTES = 30;
  if (!user.adminOtpSentAt)
    return res.json({ success: true, canResend: true, msLeft: 0 });

  const elapsed = Date.now() - new Date(user.adminOtpSentAt).getTime();
  const msLeft = Math.max(0, COOLDOWN_MINUTES * 60 * 1000 - elapsed);
  res.json({ success: true, canResend: msLeft === 0, msLeft });
};

// ================= ADMIN PROFILE =================

export const getAdminProfile = async (req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    user: req.user,
  });
};

// ================= GET ALL USERS =================
export const getAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    const users = await User.find().select("-password"); // 🔒 exclude password

    res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
};

// ================= VERIFY ADMIN OTP =================
export const verifyAdminOtp = async (req: Request, res: Response) => {
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

// ================= GET ALL ADMINS =================
export const getAllAdmins = async (req: AuthRequest, res: Response) => {
  try {
    const admins = await User.find({ role: "admin" }).select(
      "name email createdAt",
    );
    res.json({ success: true, admins });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
