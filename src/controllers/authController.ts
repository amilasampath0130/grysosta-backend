import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User, { IUser } from "../models/User.js";

// ================= TYPES =================
interface JwtPayload {
  userId: string;
}

export interface AuthRequest extends Request {
  user?: IUser;
}

// ================= TOKEN =================
export const generateToken = (userId: string, role: string): string => {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET as string,
    { expiresIn: "1m" }
  );
};

// ================= AUTH MIDDLEWARE =================


// ================= REGISTER =================
export const register = async (req: Request, res: Response) => {
  try {
    const { name, username, email, password, mobileNumber, role } = req.body;

    const exists = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "User already exists"
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
      role
    });

    await user.save();

    const token = generateToken(user._id.toString(), user.role);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        token,
        user
      }
    });

  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
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
        message: "Invalid email or password"
      });
    }

    const token = generateToken(user._id.toString(), user.role);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user
      }
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// ================= PROFILE =================
export const profile = async (req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    user: req.user
  });
};
