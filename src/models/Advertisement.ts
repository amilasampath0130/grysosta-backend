import mongoose, { Types } from "mongoose";

export interface IAdvertisement {
  _id: Types.ObjectId;
  vendor: Types.ObjectId;
  title: string;
  content: string;
  advertisementType: "banner" | "sidebar" | "popup";
  imageUrl: string;
  imagePublicId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  approvedAt?: Date;
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

const Advertisement = mongoose.model<IAdvertisement>(
  "Advertisement",
  advertisementSchema,
);

export default Advertisement;
