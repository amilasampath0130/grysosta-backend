import { Response } from "express";
import Offer from "../models/Offer.js";
import { AuthRequest } from "./authController.js";
import {
  deleteCloudinaryImage,
  uploadImageBufferToCloudinary,
} from "../lib/cloudinary.js";
import User from "../models/User.js";
import { sendEmail } from "../utils/sendEmail.js";
import {
  countVendorPlanUsage,
  getVendorActivePlanKey,
  getVendorPlanDefinition,
} from "../lib/vendorBilling.js";

const ALLOWED_DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

const parseDateOrUndefined = (value: unknown): Date | undefined => {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  if (!str) return undefined;
  const date = new Date(str);
  return isNaN(date.getTime()) ? undefined : date;
};

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  const str = String(value ?? "").trim();
  if (!str) return [];

  // Accept JSON arrays or comma-separated values.
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // ignore
  }

  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const isActiveSubscriptionStatus = (status?: string) =>
  status === "active" || status === "trialing";

export const createOffer = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    if (req.user.role !== "vendor" || req.user.vendorStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Only approved vendors can create offers",
      });
    }

    const subscriptionStatus = (req.user as any)?.vendorSubscription?.status as
      | string
      | undefined;

    if (!isActiveSubscriptionStatus(subscriptionStatus)) {
      return res.status(403).json({
        success: false,
        message: "Please subscribe to a plan before creating offers",
        code: "SUBSCRIPTION_REQUIRED",
      });
    }

    const activePlanKey = getVendorActivePlanKey(req.user as any);
    if (!activePlanKey) {
      return res.status(403).json({
        success: false,
        message: "An active subscription plan is required to create offers",
        code: "SUBSCRIPTION_REQUIRED",
      });
    }

    const activePlan = getVendorPlanDefinition(activePlanKey);
    const usage = await countVendorPlanUsage(String(req.user._id));
    const offerLimit = activePlan.limits.activeOfferLimit;

    if (offerLimit !== null && usage.occupiedOfferCount >= offerLimit) {
      return res.status(409).json({
        success: false,
        code: "PLAN_LIMIT_REACHED",
        message: `Your ${activePlan.name} plan allows up to ${offerLimit} active or pending offers. Upgrade your plan or remove an existing offer to continue.`,
        planKey: activePlan.key,
        limit: offerLimit,
        currentUsage: usage.occupiedOfferCount,
      });
    }

    const title = String((req.body as any)?.title || "").trim();
    const description = String((req.body as any)?.description || "").trim();
    const offerType = String((req.body as any)?.offerType || "").trim() as
      | "bogo"
      | "percentage"
      | "flat";

    const discountValueRaw = (req.body as any)?.discountValue;
    const discountValue = Number(discountValueRaw ?? 0);

    const location = String((req.body as any)?.location || "all").trim() || "all";
    const redemptionLimit =
      String((req.body as any)?.redemptionLimit || "once_per_user").trim() ||
      "once_per_user";

    const validUntil = parseDateOrUndefined((req.body as any)?.validUntil);
    const activeDays = parseStringArray((req.body as any)?.activeDays)
      .map((d) => d.toLowerCase())
      .filter((d) => ALLOWED_DAYS.has(d));

    if (!title || title.length < 5) {
      return res.status(400).json({
        success: false,
        message: "Offer title must be at least 5 characters",
      });
    }

    if (!description || description.length < 20) {
      return res.status(400).json({
        success: false,
        message: "Offer description must be at least 20 characters",
      });
    }

    if (!offerType || !["bogo", "percentage", "flat"].includes(offerType)) {
      return res.status(400).json({
        success: false,
        message: "offerType must be one of: bogo, percentage, flat",
      });
    }

    if (offerType !== "bogo") {
      if (!Number.isFinite(discountValue) || discountValue <= 0) {
        return res.status(400).json({
          success: false,
          message: "discountValue must be greater than 0",
        });
      }

      if (offerType === "percentage" && discountValue > 100) {
        return res.status(400).json({
          success: false,
          message: "Percentage discount cannot exceed 100",
        });
      }
    }

    if (!validUntil) {
      return res
        .status(400)
        .json({ success: false, message: "validUntil is required" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const validDate = new Date(validUntil);
    validDate.setHours(0, 0, 0, 0);
    if (validDate.getTime() <= today.getTime()) {
      return res.status(400).json({
        success: false,
        message: "validUntil must be in the future",
      });
    }

    if (activeDays.length === 0) {
      return res.status(400).json({
        success: false,
        message: "activeDays must include at least one day",
      });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Offer image is required" });
    }

    const uploaded = await uploadImageBufferToCloudinary(
      req.file.buffer,
      "grysosta/offers",
    );

    const offer = await Offer.create({
      vendor: req.user._id,
      title,
      description,
      offerType,
      discountValue: offerType === "bogo" ? 0 : discountValue,
      location,
      activeDays,
      validUntil,
      redemptionLimit,
      imageUrl: uploaded.secure_url,
      imagePublicId: uploaded.public_id,
      status: "PENDING",
    });

    return res.status(201).json({
      success: true,
      message: "Offer submitted for admin review.",
      offer,
    });
  } catch (error) {
    console.error("Create offer error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to submit offer" });
  }
};

