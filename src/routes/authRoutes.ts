import express from "express";
import {
  register,
  login,
  profile,
  authenticateToken
} from "../controllers/authController.js";

const router = express.Router();

// PUBLIC
router.post("/register", register);
router.post("/login", login);

// PROTECTED
router.get("/profile", authenticateToken, profile);

export default router;
