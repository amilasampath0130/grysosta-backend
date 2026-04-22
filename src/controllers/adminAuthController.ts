import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import User, { IUser } from "../models/User.js";
import Offer from "../models/Offer.js";
import Advertisement from "../models/Advertisement.js";
import UserPoints from "../models/UserPoints.js";
import GameSession from "../models/GameSession.js";
import { AuthRequest, generateToken } from "./authController.js";
import { generateOtp } from "../utils/generateOtp.js";
import { sendEmail } from "../utils/sendEmail.js";
import { deleteCloudinaryImage } from "../lib/cloudinary.js";
import { requireStripe } from "../lib/stripeClient.js";
import {
  OTP_EXPIRY_MS,
  assignOtpToUser,
  clearOtpFromUser,
  formatOtpDelay,
  getOtpMsLeft,
  remainingOtpAttempts,
} from "../lib/otpPolicy.js";

interface LoginRequestBody {
  email: string;
  password: string;
}

interface OtpRequestBody {
  email: string;
  otp: string;
}

interface VerifyAdminOtpResponse {
  token: string;
}

interface AdminPasswordResetRequestBody {
  email: string;
}

interface AdminPasswordResetVerifyBody {
  email: string;
  token: string;
}

interface AdminPasswordResetBody {
  email: string;
  token: string;
  newPassword: string;
}

const ADMIN_ROLES = ["admin", "superadmin"] as const;
const ADMIN_LOGIN_MAX_FAILED_ATTEMPTS = 3;
const ADMIN_LOGIN_LOCK_MS = 60 * 60 * 1000;
const OTP_MAX_REQUESTS = 3;
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const OTP_LOCK_MS = 60 * 60 * 1000;
const ADMIN_PASSWORD_RESET_EXPIRY_MS = 15 * 60 * 1000;

const logError = (
  label: string,
  error: unknown,
  metadata?: Record<string, unknown>,
): void => {
  console.error(`[${label}]`, {
    ...metadata,
    error,
  });
};

const sendAdminOtpEmail = async (email: string, otp: string): Promise<void> => {
  try {
    await sendEmail(
      email,
      "Admin Verification Code",
      `<h2>Your admin verification code</h2>
       <h1>${otp}</h1>
       <p>Expires in ${Math.floor(OTP_EXPIRY_MS / (60 * 1000))} minutes</p>`,
    );

    console.info("[LOGIN EMAIL SENT]", { email });
  } catch (error) {
    logError("LOGIN EMAIL ERROR", error, { email });
    throw error;
  }
};

