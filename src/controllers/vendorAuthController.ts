import { Request, Response } from "express";
import User from "../models/User.js";
import { generateOtp } from "../utils/generateOtp.js";
import { sendEmail } from "../utils/sendEmail.js";
import { AuthRequest, generateToken } from "./authController.js";
import bcrypt from "bcryptjs";
import {
  uploadImageBufferToCloudinary,
} from "../lib/cloudinary.js";
import { imageSize } from "image-size";
import { buildVendorPlanSnapshot } from "../lib/vendorBilling.js";
import {
  OTP_EXPIRY_MS,
  assignOtpToUser,
  clearOtpFromUser,
  formatOtpDelay,
  getOtpMsLeft,
  remainingOtpAttempts,
} from "../lib/otpPolicy.js";

/* =====================================================
   CONFIG
===================================================== */

const VENDOR_SESSION_MINUTES = 30;

const splitPossibleUrls = (value: unknown): string[] => {
  const raw = String(value || "").trim();
  if (!raw) return [];

  return raw
    .split(/(?=https?:\/\/)/i)
    .map((part) => part.trim())
    .filter(Boolean);
};

const normalizeBaseOrigin = (value: unknown): string | null => {
  const candidates = splitPossibleUrls(value);

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      return parsed.origin;
    } catch {
      // Try next candidate.
    }
  }

  return null;
};

const getVendorClientBaseUrl = (): string => {
  const configured =
    normalizeBaseOrigin(process.env.CLIENT_URL) ||
    normalizeBaseOrigin(process.env.VENDOR_DASHBOARD_URL) ||
    normalizeBaseOrigin(process.env.FRONTEND_URL);

  return configured || "https://your-frontend.example.com";
};

const vendorCookieSameSite =
  process.env.NODE_ENV === "production" ? "none" : "lax";

const buildOtpCooldownPayload = (user: {
  adminOtpSentAt?: Date;
  adminOtpSendCount?: number;
  adminOtpFailedAttempts?: number;
}) => {
  const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);

  return {
    success: false,
    message: `OTP already sent. Try again in ${formatOtpDelay(msLeft)}.`,
    msLeft,
    remainingAttempts: remainingOtpAttempts(user.adminOtpFailedAttempts),
  };
};

/* =====================================================
   VENDOR LOGIN (PASSWORD → OTP)
===================================================== */

export const vendorLogin = async (req: Request, res: Response) => {
  try {
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

    const isMatch = user.vendorDashboardPassword
      ? await user.compareVendorDashboardPassword(password)
      : await user.comparePassword(password);
    if (!isMatch) {
      console.debug("vendorLogin: password mismatch for", user.email);
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);
    if (msLeft > 0) {
      return res.status(429).json(buildOtpCooldownPayload(user));
    }

    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);
    assignOtpToUser(user, hashedOtp);
    await user.save();

    await sendEmail(
      user.email,
      "Vendor Login Verification",
      `<h2>Your vendor login code</h2>
       <h1>${otp}</h1>
       <p>Expires in ${Math.floor(OTP_EXPIRY_MS / (60 * 1000))} minutes</p>`,
    );

    return res.json({
      success: true,
      message: "Verification code sent",
      msLeft: getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount),
      remainingAttempts: remainingOtpAttempts(user.adminOtpFailedAttempts),
    });
  } catch (error) {
    console.error("vendorLogin failed:", error);
    return res.status(500).json({
      success: false,
      message:
        "Failed to send verification code. Check the backend email configuration.",
    });
  }
};

/* =====================================================
   RESEND VENDOR OTP
===================================================== */

