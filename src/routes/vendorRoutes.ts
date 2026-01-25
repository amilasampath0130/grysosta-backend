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
router.post("/submit-info", authenticateToken, submitVendorInfo);

//== Admin: Get Pending Vendors ==
router.get("/pending", authenticateToken, getPendingVendors);

//== Admin: Get Approved Vendors ==
router.get("/approved", authenticateToken, getApprovedVendors);

//== Admin: Approve Vendor ==
router.post("/approve/:vendorId", authenticateToken, approveVendor);

//== Admin: Reject Vendor ==
router.post("/reject/:vendorId", authenticateToken, rejectVendor);

export default router;
