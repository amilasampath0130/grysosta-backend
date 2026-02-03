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
const VENDOR_SESSION_MINUTES = 30;

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
  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  // // Debug: log key user flags to help diagnose login issues
  // console.debug("vendorLogin: user found", {
  //   email: user.email,
  //   role: user.role,
  //   vendorStatus: user.vendorStatus,
  //   isVerified: user.isVerified,
  //   hasPassword: !!user.password,
  // });

  // Allow mobile users and vendors to start vendor onboarding (but not admins).
  if (user.role === "admin") {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  // Explicitly block rejected vendor applications
  if (user.vendorStatus === "REJECTED") {
    return res.status(403).json({
      success: false,
      message: "Vendor account rejected",
      vendorStatus: "REJECTED",
      canResubmit: true,
      rejectionReason: user.vendorRejectionReason || null,
    });
  }

  if (!user.isVerified) {
    return res.status(403).json({
      success: false,
      message: "Account not verified",
    });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    console.debug("vendorLogin: password mismatch for", user.email);
    return res
      .status(401)
      .json({ success: false, message: "Invalid email or password" });
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
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
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

  const token = generateToken(
    user._id.toString(),
    user.role,
    `${VENDOR_SESSION_MINUTES}m`,
  );

  res.cookie("auth-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: VENDOR_SESSION_MINUTES * 60 * 1000,
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
   VENDOR LOGOUT
===================================================== */

export const vendorLogout = async (req: Request, res: Response) => {
  try {
    res.clearCookie("auth-token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Vendor logout error:", error);
    res.status(500).json({ success: false, message: "Logout failed" });
  }
};

/* =====================================================
   SUBMIT VENDOR INFO
===================================================== */

export const submitVendorInfo = async (req: AuthRequest, res: Response) => {
  // Allow submission either when authenticated (req.user) or when providing an email
  const authUser = req.user as any | undefined;
  const {
    businessName,
    businessAddress,
    businessPhoneNumber,
    firstName,
    middleName,
    lastName,
    email,
  } = req.body as any;

  let targetUser = authUser;
  try {
    if (!targetUser) {
      if (!email)
        return res.status(400).json({
          success: false,
          message: "Email required for unauthenticated submission",
        });
      targetUser = await User.findOne({ email });
      if (!targetUser)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
    }

    if (targetUser.role === "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admins cannot submit vendor info" });
    }

    if (!targetUser.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Account not verified",
      });
    }

    const vendorInfo = {
      businessName,
      ownerName: `${firstName} ${middleName || ""} ${lastName}`.trim(),
      phone: businessPhoneNumber,
      address: businessAddress,
    };

    // Clear previous rejection reason when resubmitting
    await User.updateOne(
      { _id: targetUser._id },
      {
        $set: { vendorInfo, vendorStatus: "PENDING" },
        $unset: { vendorRejectionReason: "" },
      },
    );

    res.json({
      success: true,
      message: "Vendor application submitted for review",
    });
  } catch (err) {
    console.error("Submit vendor info error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to submit vendor information. Please try again.",
    });
  }
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

  try {
    await sendEmail(
      vendor.email,
      "Vendor Application Approved",
      "<h2>Your vendor account has been approved</h2>",
    );
  } catch (err) {
    console.error("Approve vendor email failed:", err);
  }

  res.json({ success: true, message: "Vendor approved" });
};

export const rejectVendor = async (req: AuthRequest, res: Response) => {
  const vendor = await User.findById(req.params.vendorId);
  if (!vendor)
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });

  const reason =
    req.body.reason ||
    "Please update your details and resubmit your documents.";
  vendor.vendorStatus = "REJECTED";
  vendor.vendorRejectionReason = reason;
  await vendor.save();

  try {
    const clientUrl =
      process.env.CLIENT_URL || "https://your-frontend.example.com";
    const onboardingLink = `${clientUrl.replace(/\/$/, "")}/vendor/onboarding`;
    const reason =
      req.body.reason ||
      "Please update your details and resubmit your documents.";

    await sendEmail(
      vendor.email,
      "Vendor Application Rejected",
      `<h2>Your vendor application was rejected</h2>
       <p>Reason: ${reason}</p>
       <p>Please update your information and resubmit your application by visiting <a href="${onboardingLink}">the onboarding page</a>.</p>`,
    );
  } catch (err) {
    console.error("Reject vendor email failed:", err);
  }

  res.json({ success: true, message: "Vendor rejected" });
};

/* =====================================================
   LIST VENDORS (ADMIN)
===================================================== */

export const getPendingVendors = async (req: AuthRequest, res: Response) => {
  const vendors = await User.find({ vendorStatus: "PENDING" }).select(
    "name email vendorInfo createdAt role",
  );
  res.json({ success: true, vendors });
};

export const getApprovedVendors = async (req: AuthRequest, res: Response) => {
  const vendors = await User.find({
    vendorStatus: "APPROVED",
    role: "vendor",
  }).select("name email vendorInfo vendorApproval role");
  res.json({ success: true, vendors });
};
