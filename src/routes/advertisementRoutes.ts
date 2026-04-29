import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import { uploadAdvertisementImage } from "../middleware/upload.js";
import {
  approveAdvertisement,
  createAdvertisement,
  deleteAdvertisement,
  getMyAdvertisementById,
  informAdvertisementVendor,
  listActiveAdvertisements,
  listAdminAdvertisements,
  listMyAdvertisements,
  listPublicActiveAdvertisements,
  listAdvertisementsByVendor,
  listPendingAdvertisements,
  rejectAdvertisement,
  resubmitRejectedAdvertisement,
  stopAdvertisement,
  updateAdvertisement,
} from "../controllers/advertisementController.js";

const router = express.Router();

router.post("/", authenticateToken, authorizeRoles("vendor"), uploadAdvertisementImage, createAdvertisement);
router.get("/me", authenticateToken, authorizeRoles("vendor"), listMyAdvertisements);

router.get(
  "/by-vendor/:vendorId",
  authenticateToken,
  authorizeRoles("admin"),
  listAdvertisementsByVendor,
);

router.post(
  "/stop/:advertisementId",
  authenticateToken,
  authorizeRoles("admin"),
  stopAdvertisement,
);

router.post(
  "/inform/:advertisementId",
  authenticateToken,
  authorizeRoles("admin"),
  informAdvertisementVendor,
);

router.post(
  "/resubmit/:advertisementId",
  authenticateToken,
  authorizeRoles("vendor"),
  resubmitRejectedAdvertisement,
);

router.get(
  "/pending",
  authenticateToken,
  authorizeRoles("admin"),
  listPendingAdvertisements,
);

router.get(
  "/active",
  authenticateToken,
  authorizeRoles("admin"),
  listActiveAdvertisements,
);
router.get(
  "/admin/all",
  authenticateToken,
  authorizeRoles("admin"),
  listAdminAdvertisements,
);

router.get("/public/active", listPublicActiveAdvertisements);

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

router.get(
  "/:advertisementId",
  authenticateToken,
  authorizeRoles("vendor"),
  getMyAdvertisementById,
);

router.patch(
  "/:advertisementId",
  authenticateToken,
  authorizeRoles("vendor"),
  uploadAdvertisementImage,
  updateAdvertisement,
);

router.delete(
  "/:advertisementId",
  authenticateToken,
  authorizeRoles("vendor", "admin"),
  deleteAdvertisement,
);

export default router;