export const resendVendorOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: "Email required" });

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);
    if (msLeft > 0) {
      return res.status(429).json(buildOtpCooldownPayload(user));
    }

    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);
    assignOtpToUser(user, hashedOtp);
    await user.save();

    await sendEmail(
      user.email,
      "Vendor Login Verification",
      `<h2>Your vendor login code</h2>
       <h1>${otp}</h1>
       <p>Expires in ${Math.floor(OTP_EXPIRY_MS / (60 * 1000))} minutes</p>`,
    );

    return res.json({
      success: true,
      message: "Verification code resent",
      msLeft: getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount),
      remainingAttempts: remainingOtpAttempts(user.adminOtpFailedAttempts),
    });
  } catch (error) {
    console.error("resendVendorOtp failed:", error);
    return res.status(500).json({
      success: false,
      message:
        "Failed to send verification code. Check the backend email configuration.",
    });
  }
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

  const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);

  res.json({
    success: true,
    canResend: msLeft === 0,
    msLeft,
    remainingAttempts: remainingOtpAttempts(user.adminOtpFailedAttempts),
  });
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
    clearOtpFromUser(user);
    await user.save();
    return res.status(400).json({ success: false, message: "OTP expired" });
  }

  const valid = await bcrypt.compare(otp, user.adminOtp);
  if (!valid) {
    user.adminOtpFailedAttempts = (Number(user.adminOtpFailedAttempts) || 0) + 1;
    const attemptsLeft = remainingOtpAttempts(user.adminOtpFailedAttempts);

    if (attemptsLeft === 0) {
      clearOtpFromUser(user);
      await user.save();
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Maximum attempts reached. Please request a new code.",
        remainingAttempts: 0,
      });
    }

    await user.save();
    return res.status(400).json({
      success: false,
      message: `Invalid OTP. ${attemptsLeft} attempt(s) remaining.`,
      remainingAttempts: attemptsLeft,
    });
  }

  clearOtpFromUser(user);

  try {
    await user.save();
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

  const isProduction = process.env.NODE_ENV === "production";

  res.cookie("auth-token", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: VENDOR_SESSION_MINUTES * 60 * 1000,
  });

  res.json({ success: true, message: "Login successful", data: { token } });
};

/* =====================================================
   VENDOR PROFILE
===================================================== */

export const getVendorProfile = async (req: AuthRequest, res: Response) => {
  const currentUser = req.user;
  const normalizedStatus =
    currentUser?.vendorStatus || (currentUser?.role === "vendor" ? "APPROVED" : "NEW");
  const baseUser =
    currentUser && typeof (currentUser as any).toObject === "function"
      ? (currentUser as any).toObject()
      : currentUser;

  // Never expose secrets to the client.
  if (baseUser && typeof baseUser === "object") {
    delete (baseUser as any).password;
    delete (baseUser as any).vendorDashboardPassword;
    delete (baseUser as any).adminOtp;
    delete (baseUser as any).adminOtpExpires;
    delete (baseUser as any).adminOtpSentAt;
    delete (baseUser as any).emailOtp;
    delete (baseUser as any).emailOtpExpires;
    delete (baseUser as any).emailOtpSentAt;
  }

  const billing = currentUser?._id
    ? await buildVendorPlanSnapshot(String(currentUser._id), currentUser as any)
    : null;

  res.json({
    success: true,
    user: {
      ...baseUser,
      vendorStatus: normalizedStatus,
      vendorBilling: billing,
    },
  });
};

/* =====================================================
   VENDOR LOGOUT
===================================================== */