export const listMyOffers = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const offers = await Offer.find({ vendor: req.user._id })
      .sort({ createdAt: -1 })
      .select(
        "title description offerType discountValue location activeDays validUntil redemptionLimit imageUrl status reviewNote createdAt updatedAt approvedAt",
      );

    return res.json({ success: true, offers });
  } catch (error) {
    console.error("List my offers error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch offers" });
  }
};

export const listPendingOffers = async (req: AuthRequest, res: Response) => {
  try {
    const offers = await Offer.find({ status: "PENDING" })
      .sort({ createdAt: -1 })
      .populate("vendor", "name email vendorInfo")
      .select(
        "title description offerType discountValue location activeDays validUntil redemptionLimit imageUrl status createdAt vendor",
      );

    return res.json({ success: true, offers });
  } catch (error) {
    console.error("List pending offers error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch pending offers" });
  }
};

export const listActiveOffers = async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const offers = await Offer.find({
      status: "APPROVED",
      validUntil: { $gte: now },
    })
      .sort({ validUntil: 1, createdAt: -1 })
      .populate("vendor", "name email vendorInfo")
      .select(
        "title description offerType discountValue location activeDays validUntil redemptionLimit imageUrl status createdAt vendor",
      );

    return res.json({ success: true, offers });
  } catch (error) {
    console.error("List active offers error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch active offers" });
  }
};

export const approveOffer = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const offer = await Offer.findById(req.params.offerId);
    if (!offer) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    offer.status = "APPROVED";
    offer.reviewNote = undefined;
    offer.reviewedBy = req.user._id;
    offer.reviewedAt = new Date();
    offer.approvedAt = new Date();
    await offer.save();

    const vendor = await User.findById(offer.vendor).select("email");
    if (vendor?.email) {
      try {
        await sendEmail(
          vendor.email,
          "Offer Approved",
          `<h2>Your offer has been approved</h2>
           <p>Title: <strong>${offer.title}</strong></p>
           <p>Your offer is now active in the system.</p>`,
        );
      } catch (emailError) {
        console.error("Approve offer email failed:", emailError);
      }
    }

    return res.json({ success: true, message: "Offer approved" });
  } catch (error) {
    console.error("Approve offer error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to approve offer" });
  }
};

export const rejectOffer = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const reason = String((req.body as any)?.reason || "").trim();
    if (!reason) {
      return res
        .status(400)
        .json({ success: false, message: "Rejection reason is required" });
    }

    const offer = await Offer.findById(req.params.offerId);
    if (!offer) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    offer.status = "REJECTED";
    offer.reviewNote = reason;
    offer.reviewedBy = req.user._id;
    offer.reviewedAt = new Date();
    offer.approvedAt = undefined;
    await offer.save();

    const vendor = await User.findById(offer.vendor).select("email");
    if (vendor?.email) {
      try {
        await sendEmail(
          vendor.email,
          "Offer Rejected",
          `<h2>Your offer was not approved</h2>
           <p>Title: <strong>${offer.title}</strong></p>
           <p>Reason: ${reason}</p>
           <p>Please correct the issue and submit again.</p>`,
        );
      } catch (emailError) {
        console.error("Reject offer email failed:", emailError);
      }
    }

    return res.json({ success: true, message: "Offer rejected" });
  } catch (error) {
    console.error("Reject offer error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to reject offer" });
  }
};

export const deleteOffer = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const filter: any = { _id: req.params.offerId };
    if (req.user.role === "vendor") {
      filter.vendor = req.user._id;
    }

    const offer = await Offer.findOne(filter);
    if (!offer) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    if (req.user.role === "vendor" && offer.status === "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Approved offers cannot be deleted by the vendor",
      });
    }

    await Offer.deleteOne({ _id: offer._id });

    try {
      await deleteCloudinaryImage(offer.imagePublicId);
    } catch (cloudinaryError) {
      console.error("Failed to delete Cloudinary image:", cloudinaryError);
    }

    if (req.user.role === "admin") {
      const vendor = await User.findById(offer.vendor).select("email");
      if (vendor?.email) {
        try {
          await sendEmail(
            vendor.email,
            "Offer Deleted",
            `<h2>Your offer has been deleted</h2>
             <p>Title: <strong>${offer.title}</strong></p>
             <p>If you have questions, please contact support.</p>`,
          );
        } catch (emailError) {
          console.error("Delete offer email failed:", emailError);
        }
      }
    }

    return res.json({ success: true, message: "Offer deleted" });
  } catch (error) {
    console.error("Delete offer error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete offer" });
  }
};
