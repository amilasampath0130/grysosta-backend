import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import { uploadAdvertisementImage } from "../middleware/upload.js";
import {
  approveAdvertisement,
  createAdvertisement,
  deleteAdvertisement,
  listMyAdvertisements,
  listPendingAdvertisements,
  rejectAdvertisement,
  resubmitRejectedAdvertisement,
} from "../controllers/advertisementController.js";

const router = express.Router();

router.post("/", authenticateToken, authorizeRoles("vendor"), uploadAdvertisementImage, createAdvertisement);
router.get("/me", authenticateToken, authorizeRoles("vendor"), listMyAdvertisements);
router.post(
  "/resubmit/:advertisementId",
  authenticateToken,
  authorizeRoles("vendor"),
  resubmitRejectedAdvertisement,
);
router.delete(
  "/:advertisementId",
  authenticateToken,
  authorizeRoles("vendor", "admin"),
  deleteAdvertisement,
);

router.get(
  "/pending",
  authenticateToken,
  authorizeRoles("admin"),
  listPendingAdvertisements,
);
router.post(
  "/approve/:advertisementId",
  authenticateToken,
  authorizeRoles("admin"),
  approveAdvertisement,
);
router.post(
  "/reject/:advertisementId",
  authenticateToken,
  authorizeRoles("admin"),
  rejectAdvertisement,
);

export default router;
