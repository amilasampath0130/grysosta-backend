import mongoose, { Types } from "mongoose";

export type OfferType = "bogo" | "percentage" | "flat";
export type OfferStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface IOffer {
  _id: Types.ObjectId;
  vendor: Types.ObjectId;
  title: string;
  description: string;
  offerType: OfferType;
  discountValue: number;
  location: string;
  activeDays: string[];
  validUntil: Date;
  redemptionLimit: string;
  imageUrl: string;
  imagePublicId: string;
  status: OfferStatus;
  reviewNote?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const offerSchema = new mongoose.Schema<IOffer>(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    offerType: {
      type: String,
      enum: ["bogo", "percentage", "flat"],
      required: true,
    },
    discountValue: { type: Number, required: true, default: 0 },
    location: { type: String, default: "all", trim: true },
    activeDays: { type: [String], default: [] },
    validUntil: { type: Date, required: true },
    redemptionLimit: { type: String, default: "once_per_user", trim: true },
    imageUrl: { type: String, required: true },
    imagePublicId: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    reviewNote: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    approvedAt: { type: Date },
  },
  { timestamps: true },
);

const Offer = mongoose.model<IOffer>("Offer", offerSchema);

export default Offer;
