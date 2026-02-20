import { Response } from "express";
import Advertisement from "../models/Advertisement.js";
import { AuthRequest } from "./authController.js";
import {
  deleteCloudinaryImage,
  uploadImageBufferToCloudinary,
} from "../lib/cloudinary.js";
import { sendEmail } from "../utils/sendEmail.js";
import User from "../models/User.js";

export const createAdvertisement = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    if (req.user.role !== "vendor" || req.user.vendorStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Only approved vendors can submit advertisements",
      });
    }

    const { title, content, advertisementType } = req.body as {
      title?: string;
      content?: string;
      advertisementType?: "banner" | "sidebar" | "popup";
    };

    if (!title || !content || !advertisementType) {
      return res.status(400).json({
        success: false,
        message: "title, content, and advertisementType are required",
      });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Advertisement image is required" });
    }

    const uploaded = await uploadImageBufferToCloudinary(req.file.buffer);

    const advertisement = await Advertisement.create({
      vendor: req.user._id,
      title: title.trim(),
      content: content.trim(),
      advertisementType,
      imageUrl: uploaded.secure_url,
      imagePublicId: uploaded.public_id,
      status: "PENDING",
    });

    return res.status(201).json({
      success: true,
      message: "Advertisement submitted for approval",
      advertisement,
    });
  } catch (error) {
    console.error("Create advertisement error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to submit advertisement" });
  }
};

export const listMyAdvertisements = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const advertisements = await Advertisement.find({ vendor: req.user._id })
      .sort({ createdAt: -1 })
      .select(
        "title content advertisementType imageUrl status reviewNote createdAt updatedAt approvedAt",
      );

    return res.json({ success: true, advertisements });
  } catch (error) {
    console.error("List my advertisements error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch advertisements" });
  }
};

export const listPendingAdvertisements = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const advertisements = await Advertisement.find({ status: "PENDING" })
      .sort({ createdAt: -1 })
      .populate("vendor", "name email vendorInfo")
      .select(
        "title content advertisementType imageUrl status createdAt vendor reviewNote",
      );

    return res.json({ success: true, advertisements });
  } catch (error) {
    console.error("List pending advertisements error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending advertisements",
    });
  }
};

export const approveAdvertisement = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const advertisement = await Advertisement.findById(req.params.advertisementId);
    if (!advertisement) {
      return res
        .status(404)
        .json({ success: false, message: "Advertisement not found" });
    }

    advertisement.status = "APPROVED";
    advertisement.reviewNote = undefined;
    advertisement.reviewedBy = req.user._id;
    advertisement.reviewedAt = new Date();
    advertisement.approvedAt = new Date();

    await advertisement.save();

    const vendor = await User.findById(advertisement.vendor).select("email");
    if (vendor?.email) {
      try {
        await sendEmail(
          vendor.email,
          "Advertisement Approved",
          `<h2>Your advertisement has been approved</h2>
           <p>Title: <strong>${advertisement.title}</strong></p>
           <p>Your advertisement is now active in the system.</p>`,
        );
      } catch (emailError) {
        console.error("Approve advertisement email failed:", emailError);
      }
    }

    return res.json({ success: true, message: "Advertisement approved" });
  } catch (error) {
    console.error("Approve advertisement error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to approve advertisement" });
  }
};

export const rejectAdvertisement = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const reason = String(req.body.reason || "").trim();
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required",
      });
    }

    const advertisement = await Advertisement.findById(req.params.advertisementId);
    if (!advertisement) {
      return res
        .status(404)
        .json({ success: false, message: "Advertisement not found" });
    }

    advertisement.status = "REJECTED";
    advertisement.reviewNote = reason;
    advertisement.reviewedBy = req.user._id;
    advertisement.reviewedAt = new Date();
    advertisement.approvedAt = undefined;

    await advertisement.save();

    const vendor = await User.findById(advertisement.vendor).select("email");
    if (vendor?.email) {
      try {
        await sendEmail(
          vendor.email,
          "Advertisement Verification Failed",
          `<h2>Your advertisement was not approved</h2>
           <p>Title: <strong>${advertisement.title}</strong></p>
           <p>Reason: ${reason}</p>
           <p>Please correct the issue and submit again.</p>`,
        );
      } catch (emailError) {
        console.error("Reject advertisement email failed:", emailError);
      }
    }

    return res.json({ success: true, message: "Advertisement rejected" });
  } catch (error) {
    console.error("Reject advertisement error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to reject advertisement" });
  }
};

export const resubmitRejectedAdvertisement = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const advertisement = await Advertisement.findOne({
      _id: req.params.advertisementId,
      vendor: req.user._id,
    });

    if (!advertisement) {
      return res
        .status(404)
        .json({ success: false, message: "Advertisement not found" });
    }

    if (advertisement.status !== "REJECTED") {
      return res.status(400).json({
        success: false,
        message: "Only rejected advertisements can be resubmitted",
      });
    }

    advertisement.status = "PENDING";
    advertisement.reviewNote = undefined;
    advertisement.reviewedBy = undefined;
    advertisement.reviewedAt = undefined;
    advertisement.approvedAt = undefined;
    await advertisement.save();

    return res.json({
      success: true,
      message: "Advertisement resubmitted for approval",
    });
  } catch (error) {
    console.error("Resubmit advertisement error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to resubmit advertisement",
    });
  }
};

export const deleteAdvertisement = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const filter: any = { _id: req.params.advertisementId };
    if (req.user.role === "vendor") {
      filter.vendor = req.user._id;
    }

    const advertisement = await Advertisement.findOne(filter);
    if (!advertisement) {
      return res
        .status(404)
        .json({ success: false, message: "Advertisement not found" });
    }

    await Advertisement.deleteOne({ _id: advertisement._id });

    try {
      await deleteCloudinaryImage(advertisement.imagePublicId);
    } catch (cloudinaryError) {
      console.error("Failed to delete Cloudinary image:", cloudinaryError);
    }

    return res.json({ success: true, message: "Advertisement deleted" });
  } catch (error) {
    console.error("Delete advertisement error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete advertisement" });
  }
};
