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
  deleteUser,
  deleteVendor,
} from "../controllers/adminAuthController.js";

const router = express.Router();

router.get("/users", authenticateToken, authorizeRoles("admin"), getAllUsers);
router.delete(
  "/users/:userId",
  authenticateToken,
  authorizeRoles("admin"),
  deleteUser,
);
router.get("/admins", authenticateToken, authorizeRoles("admin"), getAllAdmins);
router.delete(
  "/vendors/:vendorId",
  authenticateToken,
  authorizeRoles("admin"),
  deleteVendor,
);
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
