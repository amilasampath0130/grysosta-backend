import { Request, Response } from "express";
import User from "../models/User.js";
import { generateOtp } from "../utils/generateOtp.js";
import { sendEmail } from "../utils/sendEmail.js";
import { AuthRequest, generateToken } from "./authController.js";
import bcrypt from "bcryptjs";

/* =====================================================
   CONFIG
===================================================== */

const OTP_EXPIRY_MINUTES = 5;
const OTP_COOLDOWN_MINUTES = 1;

/* =====================================================
   VENDOR LOGIN (PASSWORD → OTP)
===================================================== */

export const vendorLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email and password required" });
  }

  const user = await User.findOne({ email });
  if (!user || user.role !== "vendor") {
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

  // ⏱ Cooldown
  if (user.adminOtpSentAt) {
    const elapsed = Date.now() - user.adminOtpSentAt.getTime();
    if (elapsed < OTP_COOLDOWN_MINUTES * 60 * 1000) {
      const msLeft = OTP_COOLDOWN_MINUTES * 60 * 1000 - elapsed;
      return res.status(429).json({
        success: false,
        message: "OTP already sent",
        msLeft,
      });
    }
  }

  // 🔐 Generate OTP
  const otp = generateOtp();
  user.adminOtp = await bcrypt.hash(otp, 10);
  user.adminOtpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  user.adminOtpSentAt = new Date();
  await user.save();

  await sendEmail(
    user.email,
    "Vendor Login Verification",
    `<h2>Your vendor login code</h2>
     <h1>${otp}</h1>
     <p>Expires in ${OTP_EXPIRY_MINUTES} minutes</p>`,
  );

  res.json({ success: true, message: "Verification code sent" });
};

/* =====================================================
   RESEND VENDOR OTP
===================================================== */

export const resendVendorOtp = async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ success: false, message: "Email required" });

  const user = await User.findOne({ email });
  if (!user || user.role !== "vendor") {
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });
  }

  if (user.adminOtpSentAt) {
    const elapsed = Date.now() - user.adminOtpSentAt.getTime();
    if (elapsed < OTP_COOLDOWN_MINUTES * 60 * 1000) {
      return res.status(429).json({
        success: false,
        message: "OTP already sent",
        msLeft: OTP_COOLDOWN_MINUTES * 60 * 1000 - elapsed,
      });
    }
  }

  const otp = generateOtp();
  user.adminOtp = await bcrypt.hash(otp, 10);
  user.adminOtpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  user.adminOtpSentAt = new Date();
  await user.save();

  await sendEmail(
    user.email,
    "Vendor Login Verification",
    `<h2>Your vendor login code</h2>
     <h1>${otp}</h1>
     <p>Expires in ${OTP_EXPIRY_MINUTES} minutes</p>`,
  );

  res.json({ success: true, message: "Verification code resent" });
};

/* =====================================================
   OTP STATUS
===================================================== */

export const vendorOtpStatus = async (req: Request, res: Response) => {
  const email = String(req.query.email || "");
  if (!email)
    return res.status(400).json({ success: false, message: "Email required" });

  const user = await User.findOne({ email });
  if (!user)
    return res.status(404).json({ success: false, message: "User not found" });

  if (!user.adminOtpSentAt) {
    return res.json({ success: true, canResend: true, msLeft: 0 });
  }

  const elapsed = Date.now() - user.adminOtpSentAt.getTime();
  const msLeft = Math.max(0, OTP_COOLDOWN_MINUTES * 60 * 1000 - elapsed);

  res.json({ success: true, canResend: msLeft === 0, msLeft });
};

/* =====================================================
   VERIFY VENDOR OTP
===================================================== */

export const verifyVendorOtp = async (req: Request, res: Response) => {
  const { email, otp } = req.body;

  const user = await User.findOne({ email });
  if (!user || !user.adminOtp || !user.adminOtpExpires) {
    return res.status(400).json({
      success: false,
      message: "No OTP found. Please request a new code.",
    });
  }

  if (user.adminOtpExpires < new Date()) {
    return res.status(400).json({ success: false, message: "OTP expired" });
  }

  const valid = await bcrypt.compare(otp, user.adminOtp);
  if (!valid) {
    return res.status(400).json({ success: false, message: "Invalid OTP" });
  }

  // Clear OTP atomically to avoid potential validation/save issues
  try {
    await User.updateOne(
      { _id: user._id },
      { $unset: { adminOtp: "", adminOtpExpires: "", adminOtpSentAt: "" } },
    );
  } catch (err) {
    console.error("Vendor OTP clear error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to finalize verification. Please try again.",
    });
  }

  const token = generateToken(user._id.toString(), user.role);

  res.cookie("auth-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ success: true, message: "Login successful" });
};

/* =====================================================
   VENDOR PROFILE
===================================================== */

export const getVendorProfile = async (req: AuthRequest, res: Response) => {
  res.json({ success: true, user: req.user });
};

/* =====================================================
   SUBMIT VENDOR INFO
===================================================== */

export const submitVendorInfo = async (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (!user)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  const {
    businessName,
    businessAddress,
    businessPhoneNumber,
    firstName,
    middleName,
    lastName,
  } = req.body;

  const vendorInfo = {
    businessName,
    ownerName: `${firstName} ${middleName || ""} ${lastName}`.trim(),
    phone: businessPhoneNumber,
    address: businessAddress,
  };

  try {
    await User.updateOne(
      { _id: user._id },
      { $set: { vendorInfo, vendorStatus: "PENDING" } },
    );
  } catch (err) {
    console.error("Submit vendor info error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to submit vendor information. Please try again.",
    });
  }

  res.json({
    success: true,
    message: "Vendor application submitted for review",
  });
};

/* =====================================================
   APPROVE / REJECT VENDOR (ADMIN)
===================================================== */

export const approveVendor = async (req: AuthRequest, res: Response) => {
  const vendor = await User.findById(req.params.vendorId);
  if (!vendor)
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });

  vendor.role = "vendor";
  vendor.vendorStatus = "APPROVED";
  vendor.vendorApproval = {
    approvedAt: new Date(),
    approvedBy: req.user!._id,
  };

  await vendor.save();

  await sendEmail(
    vendor.email,
    "Vendor Application Approved",
    "<h2>Your vendor account has been approved</h2>",
  );

  res.json({ success: true, message: "Vendor approved" });
};

export const rejectVendor = async (req: AuthRequest, res: Response) => {
  const vendor = await User.findById(req.params.vendorId);
  if (!vendor)
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });

  vendor.vendorStatus = "REJECTED";
  await vendor.save();

  await sendEmail(
    vendor.email,
    "Vendor Application Update",
    `<p>${req.body.reason || "Please update your details"}</p>`,
  );

  res.json({ success: true, message: "Vendor rejected" });
};
