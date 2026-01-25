import express from "express";
import {
  register,
  login,
  profile,
  verifyOtp,
  resendOtp,
} from "../controllers/authController.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import {
  adminLogin,
  getAdminProfile,
  verifyAdminOtp,
} from "../controllers/adminAuthController.js";

const router = express.Router();

// PUBLIC
router.post("/register", register);
router.post("/login", login);
router.post("/verify-otp", verifyOtp);
router.post("/resend-otp", resendOtp);

// PROTECTED
router.get("/profile", authenticateToken, profile);

// Admin route only
// router.post("/admin/login", adminLogin);
// router.get(
//   "/admin/profile",
//   authenticateToken,
//   authorizeRoles("admin"),
//   getAdminProfile
// );
// router.post("/admin/verify-otp", verifyAdminOtp);
export default router;
