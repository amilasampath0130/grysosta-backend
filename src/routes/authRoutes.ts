import express from "express";
import {
  register,
  login,
  profile,
} from "../controllers/authController.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// PUBLIC
router.post("/register", register);
router.post("/login", login);

// PROTECTED
router.get("/profile", authenticateToken, profile);

export default router;
