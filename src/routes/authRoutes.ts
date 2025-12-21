import express from "express";
import {
  register,
  login,
  profile,
} from "../controllers/authController.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import { adminLogin } from "../controllers/adminAuthController.js";

const router = express.Router();

// PUBLIC
router.post("/register", register);
router.post("/login", login);

// PROTECTED
router.get("/profile", authenticateToken, profile);

// Admin route only
router.post("/admin/login",adminLogin);
router.get(
  "/admin/profile",
  authenticateToken,
  authorizeRoles("admin"),
  profile
)
export default router;
