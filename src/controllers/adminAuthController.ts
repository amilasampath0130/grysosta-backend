import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import User, { IUser } from "../models/User.js";
import { AuthRequest, generateToken } from "./authController.js";
import { generateOtp } from "../utils/generateOtp.js";
import { sendEmail } from "../utils/sendEmail.js";
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

const buildOtpCooldownResponse = (res: Response, user: IUser) => {
  const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);

  return res.status(429).json({
    success: false,
    message: `OTP already sent. Try again in ${formatOtpDelay(msLeft)}.`,
    msLeft,
    remainingAttempts: remainingOtpAttempts(user.adminOtpFailedAttempts),
  });
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

    const user = await User.findOne({ email, role: "admin" });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);
    if (msLeft > 0) {
      return buildOtpCooldownResponse(res, user);
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

    const user = await User.findOne({ email, role: "admin" });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const msLeft = getOtpMsLeft(user.adminOtpSentAt, user.adminOtpSendCount);
    if (msLeft > 0) {
      return buildOtpCooldownResponse(res, user);
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

    const user = await User.findOne({ email, role: "admin" });
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

    await User.deleteOne({ _id: user._id });
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

    await User.deleteOne({ _id: vendor._id });
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

    const user = await User.findOne({ email, role: "admin" });
    if (!user || !user.adminOtp || !user.adminOtpExpires) {
      return res.status(400).json({
        success: false,
        message: "Invalid request",
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
      user.adminOtpFailedAttempts = (Number(user.adminOtpFailedAttempts) || 0) + 1;

      const attemptsLeft = remainingOtpAttempts(user.adminOtpFailedAttempts);
      if (attemptsLeft === 0) {
        clearOtpFromUser(user);
        await user.save();

        return res.status(400).json({
          success: false,
          message:
            "Invalid OTP. Maximum attempts reached. Please request a new code.",
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
