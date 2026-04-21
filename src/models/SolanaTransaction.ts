import mongoose, { Document, Schema } from "mongoose";

export interface ISolanaTransaction extends Document {
  signature: string;
  recipient: string;
  payer?: string;
  amountSol: number;
  amountLamports: number;
  network: "devnet" | "testnet" | "mainnet-beta";
  reference?: string;
  label?: string;
  message?: string;
  slot?: number;
  blockTime?: number;
  status: "verified" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const SolanaTransactionSchema = new Schema<ISolanaTransaction>(
  {
    signature: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    recipient: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    payer: {
      type: String,
      trim: true,
    },
    amountSol: {
      type: Number,
      required: true,
      min: 0,
    },
    amountLamports: {
      type: Number,
      required: true,
      min: 0,
    },
    network: {
      type: String,
      enum: ["devnet", "testnet", "mainnet-beta"],
      default: "devnet",
      required: true,
    },
    reference: {
      type: String,
      trim: true,
      index: true,
    },
    label: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 240,
    },
    slot: {
      type: Number,
    },
    blockTime: {
      type: Number,
    },
    status: {
      type: String,
      enum: ["verified", "failed"],
      default: "verified",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

const SolanaTransaction = mongoose.model<ISolanaTransaction>(
  "SolanaTransaction",
  SolanaTransactionSchema,
);

export default SolanaTransaction;
