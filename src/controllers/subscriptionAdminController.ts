import { Request, Response } from "express";
import { requireStripe } from "../lib/stripeClient.js";
import {
  ensureSubscriptionPlans,
  updatePlanPrice,
} from "../lib/subscriptionPlans.js";
import SubscriptionPlan, { type SubscriptionPlanKey } from "../models/SubscriptionPlan.js";

export const listSubscriptionPlansAdmin = async (_req: Request, res: Response) => {
  try {
    const stripe = requireStripe();
    await ensureSubscriptionPlans(stripe);

    const plans = await SubscriptionPlan.find({}).sort({ priceCents: 1 }).lean();

    return res.json({
      success: true,
      plans: plans.map((p) => ({
        key: p.key,
        name: p.name,
        currency: p.currency,
        priceCents: p.priceCents,
        stripeProductId: p.stripeProductId,
        stripePriceId: p.stripePriceId,
        active: p.active,
      })),
    });
  } catch (error: any) {
    console.error("List subscription plans (admin) error:", error);
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Failed to load plans" });
  }
};

export const updateSubscriptionPlanPriceAdmin = async (req: Request, res: Response) => {
  try {
    const stripe = requireStripe();
    await ensureSubscriptionPlans(stripe);

    const key = String(req.params.key || "").trim() as SubscriptionPlanKey;
    if (!key || !["bronze", "silver", "gold"].includes(key)) {
      return res.status(400).json({ success: false, message: "Invalid plan key" });
    }

    const nextPriceCents = Number((req.body as any)?.priceCents);
    if (!Number.isFinite(nextPriceCents) || !Number.isInteger(nextPriceCents) || nextPriceCents <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "priceCents must be a positive integer" });
    }

    const plan = await updatePlanPrice(stripe, key, nextPriceCents);

    return res.json({
      success: true,
      plan: {
        key: plan.key,
        name: plan.name,
        currency: plan.currency,
        priceCents: plan.priceCents,
        stripePriceId: plan.stripePriceId,
      },
    });
  } catch (error: any) {
    console.error("Update subscription plan price (admin) error:", error);
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Failed to update price" });
  }
};
