import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import { adminLogin, getAdminProfile, getAllUsers, verifyAdminOtp } from "../controllers/adminAuthController.js";


const router = express.Router();

router.get(
  "/users",
  authenticateToken,
  authorizeRoles("admin"),
  getAllUsers
);
router.post("/login", adminLogin);
router.get(
  "/profile",
  authenticateToken,
  authorizeRoles("admin"),
  getAdminProfile
);
router.post("/verify-otp", verifyAdminOtp);

export default router;
