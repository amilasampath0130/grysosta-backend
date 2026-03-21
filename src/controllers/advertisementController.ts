import { Response } from "express";
import Advertisement from "../models/Advertisement.js";
import { AuthRequest } from "./authController.js";
import {
  deleteCloudinaryImage,
  uploadImageBufferToCloudinary,
} from "../lib/cloudinary.js";
import { sendEmail } from "../utils/sendEmail.js";
import User from "../models/User.js";

const parseDateOrUndefined = (value: unknown): Date | undefined => {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  if (!str) return undefined;
  const date = new Date(str);
  return isNaN(date.getTime()) ? undefined : date;
};

const validateStartEndDates = (startDate?: Date, endDate?: Date): string | null => {
  if (!startDate || !endDate) return "startDate and endDate are required";
  if (endDate.getTime() < startDate.getTime()) {
    return "endDate must be the same as or after startDate";
  }
  return null;
};

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

    const subscriptionStatus = (req.user as any)?.vendorSubscription?.status as
      | string
      | undefined;
    const hasActiveSubscription =
      subscriptionStatus === "active" || subscriptionStatus === "trialing";

    if (!hasActiveSubscription) {
      return res.status(403).json({
        success: false,
        message: "Please subscribe to a plan before creating advertisements",
        code: "SUBSCRIPTION_REQUIRED",
      });
    }

    // Enforce: only one pending advertisement at a time.
    // Vendors should pay / wait for approval instead of creating another.
    const existingPending = await Advertisement.findOne({
      vendor: req.user._id,
      status: "PENDING",
    })
      .sort({ createdAt: -1 })
      .select("_id isPaid");

    if (existingPending) {
      return res.status(409).json({
        success: false,
        message:
          existingPending.isPaid === false
            ? "You already have a pending advertisement. Complete payment to submit it for admin approval."
            : "You already have a pending advertisement awaiting admin approval.",
        advertisement: existingPending,
      });
    }

    const { title, content, advertisementType, startDate, endDate } = req.body as {
      title?: string;
      content?: string;
      advertisementType?: "banner" | "sidebar" | "popup";
      startDate?: string;
      endDate?: string;
    };

    if (!title || !content || !advertisementType) {
      return res.status(400).json({
        success: false,
        message: "title, content, and advertisementType are required",
      });
    }

    const parsedStart = parseDateOrUndefined(startDate);
    const parsedEnd = parseDateOrUndefined(endDate);
    const dateError = validateStartEndDates(parsedStart, parsedEnd);
    if (dateError) {
      return res.status(400).json({ success: false, message: dateError });
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
      startDate: parsedStart!,
      endDate: parsedEnd!,
      imageUrl: uploaded.secure_url,
      imagePublicId: uploaded.public_id,
      isPaid: false,
      paidAt: undefined,
      paidFrom: undefined,
      paidThrough: undefined,
      pendingPaymentCoverageStart: undefined,
      pendingPaymentCoverageEnd: undefined,
      stripeCheckoutSessionId: undefined,
      stripePaymentIntentId: undefined,
      status: "PENDING",
    });

    return res.status(201).json({
      success: true,
      message:
        "Advertisement created. Complete payment to submit it for admin approval.",
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
        "title content advertisementType startDate endDate imageUrl status reviewNote stopNote createdAt updatedAt approvedAt isPaid paidAt paidFrom paidThrough paymentAmountCents paymentCurrency",
      );

    return res.json({ success: true, advertisements });
  } catch (error) {
    console.error("List my advertisements error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch advertisements" });
  }
};

export const getMyAdvertisementById = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const advertisement = await Advertisement.findOne({
      _id: req.params.advertisementId,
      vendor: req.user._id,
    }).select(
      "title content advertisementType startDate endDate imageUrl status reviewNote stopNote createdAt updatedAt approvedAt isPaid paidAt paidFrom paidThrough paymentAmountCents paymentCurrency",
    );

    if (!advertisement) {
      return res
        .status(404)
        .json({ success: false, message: "Advertisement not found" });
    }

    return res.json({ success: true, advertisement });
  } catch (error) {
    console.error("Get my advertisement error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch advertisement" });
  }
};