export const vendorLogout = async (req: Request, res: Response) => {
  try {
    const isProduction = process.env.NODE_ENV === "production";

    res.clearCookie("auth-token", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
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
    // Personal
    firstName,
    middleName,
    lastName,
    address,
    city,
    state,
    zipCode,
    email,
    phoneNumber,

    // Vendor dashboard fields
    vendorRole,
    referralSalesId,
    termsAccepted,
    vendorDashboardPassword,
    // Business
    businessName,
    businessType,
    businessCategory,
    businessAddress,
    businessPhoneNumber,
    typeofoffering,
    website,
    yearEstablished,
    taxId,

    // Extra business fields
    planKey,
    serviceArea,
    businessDescription,
    operatingHours,
    facebookUrl,
    instagramUrl,
    tiktokUrl,
    vacayCoinParticipation,
    multiLocation,
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
      const incomingEmail = String(email || "").trim().toLowerCase();
      const authEmail = String(targetUser.email || "").trim().toLowerCase();

      if (incomingEmail && incomingEmail !== authEmail) {
        const requestedUser = await User.findOne({ email: incomingEmail });
        if (requestedUser) {
          targetUser = requestedUser;
        }
      }
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

    const normalizedTermsAccepted =
      termsAccepted === true || String(termsAccepted).toLowerCase() === "true";

    if (!vendorRole) {
      return res.status(400).json({
        success: false,
        message: "vendorRole is required",
      });
    }

    if (!normalizedTermsAccepted) {
      return res.status(400).json({
        success: false,
        message: "termsAccepted must be true",
      });
    }

    if (!vendorDashboardPassword || String(vendorDashboardPassword).length < 8) {
      return res.status(400).json({
        success: false,
        message: "vendorDashboardPassword must be at least 8 characters",
      });
    }

    const vendorInfo = {
      businessName,
      ownerName: `${firstName || ""} ${middleName || ""} ${lastName || ""}`
        .replace(/\s+/g, " ")
        .trim(),
      phone: businessPhoneNumber || phoneNumber,
      address: businessAddress || address,
    };

    const files = req.files as
      | {
          [fieldname: string]: Express.Multer.File[];
        }
      | undefined;

    const userIdImageFile = files?.userIdImage?.[0];
    const businessRegImageFile = files?.businessRegImage?.[0];
    const vendorLogoFile = files?.vendorLogo?.[0];

    // Basic validation (matches vendor dashboard form expectations)
    if (!firstName || !lastName || !email) {
      return res.status(400).json({
        success: false,
        message: "firstName, lastName, and email are required",
      });
    }

    if (!businessName || !businessType || !businessCategory || !businessAddress) {
      return res.status(400).json({
        success: false,
        message:
          "businessName, businessType, businessCategory, and businessAddress are required",
      });
    }

    if (!userIdImageFile || !businessRegImageFile || !vendorLogoFile) {
      return res.status(400).json({
        success: false,
        message: "userIdImage, businessRegImage, and vendorLogo are required",
      });
    }

    if (
      vendorLogoFile.mimetype !== "image/png" &&
      vendorLogoFile.mimetype !== "image/jpeg"
    ) {
      return res.status(400).json({
        success: false,
        message: "Vendor logo must be a PNG or JPEG image",
      });
    }

    // Enforce vendor logo dimensions (800x800 to 2000x2000).
    try {
      const { width, height } = imageSize(vendorLogoFile.buffer);
      const w = Number(width);
      const h = Number(height);
      if (
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w < 800 ||
        h < 800 ||
        w > 2000 ||
        h > 2000
      ) {
        return res.status(400).json({
          success: false,
          message: "Vendor logo must be between 800x800 and 2000x2000 pixels",
        });
      }
    } catch (e) {
      console.error("Vendor logo dimension check failed:", e);
      return res.status(400).json({
        success: false,
        message: "Unable to read vendor logo image",
      });
    }

    const folderBase = `grysosta/vendor-applications/${targetUser._id.toString()}`;
    const vendorDashboardPasswordHash = await bcrypt.hash(
      String(vendorDashboardPassword),
      12,
    );

    // Upload images first (so admins can also inspect images if needed)
    const [userIdUpload, businessRegUpload, vendorLogoUpload] = await Promise.all([
      uploadImageBufferToCloudinary(userIdImageFile.buffer, `${folderBase}/documents`),
      uploadImageBufferToCloudinary(
        businessRegImageFile.buffer,
        `${folderBase}/documents`,
      ),
      uploadImageBufferToCloudinary(vendorLogoFile.buffer, `${folderBase}/branding`),
    ]);


    // Clear previous rejection reason when resubmitting
    await User.updateOne(
      { _id: targetUser._id },
      {
        $set: {
          vendorDashboardPassword: vendorDashboardPasswordHash,
          vendorInfo: {
            ...vendorInfo,
            logoUrl: vendorLogoUpload.secure_url,
            logoPublicId: vendorLogoUpload.public_id,
          },
          vendorStatus: "PENDING",
          vendorApplication: {
            personal: {
              firstName,
              middleName,
              lastName,
              address,
              city,
              state,
              zipCode,
              email,
              phoneNumber,
              vendorRole,
              referralSalesId,
              termsAccepted: normalizedTermsAccepted,
            },
            business: {
              businessName,
              businessType,
              businessCategory,
              businessAddress,
              businessPhoneNumber,
              typeofoffering,
              website,
              yearEstablished,
              taxId,
              planKey,
              serviceArea,
              businessDescription,
              operatingHours,
              facebookUrl,
              instagramUrl,
              tiktokUrl,
              vacayCoinParticipation:
                vacayCoinParticipation === true ||
                String(vacayCoinParticipation).toLowerCase() === "true",
              multiLocation:
                multiLocation === true ||
                String(multiLocation).toLowerCase() === "true",
            },
            documents: {
              userIdImageUrl: userIdUpload.secure_url,
              userIdImagePublicId: userIdUpload.public_id,
              businessRegImageUrl: businessRegUpload.secure_url,
              businessRegImagePublicId: businessRegUpload.public_id,
              logoUrl: vendorLogoUpload.secure_url,
              logoPublicId: vendorLogoUpload.public_id,
            },
            submittedAt: new Date(),
          },
        },
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
   SAVE VENDOR PROGRESS (DRAFT)
===================================================== */

export const saveVendorProgress = async (req: AuthRequest, res: Response) => {
  const authUser = req.user as any | undefined;

  const {
    // Personal
    firstName,
    middleName,
    lastName,
    address,
    city,
    state,
    zipCode,
    email,
    phoneNumber,
    vendorRole,
    referralSalesId,
    termsAccepted,
    vendorDashboardPassword,

    // Business (optional)
    businessName,
    businessType,
    businessCategory,
    businessAddress,
    businessPhoneNumber,
    typeofoffering,
    website,
    yearEstablished,
    taxId,

    // Extra business fields
    planKey,
    serviceArea,
    businessDescription,
    operatingHours,
    facebookUrl,
    instagramUrl,
    tiktokUrl,
    vacayCoinParticipation,
    multiLocation,
  } = req.body as any;

  let targetUser = authUser;

  try {
    if (!targetUser) {
      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email required for unauthenticated save",
        });
      }
      targetUser = await User.findOne({ email });
      if (!targetUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
    }

    if (targetUser.role === "admin") {
      const incomingEmail = String(email || "").trim().toLowerCase();
      const authEmail = String(targetUser.email || "").trim().toLowerCase();

      if (incomingEmail && incomingEmail !== authEmail) {
        const requestedUser = await User.findOne({ email: incomingEmail });
        if (requestedUser) {
          targetUser = requestedUser;
        }
      }
    }

    if (targetUser.role === "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admins cannot save vendor info" });
    }

    if (!targetUser.isVerified) {
      return res
        .status(403)
        .json({ success: false, message: "Account not verified" });
    }

    const normalizedTermsAccepted =
      termsAccepted === true || String(termsAccepted).toLowerCase() === "true";

    // Update draft application fields (merge)
    targetUser.vendorApplication = targetUser.vendorApplication || {};
    targetUser.vendorApplication.personal =
      targetUser.vendorApplication.personal || {};
    targetUser.vendorApplication.business =
      targetUser.vendorApplication.business || {};

    const personalDraft = targetUser.vendorApplication.personal as any;
    const businessDraft = targetUser.vendorApplication.business as any;

    // Personal
    if (typeof firstName === "string") personalDraft.firstName = firstName;
    if (typeof middleName === "string") personalDraft.middleName = middleName;
    if (typeof lastName === "string") personalDraft.lastName = lastName;
    if (typeof address === "string") personalDraft.address = address;
    if (typeof city === "string") personalDraft.city = city;
    if (typeof state === "string") personalDraft.state = state;
    if (typeof zipCode === "string") personalDraft.zipCode = zipCode;
    if (typeof email === "string") personalDraft.email = email;
    if (typeof phoneNumber === "string") personalDraft.phoneNumber = phoneNumber;
    if (typeof vendorRole === "string") personalDraft.vendorRole = vendorRole;
    if (typeof referralSalesId === "string") {
      personalDraft.referralSalesId = referralSalesId;
    }
    if (termsAccepted !== undefined) {
      personalDraft.termsAccepted = normalizedTermsAccepted;
    }

    // Business
    if (typeof businessName === "string") businessDraft.businessName = businessName;
    if (typeof businessType === "string") businessDraft.businessType = businessType;
    if (typeof businessCategory === "string") {
      businessDraft.businessCategory = businessCategory;
    }
    if (typeof businessAddress === "string") {
      businessDraft.businessAddress = businessAddress;
    }
    if (typeof businessPhoneNumber === "string") {
      businessDraft.businessPhoneNumber = businessPhoneNumber;
    }
    if (typeof typeofoffering === "string") {
      businessDraft.typeofoffering = typeofoffering;
    }
    if (typeof website === "string") businessDraft.website = website;
    if (typeof yearEstablished === "string") {
      businessDraft.yearEstablished = yearEstablished;
    }
    if (typeof taxId === "string") businessDraft.taxId = taxId;

    if (typeof planKey === "string") businessDraft.planKey = planKey;
    if (typeof serviceArea === "string") businessDraft.serviceArea = serviceArea;
    if (typeof businessDescription === "string") {
      businessDraft.businessDescription = businessDescription;
    }
    if (typeof operatingHours === "string") {
      businessDraft.operatingHours = operatingHours;
    }
    if (typeof facebookUrl === "string") businessDraft.facebookUrl = facebookUrl;
    if (typeof instagramUrl === "string") businessDraft.instagramUrl = instagramUrl;
    if (typeof tiktokUrl === "string") businessDraft.tiktokUrl = tiktokUrl;

    if (vacayCoinParticipation !== undefined) {
      businessDraft.vacayCoinParticipation =
        vacayCoinParticipation === true ||
        String(vacayCoinParticipation).toLowerCase() === "true";
    }

    if (multiLocation !== undefined) {
      businessDraft.multiLocation =
        multiLocation === true || String(multiLocation).toLowerCase() === "true";
    }

    // Vendor dashboard password (optional on save)
    if (vendorDashboardPassword) {
      if (String(vendorDashboardPassword).length < 8) {
        return res.status(400).json({
          success: false,
          message: "vendorDashboardPassword must be at least 8 characters",
        });
      }
      targetUser.vendorDashboardPassword = String(vendorDashboardPassword);
    }

    await targetUser.save();

    res.json({ success: true, message: "Progress saved" });
  } catch (err) {
    console.error("Save vendor progress error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save progress. Please try again.",
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
    const clientBaseUrl = getVendorClientBaseUrl();
    const onboardingLink = `${clientBaseUrl}/vendor/onboarding`;
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
    "name email vendorInfo vendorApplication createdAt role",
  );
  res.json({ success: true, vendors });
};

export const getApprovedVendors = async (req: AuthRequest, res: Response) => {
  const vendors = await User.find({
    vendorStatus: "APPROVED",
    role: "vendor",
  }).select("name email vendorInfo vendorApplication vendorApproval role");
  res.json({ success: true, vendors });
};

/* =====================================================
   LIST VENDORS (PUBLIC - MOBILE)
   Returns approved vendors with safe, non-sensitive fields.
===================================================== */

export const getPublicApprovedVendors = async (req: Request, res: Response) => {
  try {
    const vendors = await User.find({
      vendorStatus: "APPROVED",
      role: "vendor",
    })
      .select("name vendorInfo vendorApplication")
      .sort({ "vendorInfo.businessName": 1, name: 1 });

    const result = vendors.map((vendor) => {
      const businessName =
        vendor.vendorInfo?.businessName ||
        vendor.vendorApplication?.business?.businessName ||
        vendor.name;

      const logoUrl =
        vendor.vendorInfo?.logoUrl ||
        vendor.vendorApplication?.documents?.logoUrl ||
        undefined;

      const category = vendor.vendorApplication?.business?.businessCategory;

      return {
        id: vendor._id.toString(),
        name: businessName,
        logoUrl,
        category,
      };
    });

    return res.json({ success: true, vendors: result });
  } catch (error) {
    console.error("Public vendor list error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch vendors" });
  }
};

/* =====================================================
   GET SINGLE VENDOR APPLICATION (ADMIN)
===================================================== */

export const getVendorApplicationById = async (req: AuthRequest, res: Response) => {
  try {
    const vendorId = String(req.params.vendorId || "").trim();
    if (!vendorId) {
      return res
        .status(400)
        .json({ success: false, message: "vendorId is required" });
    }

    const vendor = await User.findById(vendorId).select(
      "name username email role vendorStatus vendorRejectionReason vendorInfo vendorApplication createdAt",
    );

    if (!vendor) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });
    }

    return res.json({ success: true, vendor });
  } catch (error) {
    console.error("Get vendor application error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch vendor application" });
  }
};
