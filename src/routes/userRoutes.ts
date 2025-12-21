import express from "express";


const router = express.Router();

//Only admin can access this route
router.get("/admin", (req, res) => {
  res.json({ message: "WELLCOME ADMIN" });
});
router.get("/vendor", (req, res) => {
  res.json({ message: "WELLCOME VENDOR" });
});
router.get("/user", (req, res) => {
  res.json({ message: "WELLCOME USER" });
});

export default router;