export const updateAdvertisement = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    if (req.user.role !== "vendor" || req.user.vendorStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Only approved vendors can edit advertisements",
      });
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

    // If this advertisement was paid using older records (isPaid=true but no coverage dates),
    // assume the paid coverage was for the existing schedule at the time.
    if (
      advertisement.isPaid === true &&
      !advertisement.paidThrough &&
      advertisement.startDate &&
      advertisement.endDate
    ) {
      advertisement.paidFrom = advertisement.startDate;
      advertisement.paidThrough = advertisement.endDate;
    }

    const { title, content, advertisementType, startDate, endDate } = req.body as {
      title?: string;
      content?: string;
      advertisementType?: "banner" | "sidebar" | "popup";
      startDate?: string;
      endDate?: string;
    };

    if (title !== undefined) advertisement.title = String(title).trim();
    if (content !== undefined) advertisement.content = String(content).trim();
    if (advertisementType !== undefined)
      advertisement.advertisementType = advertisementType;

    const previousStartDate = advertisement.startDate;

    const nextStart =
      startDate !== undefined
        ? parseDateOrUndefined(startDate)
        : advertisement.startDate;
    const nextEnd =
      endDate !== undefined ? parseDateOrUndefined(endDate) : advertisement.endDate;

    const dateError = validateStartEndDates(nextStart, nextEnd);
    if (dateError) {
      return res.status(400).json({ success: false, message: dateError });
    }

    advertisement.startDate = nextStart!;
    advertisement.endDate = nextEnd!;

    // Payment rules:
    // - If the schedule changes, the vendor may need to pay again.
    // - Extending the end date beyond the previously paid coverage requires another payment.
    // - If start date changes on a previously paid ad, we reset the paid coverage and require payment again.
    const startDateChanged =
      Boolean(previousStartDate && advertisement.startDate) &&
      previousStartDate!.getTime() !== advertisement.startDate!.getTime();

    if (
      startDateChanged &&
      (advertisement.paidFrom || advertisement.paidThrough || advertisement.isPaid)
    ) {
      advertisement.isPaid = false;
      advertisement.paidAt = undefined;
      advertisement.paidFrom = undefined;
      advertisement.paidThrough = undefined;
      advertisement.pendingPaymentCoverageStart = undefined;
      advertisement.pendingPaymentCoverageEnd = undefined;
    } else if (advertisement.paidThrough && advertisement.endDate) {
      advertisement.isPaid = advertisement.endDate.getTime() <= advertisement.paidThrough.getTime();
    }

    if (!advertisement.title || !advertisement.content || !advertisement.advertisementType) {
      return res.status(400).json({
        success: false,
        message: "title, content, and advertisementType are required",
      });
    }

    if (req.file) {
      const uploaded = await uploadImageBufferToCloudinary(req.file.buffer);
      const oldPublicId = advertisement.imagePublicId;
      advertisement.imageUrl = uploaded.secure_url;
      advertisement.imagePublicId = uploaded.public_id;

      try {
        if (oldPublicId) await deleteCloudinaryImage(oldPublicId);
      } catch (cloudinaryError) {
        console.error("Failed to delete old Cloudinary image:", cloudinaryError);
      }
    }

    // Any edit after review should go back to pending for re-review
    if (advertisement.status !== "PENDING") {
      advertisement.status = "PENDING";
      advertisement.reviewNote = undefined;
      advertisement.reviewedBy = undefined;
      advertisement.reviewedAt = undefined;
      advertisement.approvedAt = undefined;
      advertisement.stoppedAt = undefined;
      advertisement.stoppedBy = undefined;
      advertisement.stopNote = undefined;
    }

    await advertisement.save();

    return res.json({
      success: true,
      message: "Advertisement updated and submitted for approval",
      advertisement,
    });
  } catch (error) {
    console.error("Update advertisement error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update advertisement" });
  }
};

