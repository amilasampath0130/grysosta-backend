import express from "express";
import {
  vendorLogin,
  verifyVendorOtp,
  resendVendorOtp,
  vendorOtpStatus,
  getVendorProfile,
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
//== Vendor Profile ==
router.get("/profile", authenticateToken, getVendorProfile);

export default router;