const sendAdminPasswordResetEmail = async (
  email: string,
  token: string,
): Promise<void> => {
  const dashboardBaseUrl =
    process.env.ADMIN_DASHBOARD_URL ||
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    "https://your-frontend.example.com";

  const resetUrl = `${dashboardBaseUrl.replace(/\/$/, "")}/auth/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

  await sendEmail(
    email,
    "Admin Password Reset",
    `<h2>Reset your admin password</h2>
     <p>Use the link below to reset your password:</p>
     <p><a href="${resetUrl}">${resetUrl}</a></p>
     <p>This reset token expires in ${Math.floor(ADMIN_PASSWORD_RESET_EXPIRY_MS / (60 * 1000))} minutes.</p>
     <p>If you did not request this change, ignore this email.</p>`,
  );
};

const safeDeleteCloudinaryImage = async (publicId?: string) => {
  if (!publicId) return;

  try {
    await deleteCloudinaryImage(publicId);
  } catch (error) {
    logError("CLOUDINARY DELETE ERROR", error, { publicId });
  }
};

const purgeUserOwnedMedia = async (user: IUser) => {
  const vendorDocPublicIds = [
    user.vendorInfo?.logoPublicId,
    user.vendorApplication?.documents?.logoPublicId,
    user.vendorApplication?.documents?.userIdImagePublicId,
    user.vendorApplication?.documents?.businessRegImagePublicId,
  ].filter((id): id is string => Boolean(id));

  const uniquePublicIds = [...new Set(vendorDocPublicIds)];
  await Promise.all(uniquePublicIds.map((publicId) => safeDeleteCloudinaryImage(publicId)));
};

const cancelVendorStripeSubscriptionIfAny = async (user: IUser) => {
  const subscriptionId = String(
    user.vendorSubscription?.stripeSubscriptionId || "",
  ).trim();

  if (!subscriptionId) return;

  try {
    const stripe = requireStripe();
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (error: any) {
    const isMissingResource =
      error?.type === "StripeInvalidRequestError" &&
      error?.code === "resource_missing";

    if (!isMissingResource) {
      logError("STRIPE CANCEL SUBSCRIPTION ERROR", error, {
        subscriptionId,
        userId: user._id.toString(),
      });
    }
  }
};

const purgeVendorRecords = async (vendorId: string) => {
  const [offers, advertisements] = await Promise.all([
    Offer.find({ vendor: vendorId }).select("imagePublicId"),
    Advertisement.find({ vendor: vendorId }).select("imagePublicId"),
  ]);

  const mediaPublicIds = [
    ...offers.map((item) => item.imagePublicId),
    ...advertisements.map((item) => item.imagePublicId),
  ].filter((id): id is string => Boolean(id));

  const uniquePublicIds = [...new Set(mediaPublicIds)];

  await Promise.all([
    Offer.deleteMany({ vendor: vendorId }),
    Advertisement.deleteMany({ vendor: vendorId }),
  ]);

  await Promise.all(uniquePublicIds.map((publicId) => safeDeleteCloudinaryImage(publicId)));
};

const purgeUserRecords = async (userId: string) => {
  await Promise.all([
    UserPoints.deleteOne({ userId }),
    GameSession.deleteMany({ userId }),
  ]);
};

const deleteUserWithRelations = async (user: IUser) => {
  const userId = user._id.toString();

  await Promise.all([
    purgeUserRecords(userId),
    purgeUserOwnedMedia(user),
    (user.role === "vendor" || user.vendorStatus === "PENDING")
      ? purgeVendorRecords(userId)
      : Promise.resolve(),
    (user.role === "vendor" || user.vendorStatus === "PENDING")
      ? cancelVendorStripeSubscriptionIfAny(user)
      : Promise.resolve(),
  ]);

  await User.deleteOne({ _id: user._id });
};

const buildOtpCooldownResponse = (res: Response, user: IUser) => {
  const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);

  return res.status(429).json({
    success: false,
    message: `OTP already sent. Try again in ${formatOtpDelay(msLeft)}.`,
    msLeft,
    remainingAttempts: remainingOtpAttempts(user.adminOtpFailedAttempts),
  });
};

const getMsLeft = (until?: Date): number => {
  if (!until) return 0;
  return Math.max(0, new Date(until).getTime() - Date.now());
};

const hashResetToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

const shouldApplyStrictAdminSecurity = (user: IUser): boolean => {
  return user.role === "admin" || user.role === "superadmin";
};

const enforceOtpRequestLimit = (user: IUser): { allowed: boolean; msLeft?: number } => {
  const now = new Date();

  const otpLockMsLeft = getMsLeft(user.otpLockUntil);
  if (otpLockMsLeft > 0) {
    return { allowed: false, msLeft: otpLockMsLeft };
  }

  const windowStart = user.otpRequestWindowStart
    ? new Date(user.otpRequestWindowStart)
    : null;
  const elapsedInWindow = windowStart
    ? now.getTime() - windowStart.getTime()
    : Number.POSITIVE_INFINITY;

  if (!windowStart || elapsedInWindow > OTP_REQUEST_WINDOW_MS) {
    user.otpRequestWindowStart = now;
    user.otpRequestCount = 0;
  }

  const requestCount = Number(user.otpRequestCount) || 0;
  if (requestCount >= OTP_MAX_REQUESTS) {
    user.otpLockUntil = new Date(Date.now() + OTP_LOCK_MS);
    return { allowed: false, msLeft: OTP_LOCK_MS };
  }

  user.otpRequestCount = requestCount + 1;
  return { allowed: true };
};

export const adminLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as LoginRequestBody;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email, role: { $in: ADMIN_ROLES } });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (shouldApplyStrictAdminSecurity(user)) {
      const loginLockMsLeft = getMsLeft(user.adminLoginLockUntil);
      if (loginLockMsLeft > 0) {
        return res.status(423).json({
          success: false,
          message: `Account is temporarily locked. Try again in ${formatOtpDelay(loginLockMsLeft)}.`,
          msLeft: loginLockMsLeft,
        });
      }
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      if (shouldApplyStrictAdminSecurity(user)) {
        user.adminLoginFailedAttempts =
          (Number(user.adminLoginFailedAttempts) || 0) + 1;

        const attemptsLeft = Math.max(
          0,
          ADMIN_LOGIN_MAX_FAILED_ATTEMPTS -
            Number(user.adminLoginFailedAttempts),
        );

        if (attemptsLeft === 0) {
          user.adminLoginLockUntil = new Date(Date.now() + ADMIN_LOGIN_LOCK_MS);
        }

        await user.save();

        if (attemptsLeft === 0) {
          return res.status(423).json({
            success: false,
            message: `Too many failed attempts. Account locked for ${formatOtpDelay(ADMIN_LOGIN_LOCK_MS)}.`,
            msLeft: ADMIN_LOGIN_LOCK_MS,
          });
        }

        return res.status(401).json({
          success: false,
          message: `Invalid credentials. ${attemptsLeft} attempt(s) remaining.`,
          remainingAttempts: attemptsLeft,
        });
      }

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (shouldApplyStrictAdminSecurity(user)) {
      user.adminLoginFailedAttempts = 0;
      user.adminLoginLockUntil = undefined;
    }

    const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);
    if (msLeft > 0) {
      return buildOtpCooldownResponse(res, user);
    }

    const requestCheck = enforceOtpRequestLimit(user);
    if (!requestCheck.allowed) {
      await user.save();
      return res.status(429).json({
        success: false,
        message: `Too many OTP requests. Try again in ${formatOtpDelay(requestCheck.msLeft || OTP_LOCK_MS)}.`,
        msLeft: requestCheck.msLeft || OTP_LOCK_MS,
      });
    }

    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);
    assignOtpToUser(user, hashedOtp);

    await user.save();
    await sendAdminOtpEmail(user.email, otp);

    return res.json({
      success: true,
      message: "Verification code sent to email",
      msLeft: getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount),
      remainingAttempts: remainingOtpAttempts(user.adminOtpFailedAttempts),
    });
  } catch (error) {
    const email = (req.body as Partial<LoginRequestBody>)?.email;
    logError("LOGIN ERROR", error, { email, route: "adminLogin" });

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

export const resendAdminOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as Pick<LoginRequestBody, "email">;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email required",
      });
    }

    const user = await User.findOne({ email, role: { $in: ADMIN_ROLES } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const otpLockMsLeft = getMsLeft(user.otpLockUntil);
    if (otpLockMsLeft > 0) {
      return res.status(423).json({
        success: false,
        message: `OTP is temporarily locked. Try again in ${formatOtpDelay(otpLockMsLeft)}.`,
        msLeft: otpLockMsLeft,
      });
    }

    const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);
    if (msLeft > 0) {
      return buildOtpCooldownResponse(res, user);
    }

    const requestCheck = enforceOtpRequestLimit(user);
    if (!requestCheck.allowed) {
      await user.save();
      return res.status(429).json({
        success: false,
        message: `Too many OTP requests. Try again in ${formatOtpDelay(requestCheck.msLeft || OTP_LOCK_MS)}.`,
        msLeft: requestCheck.msLeft || OTP_LOCK_MS,
      });
    }

    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);
    assignOtpToUser(user, hashedOtp);

    await user.save();
    await sendAdminOtpEmail(user.email, otp);

    return res.json({
      success: true,
      message: "Verification code sent to email",
      msLeft: getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount),
      remainingAttempts: remainingOtpAttempts(user.adminOtpFailedAttempts),
    });
  } catch (error) {
    const email = (req.body as Partial<LoginRequestBody>)?.email;
    logError("RESEND OTP ERROR", error, { email, route: "resendAdminOtp" });

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

export const adminOtpStatus = async (req: Request, res: Response) => {
  try {
    const email = (req.query.email as string) || "";
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email required",
      });
    }

    const user = await User.findOne({ email, role: { $in: ADMIN_ROLES } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);

    return res.json({
      success: true,
      canResend: msLeft === 0,
      msLeft,
      remainingAttempts: remainingOtpAttempts(user.adminOtpFailedAttempts),
      otpAttempts: Number(user.otpAttempts) || 0,
      otpRequestCount: Number(user.otpRequestCount) || 0,
      otpLockMsLeft: getMsLeft(user.otpLockUntil),
    });
  } catch (error) {
    const email = (req.query.email as string) || "";
    logError("OTP STATUS ERROR", error, { email, route: "adminOtpStatus" });

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

export const getAdminProfile = async (req: AuthRequest, res: Response) => {
  return res.json({
    success: true,
    user: req.user,
  });
};

export const getAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    const users = await User.find({ role: "user" }).select("-password");

    return res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
};

export const getAllAdmins = async (req: AuthRequest, res: Response) => {
  try {
    const admins = await User.find({ role: "admin" }).select(
      "name email createdAt",
    );

    return res.json({
      success: true,
      admins,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Cannot delete admin account",
      });
    }

    await deleteUserWithRelations(user);

    return res.json({
      success: true,
      message: "User deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete user",
    });
  }
};

export const deleteVendor = async (req: AuthRequest, res: Response) => {
  try {
    const vendor = await User.findById(req.params.vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    if (vendor.role !== "vendor" && vendor.vendorStatus !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Target is not a vendor",
      });
    }

    await deleteUserWithRelations(vendor);

    return res.json({
      success: true,
      message: "Vendor deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete vendor",
    });
  }
};

export const verifyAdminOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body as OtpRequestBody;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    const user = await User.findOne({ email, role: { $in: ADMIN_ROLES } });
    if (!user || !user.adminOtp || !user.adminOtpExpires) {
      return res.status(400).json({
        success: false,
        message: "Invalid request",
      });
    }

    const otpLockMsLeft = getMsLeft(user.otpLockUntil);
    if (otpLockMsLeft > 0) {
      return res.status(423).json({
        success: false,
        message: `OTP is locked due to multiple failed attempts. Try again in ${formatOtpDelay(otpLockMsLeft)}.`,
        msLeft: otpLockMsLeft,
      });
    }

    if (user.adminOtpExpires < new Date()) {
      clearOtpFromUser(user);
      await user.save();

      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    const isValid = await bcrypt.compare(otp, user.adminOtp);
    if (!isValid) {
      user.otpAttempts = (Number(user.otpAttempts) || 0) + 1;
      user.adminOtpFailedAttempts = (Number(user.adminOtpFailedAttempts) || 0) + 1;

      const attemptsLeft = Math.max(0, 5 - Number(user.otpAttempts));
      if (attemptsLeft === 0) {
        user.otpLockUntil = new Date(Date.now() + OTP_LOCK_MS);
        clearOtpFromUser(user);
        await user.save();

        return res.status(423).json({
          success: false,
          message:
            `Invalid OTP. Maximum attempts reached. OTP locked for ${formatOtpDelay(OTP_LOCK_MS)}.`,
          remainingAttempts: 0,
          msLeft: OTP_LOCK_MS,
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
    user.otpAttempts = 0;
    user.otpLockUntil = undefined;
    await user.save();

    const token = generateToken(user._id.toString(), user.role);

    return res.json({
      success: true,
      data: { token } satisfies VerifyAdminOtpResponse,
    });
  } catch (error) {
    const email = (req.body as Partial<OtpRequestBody>)?.email;
    logError("VERIFY ADMIN OTP ERROR", error, {
      email,
      route: "verifyAdminOtp",
    });

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

export const requestAdminPasswordReset = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as AdminPasswordResetRequestBody;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email, role: { $in: ADMIN_ROLES } });
    if (!user) {
      return res.json({
        success: true,
        message:
          "If the account exists, a reset link has been sent to the registered email.",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.adminPasswordResetToken = hashResetToken(resetToken);
    user.adminPasswordResetExpires = new Date(
      Date.now() + ADMIN_PASSWORD_RESET_EXPIRY_MS,
    );
    await user.save();

    await sendAdminPasswordResetEmail(user.email, resetToken);

    return res.json({
      success: true,
      message:
        "If the account exists, a reset link has been sent to the registered email.",
    });
  } catch (error) {
    const email = (req.body as Partial<AdminPasswordResetRequestBody>)?.email;
    logError("REQUEST ADMIN PASSWORD RESET ERROR", error, {
      email,
      route: "requestAdminPasswordReset",
    });

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

export const verifyAdminPasswordResetToken = async (
  req: Request,
  res: Response,
) => {
  try {
    const { email, token } = req.body as AdminPasswordResetVerifyBody;

    if (!email || !token) {
      return res.status(400).json({
        success: false,
        message: "Email and token are required",
      });
    }

    const user = await User.findOne({ email, role: { $in: ADMIN_ROLES } });
    if (!user || !user.adminPasswordResetToken || !user.adminPasswordResetExpires) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    if (new Date(user.adminPasswordResetExpires).getTime() < Date.now()) {
      user.adminPasswordResetToken = undefined;
      user.adminPasswordResetExpires = undefined;
      await user.save();

      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    const providedHash = hashResetToken(token);
    if (providedHash !== user.adminPasswordResetToken) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    return res.json({
      success: true,
      message: "Reset token is valid",
    });
  } catch (error) {
    const email = (req.body as Partial<AdminPasswordResetVerifyBody>)?.email;
    logError("VERIFY ADMIN RESET TOKEN ERROR", error, {
      email,
      route: "verifyAdminPasswordResetToken",
    });

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

export const resetAdminPasswordWithToken = async (
  req: Request,
  res: Response,
) => {
  try {
    const { email, token, newPassword } = req.body as AdminPasswordResetBody;

    if (!email || !token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, token and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const user = await User.findOne({ email, role: { $in: ADMIN_ROLES } });
    if (!user || !user.adminPasswordResetToken || !user.adminPasswordResetExpires) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    if (new Date(user.adminPasswordResetExpires).getTime() < Date.now()) {
      user.adminPasswordResetToken = undefined;
      user.adminPasswordResetExpires = undefined;
      await user.save();

      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    const providedHash = hashResetToken(token);
    if (providedHash !== user.adminPasswordResetToken) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    user.password = newPassword;
    user.adminPasswordResetToken = undefined;
    user.adminPasswordResetExpires = undefined;
    user.adminLoginFailedAttempts = 0;
    user.adminLoginLockUntil = undefined;
    user.otpLockUntil = undefined;
    user.otpAttempts = 0;
    clearOtpFromUser(user);
    await user.save();

    return res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    const email = (req.body as Partial<AdminPasswordResetBody>)?.email;
    logError("RESET ADMIN PASSWORD ERROR", error, {
      email,
      route: "resetAdminPasswordWithToken",
    });

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};
