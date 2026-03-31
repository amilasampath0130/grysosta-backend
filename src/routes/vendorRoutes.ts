import express from "express";
import {
  vendorLogin,
  verifyVendorOtp,
  resendVendorOtp,
  vendorOtpStatus,
  getVendorProfile,
  vendorLogout,
  submitVendorInfo,
  saveVendorProgress,
  approveVendor,
  rejectVendor,
  getPendingVendors,
  getApprovedVendors,
  getPublicApprovedVendors,
  getVendorApplicationById,
} from "../controllers/vendorAuthController.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import { uploadVendorDocuments } from "../middleware/upload.js";
import { optionalAuthenticateToken } from "../middleware/optionalAuth.js";

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

//== Save Vendor Onboarding Progress (Draft) ==
router.post("/save-progress", optionalAuthenticateToken, saveVendorProgress);

//== Submit Vendor Info ==
router.post(
  "/submit-info",
  optionalAuthenticateToken,
  uploadVendorDocuments,
  submitVendorInfo,
);

//== Public: Get Approved Vendors (Mobile) ==
router.get("/public/approved", getPublicApprovedVendors);

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

//== Admin: Get Vendor Application Details ==
router.get(
  "/application/:vendorId",
  authenticateToken,
  authorizeRoles("admin"),
  getVendorApplicationById,
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
