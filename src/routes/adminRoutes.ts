import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import {
  adminLogin,
  getAdminProfile,
  getAllUsers,
  verifyAdminOtp,
  resendAdminOtp,
  adminOtpStatus,
  getAllAdmins,
} from "../controllers/adminAuthController.js";

const router = express.Router();

router.get("/users", authenticateToken, authorizeRoles("admin"), getAllUsers);
router.get("/admins", authenticateToken, authorizeRoles("admin"), getAllAdmins);
router.post("/login", adminLogin);
router.post("/resend-otp", resendAdminOtp);
router.get("/otp-status", adminOtpStatus);
router.get(
  "/profile",
  authenticateToken,
  authorizeRoles("admin"),
  getAdminProfile,
);
router.post("/verify-otp", verifyAdminOtp);

export default router;
