import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import { getAdminDashboardStats } from "../controllers/adminDashboardController.js";
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
  requestAdminPasswordReset,
  verifyAdminPasswordResetToken,
  resetAdminPasswordWithToken,
} from "../controllers/adminAuthController.js";
import {
  listSubscriptionPlansAdmin,
  updateSubscriptionPlanPriceAdmin,
} from "../controllers/subscriptionAdminController.js";

const router = express.Router();

router.get(
  "/dashboard-stats",
  authenticateToken,
  authorizeRoles("admin"),
  getAdminDashboardStats,
);

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
router.post("/request-password-reset", requestAdminPasswordReset);
router.post("/verify-reset-token", verifyAdminPasswordResetToken);
router.post("/reset-password", resetAdminPasswordWithToken);

router.get(
  "/subscription-plans",
  authenticateToken,
  authorizeRoles("admin"),
  listSubscriptionPlansAdmin,
);

router.patch(
  "/subscription-plans/:key",
  authenticateToken,
  authorizeRoles("admin"),
  updateSubscriptionPlanPriceAdmin,
);

export default router;
