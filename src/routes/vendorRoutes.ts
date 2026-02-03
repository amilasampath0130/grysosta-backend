import express from "express";
import {
  vendorLogin,
  verifyVendorOtp,
  resendVendorOtp,
  vendorOtpStatus,
  getVendorProfile,
  vendorLogout,
  submitVendorInfo,
  approveVendor,
  rejectVendor,
  getPendingVendors,
  getApprovedVendors,
} from "../controllers/vendorAuthController.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

//================================vendor routes============================//

//== Vendor Login ==
router.post("/login", vendorLogin);

//== Resend OTP ==
router.post("/resend-otp", resendVendorOtp);

//== OTP Status ==
router.get("/otp-status", vendorOtpStatus);

//== Verify OTP ==
router.post("/verify-otp", verifyVendorOtp);

//== Logout ==
router.post("/logout", vendorLogout);

//== Vendor Profile ==
router.get("/profile", authenticateToken, getVendorProfile);

//== Submit Vendor Info ==
router.post("/submit-info", submitVendorInfo);

//== Admin: Get Pending Vendors ==
router.get(
  "/pending",
  authenticateToken,
  authorizeRoles("admin"),
  getPendingVendors,
);

//== Admin: Get Approved Vendors ==
router.get(
  "/approved",
  authenticateToken,
  authorizeRoles("admin"),
  getApprovedVendors,
);

//== Admin: Approve Vendor ==
router.post(
  "/approve/:vendorId",
  authenticateToken,
  authorizeRoles("admin"),
  approveVendor,
);

//== Admin: Reject Vendor ==
router.post(
  "/reject/:vendorId",
  authenticateToken,
  authorizeRoles("admin"),
  rejectVendor,
);

export default router;
