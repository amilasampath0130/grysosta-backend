import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import { getAllUsers } from "../controllers/adminAuthController.js";


const router = express.Router();

router.get(
  "/users",
  authenticateToken,
  authorizeRoles("admin"),
  getAllUsers
);

export default router;
