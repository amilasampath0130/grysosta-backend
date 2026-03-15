import mongoose, { type InferSchemaType } from "mongoose";

export type SubscriptionPlanKey = "bronze" | "silver" | "gold";

const subscriptionPlanSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      enum: ["bronze", "silver", "gold"],
      required: true,
      unique: true,
    },
    name: { type: String, required: true },
    currency: { type: String, default: "usd" },
    priceCents: { type: Number, required: true, min: 0 },
    stripeProductId: { type: String },
    stripePriceId: { type: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type SubscriptionPlanDocument = InferSchemaType<typeof subscriptionPlanSchema>;

const SubscriptionPlan =
  mongoose.models.SubscriptionPlan ||
  mongoose.model("SubscriptionPlan", subscriptionPlanSchema);

export default SubscriptionPlan;
