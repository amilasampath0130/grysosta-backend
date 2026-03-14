import { Response } from "express";
import { AuthRequest } from "./authController.js";
import User from "../models/User.js";

export const getAdminDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const [mobileUsers, pendingVendors, approvedVendors, rejectedVendors] =
      await Promise.all([
        User.countDocuments({ role: "user" }),
        User.countDocuments({ vendorStatus: "PENDING" }),
        User.countDocuments({ vendorStatus: "APPROVED", role: "vendor" }),
        User.countDocuments({ vendorStatus: "REJECTED" }),
      ]);

    return res.json({
      success: true,
      data: {
        mobileUsers,
        pendingVendors,
        approvedVendors,
        rejectedVendors,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to load dashboard stats",
    });
  }
};
