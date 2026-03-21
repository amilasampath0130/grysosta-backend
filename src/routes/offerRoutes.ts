import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import { uploadOfferImage } from "../middleware/upload.js";
import {
  approveOffer,
  createOffer,
  deleteOffer,
  listActiveOffers,
  listMyOffers,
  listPendingOffers,
  rejectOffer,
} from "../controllers/offerController.js";
const router = express.Router();

router.post(
  "/",
  authenticateToken,
  authorizeRoles("vendor"),
  uploadOfferImage,
  createOffer,
);
router.get(
  "/active",
  authenticateToken,
  authorizeRoles("admin"),
  listActiveOffers,
);
router.get("/me", authenticateToken, authorizeRoles("vendor"), listMyOffers);

router.get(
  "/pending",
  authenticateToken,
  authorizeRoles("admin"),
  listPendingOffers,
);
router.post(
  "/approve/:offerId",
  authenticateToken,
  authorizeRoles("admin"),
  approveOffer,
);
router.post(
  "/reject/:offerId",
  authenticateToken,
  authorizeRoles("admin"),
  rejectOffer,
);

router.delete(
  "/:offerId",
  authenticateToken,
  authorizeRoles("vendor", "admin"),
  deleteOffer,
);

export default router;
