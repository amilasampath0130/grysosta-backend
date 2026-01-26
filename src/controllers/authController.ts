import { Request, Response, NextFunction } from "express";
import jwt, { type SignOptions, type Secret } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User, { IUser } from "../models/User.js";
import { generateOtp } from "../utils/generateOtp.js";
import { sendEmail } from "../utils/sendEmail.js";

// ================= TYPES =================
interface JwtPayload {
  userId: string;
}

export interface AuthRequest extends Request {
  user?: IUser;
}

// ================= TOKEN =================
export const generateToken = (
  userId: string,
  role: string,
  expiresIn: SignOptions["expiresIn"] = "30m",
): string => {
  const jwtSecret = process.env.JWT_SECRET as Secret | undefined;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not defined");
  }

  return jwt.sign({ userId, role }, jwtSecret, { expiresIn });
};

// ================= REGISTER =================
export const register = async (req: Request, res: Response) => {
  try {
    const { name, username, email, password, mobileNumber, role } = req.body;

    const exists = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    const profileImage = `https://api.dicebear.com/9.x/avataaars/svg?seed=${username}`;

    const user = new User({
      name,
      username,
      email,
      password,
      mobileNumber,
      profileImage,
      role,
    });

    await user.save();

    // Generate and store email OTP for registration verification
    const otp = generateOtp();
    user.emailOtp = await bcrypt.hash(otp, 10);
    user.emailOtpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    user.emailOtpSentAt = new Date();
    await user.save();

    await sendEmail(
      user.email,
      "Your verification code",
      `<h2>Complete your registration</h2>
       <p>Use this code to verify your account:</p>
       <h1>${otp}</h1>
       <p>This code expires in 5 minutes.</p>`,
    );

    res.status(201).json({
      success: true,
      message: "Verification code sent to email",
      data: {
        email: user.email,
        user,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ================= LOGIN =================
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message:
          "Account not verified. Please verify the OTP sent to your email.",
      });
    }

    const token = generateToken(user._id.toString(), user.role);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ================= PROFILE =================
export const profile = async (req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    user: req.user,
  });
};

// ================= VERIFY REGISTRATION OTP =================
export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body as { email: string; otp: string };
    if (!email || !otp) {
      return res
        .status(400)
        .json({ success: false, message: "Email and OTP are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!user.emailOtp || !user.emailOtpExpires || !user.emailOtpSentAt) {
      return res.status(400).json({
        success: false,
        message: "No OTP found. Please request a new code.",
      });
    }

    if (new Date() > new Date(user.emailOtpExpires)) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new code.",
      });
    }

    const isMatch = await bcrypt.compare(otp, user.emailOtp);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid OTP" });
    }

    user.isVerified = true;
    user.emailOtp = undefined;
    user.emailOtpExpires = undefined;
    user.emailOtpSentAt = undefined;
    await user.save();

    const token = generateToken(user._id.toString(), user.role);
    res.json({
      success: true,
      message: "Verification successful",
      data: { token, user },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ================= RESEND REGISTRATION OTP =================
export const resendOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email: string };
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const COOLDOWN_MINUTES = 1;
    if (user.emailOtpSentAt) {
      const elapsed = Date.now() - new Date(user.emailOtpSentAt).getTime();
      if (elapsed < COOLDOWN_MINUTES * 60 * 1000) {
        const msLeft = COOLDOWN_MINUTES * 60 * 1000 - elapsed;
        return res
          .status(429)
          .json({ success: false, message: "OTP already sent", msLeft });
      }
    }

    const otp = generateOtp();
    user.emailOtp = await bcrypt.hash(otp, 10);
    user.emailOtpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    user.emailOtpSentAt = new Date();
    await user.save();

    await sendEmail(
      user.email,
      "Your verification code",
      `<h2>Complete your registration</h2>
       <p>Use this code to verify your account:</p>
       <h1>${otp}</h1>
       <p>This code expires in 5 minutes.</p>`,
    );

    res.json({ success: true, message: "Verification code sent to email" });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
