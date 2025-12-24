import express from "express";
import {
  vendorLogin,
  verifyVendorOtp,
  getVendorProfile
} from "../controllers/vendorAuthController.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

//================================vendor routes============================//

//== Vendor Login ==
router.post("/login", vendorLogin);

//== Verify OTP ==
router.post("/verify-otp", verifyVendorOtp);
//== Vendor Profile ==
router.get("/profile", authenticateToken, getVendorProfile);

export default router;
