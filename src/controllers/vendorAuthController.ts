import { Request, Response } from "express";
import User, { IUser } from "../models/User.js";
import { generateOtp } from "../utils/generateOtp.js";
import { sendEmail } from "../utils/sendEmail.js";
import { AuthRequest, generateToken } from "./authController.js";
import bcrypt from "bcryptjs";

// ================= VENDOR LOGIN =================
export const vendorLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await User.findOne({
    email,
    role: { $in: ["user", "admin", "vendor"] },
  });
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
  user.adminOtpExpires = new Date(Date.now() + 1 * 60 * 1000); // 5 min
  user.adminOtpSentAt = new Date();

  await user.save();

  // 📧 Send Email
  await sendEmail(
    user.email,
    "Vendor Verification Code",
    `<h2>Your Vendor verification code</h2>
     <h1>${otp}</h1>
     <p>Expires in 5 minutes</p>`,
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
  user.adminOtpExpires = new Date(Date.now() + 1 * 60 * 1000); // 5 min
  user.adminOtpSentAt = new Date();
  await user.save();

  await sendEmail(
    user.email,
    "Vendor Verification Code",
    `<h2>Your Vendor verification code</h2>
     <h1>${otp}</h1>
     <p>Expires in 5 minutes</p>`,
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

  // Set httpOnly cookie
  res.cookie("auth-token", token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    domain: "localhost",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  res.json({
    success: true,
    message: "Login successful",
  });
};

// ================= VENDOR LOGOUT =================
export const vendorLogout = async (req: Request, res: Response) => {
  res.clearCookie("auth-token", { domain: "localhost" });
  res.json({ success: true, message: "Logged out successfully" });
};

// ================= SUBMIT VENDOR INFO =================
export const submitVendorInfo = async (req: AuthRequest, res: Response) => {
  const {
    firstName,
    middleName,
    lastName,
    address,
    city,
    state,
    zipCode,
    businessName,
    businessType,
    businessCategory,
    businessAddress,
    typeOfOffering,
    businessPhoneNumber,
    email,
    phoneNumber,
  } = req.body;

  const user = req.user;
  if (!user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  // Update user with vendor info
  user.vendorInfo = {
    businessName,
    ownerName: `${firstName} ${middleName} ${lastName}`.trim(),
    phone: businessPhoneNumber || phoneNumber,
    address: businessAddress || address,
  };

  user.vendorStatus = "PENDING";

  await user.save();

  // TODO: Send email to admin about new application

  res.json({
    success: true,
    message: "Application submitted successfully. Please wait for approval.",
  });
};

// ================= APPROVE VENDOR =================
export const approveVendor = async (req: AuthRequest, res: Response) => {
  const { vendorId } = req.params;

  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const vendor = await User.findById(vendorId);
  if (!vendor || vendor.role !== "user") {
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });
  }

  vendor.vendorStatus = "APPROVED";
  vendor.role = "vendor"; // Change role to vendor
  vendor.vendorApproval = {
    approvedAt: new Date(),
    approvedBy: req.user._id,
  };

  await vendor.save();

  // Send approval email
  await sendEmail(
    vendor.email,
    "Vendor Application Approved",
    `<h2>Congratulations!</h2>
     <p>Your vendor application has been approved. You can now login to your vendor dashboard.</p>`,
  );

  res.json({ success: true, message: "Vendor approved successfully" });
};

// ================= REJECT VENDOR =================
export const rejectVendor = async (req: AuthRequest, res: Response) => {
  const { vendorId } = req.params;
  const { reason } = req.body;

  const vendor = await User.findById(vendorId);
  if (!vendor || vendor.role !== "user") {
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });
  }

  vendor.vendorStatus = "REJECTED";

  await vendor.save();

  // Send rejection email
  await sendEmail(
    vendor.email,
    "Vendor Application Update",
    `<h2>Application Needs Revision</h2>
     <p>Your vendor application has been reviewed and needs some changes:</p>
     <p>${reason || "Please provide more accurate information."}</p>
     <p>Please login and resubmit your application.</p>`,
  );

  res.json({ success: true, message: "Vendor rejected. Notification sent." });
};

// ================= GET PENDING VENDORS =================
export const getPendingVendors = async (req: AuthRequest, res: Response) => {
  const vendors = await User.find({
    role: "user",
    vendorStatus: "PENDING",
  }).select("name email vendorInfo createdAt");

  res.json({ success: true, vendors });
};

// ================= GET APPROVED VENDORS =================
export const getApprovedVendors = async (req: AuthRequest, res: Response) => {
  const vendors = await User.find({
    role: "vendor",
    vendorStatus: "APPROVED",
  }).select("name email vendorInfo vendorApproval");

  res.json({ success: true, vendors });
};
