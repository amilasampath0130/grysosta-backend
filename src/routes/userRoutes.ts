import express from "express";
import { authenticateToken } from "../middleware/auth.js";


const router = express.Router();

//Only admin can access this route
router.get("/admin", authenticateToken, (req, res) => {
  res.json({ message: "WELLCOME ADMIN" });
});
router.get("/vendor", (req, res) => {
  res.json({ message: "WELLCOME VENDOR" });
});
router.get("/user", authenticateToken, (req, res) => {
  res.json({ message: "WELLCOME USER" });
});

export default router;

