import { Request,Response } from "express";
import User, { IUser } from "../models/User.js";

import { AuthRequest, generateToken } from "./authController.js";
// ================= ADMIN LOGIN =================
export const adminLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, role: "admin" });

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    const token = generateToken(user._id.toString(), user.role);
    res.status(200).json({ success: true, data: { token } });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const getAdminProfile = async (req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    user: req.user
  });
};
export const getAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    const users = await User.find().select("-password"); // 🔒 exclude password

    res.status(200).json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch users"
    });
  }
};