export const listPendingAdvertisements = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const advertisements = await Advertisement.find({
      status: "PENDING",
      $or: [{ isPaid: true }, { isPaid: { $exists: false } }],
    })
      .sort({ createdAt: -1 })
      .populate("vendor", "name email vendorInfo")
      .select(
        "title content advertisementType startDate endDate imageUrl status createdAt vendor reviewNote isPaid paidAt paymentAmountCents paymentCurrency",
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

export const listActiveAdvertisements = async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();

    const advertisements = await Advertisement.find({
      status: "APPROVED",
      $or: [{ isPaid: true }, { isPaid: { $exists: false } }],
      $and: [
        { $or: [{ startDate: { $exists: false } }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: { $exists: false } }, { endDate: { $gte: now } }] },
      ],
    })
      .sort({ endDate: 1, startDate: 1, createdAt: -1 })
      .populate("vendor", "name email vendorInfo")
      .select(
        "title content advertisementType startDate endDate imageUrl status createdAt vendor approvedAt isPaid paidAt paidFrom paidThrough paymentAmountCents paymentCurrency",
      );

    return res.json({ success: true, advertisements });
  } catch (error) {
    console.error("List active advertisements error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch active advertisements",
    });
  }
};

export const listAdvertisementsByVendor = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const vendorId = String(req.params.vendorId || "").trim();
    if (!vendorId) {
      return res
        .status(400)
        .json({ success: false, message: "vendorId is required" });
    }

    const advertisements = await Advertisement.find({
      vendor: vendorId,
      $or: [{ isPaid: true }, { isPaid: { $exists: false } }],
    })
      .sort({ createdAt: -1 })
      .select(
        "title content advertisementType startDate endDate imageUrl status reviewNote stopNote createdAt updatedAt approvedAt isPaid paidAt paidFrom paidThrough paymentAmountCents paymentCurrency",
      );

    return res.json({ success: true, advertisements });
  } catch (error) {
    console.error("List advertisements by vendor error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch vendor advertisements",
    });
  }
};

export const stopAdvertisement = async (req: AuthRequest, res: Response) => {
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

    const note = String(req.body?.reason || req.body?.note || "").trim();

    advertisement.status = "STOPPED";
    advertisement.stoppedAt = new Date();
    advertisement.stoppedBy = req.user._id;
    advertisement.stopNote = note || "Stopped by admin";
    advertisement.reviewedAt = new Date();
    advertisement.reviewedBy = req.user._id;

    await advertisement.save();

    const vendor = await User.findById(advertisement.vendor).select("email");
    if (vendor?.email) {
      try {
        await sendEmail(
          vendor.email,
          "Advertisement Stopped",
          `<h2>Your advertisement has been stopped</h2>
           <p>Title: <strong>${advertisement.title}</strong></p>
           <p>Message: ${advertisement.stopNote}</p>`,
        );
      } catch (emailError) {
        console.error("Stop advertisement email failed:", emailError);
      }
    }

    return res.json({ success: true, message: "Advertisement stopped" });
  } catch (error) {
    console.error("Stop advertisement error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to stop advertisement" });
  }
};

export const informAdvertisementVendor = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized request" });
    }

    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "message is required" });
    }

    const advertisement = await Advertisement.findById(req.params.advertisementId);
    if (!advertisement) {
      return res
        .status(404)
        .json({ success: false, message: "Advertisement not found" });
    }

    const vendor = await User.findById(advertisement.vendor).select("email name");
    if (!vendor?.email) {
      return res.status(400).json({
        success: false,
        message: "Vendor email not found for this advertisement",
      });
    }

    await sendEmail(
      vendor.email,
      "Advertisement Information",
      `<h2>Advertisement Update</h2>
       <p>Title: <strong>${advertisement.title}</strong></p>
       <p>${message}</p>`,
    );

    return res.json({ success: true, message: "Vendor informed" });
  } catch (error) {
    console.error("Inform advertisement vendor error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to inform vendor" });
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
