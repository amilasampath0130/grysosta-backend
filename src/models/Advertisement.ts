import mongoose, { Types } from "mongoose";

export interface IAdvertisement {
  _id: Types.ObjectId;
  vendor: Types.ObjectId;
  title: string;
  content: string;
  advertisementType: "banner" | "sidebar" | "popup";
  startDate?: Date;
  endDate?: Date;
  imageUrl: string;
  imagePublicId: string;
  isPaid: boolean;
  paidAt?: Date;
  paidFrom?: Date;
  paidThrough?: Date;
  pendingPaymentCoverageStart?: Date;
  pendingPaymentCoverageEnd?: Date;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  paymentAmountCents?: number;
  paymentCurrency?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "STOPPED";
  reviewNote?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  approvedAt?: Date;
  stoppedAt?: Date;
  stoppedBy?: Types.ObjectId;
  stopNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const advertisementSchema = new mongoose.Schema<IAdvertisement>(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true, trim: true },
    advertisementType: {
      type: String,
      enum: ["banner", "sidebar", "popup"],
      required: true,
    },
    startDate: { type: Date },
    endDate: { type: Date },
    imageUrl: { type: String, required: true },
    imagePublicId: { type: String, required: true },
    isPaid: { type: Boolean, default: false, index: true },
    paidAt: { type: Date },
    paidFrom: { type: Date },
    paidThrough: { type: Date },
    pendingPaymentCoverageStart: { type: Date },
    pendingPaymentCoverageEnd: { type: Date },
    stripeCheckoutSessionId: { type: String, index: true },
    stripePaymentIntentId: { type: String, index: true },
    paymentAmountCents: { type: Number },
    paymentCurrency: { type: String },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "STOPPED"],
      default: "PENDING",
      index: true,
    },
    reviewNote: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    approvedAt: { type: Date },
    stoppedAt: { type: Date },
    stoppedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    stopNote: { type: String },
  },
  { timestamps: true },
);

const Advertisement = mongoose.model<IAdvertisement>(
  "Advertisement",
  advertisementSchema,
);

export default Advertisement;
