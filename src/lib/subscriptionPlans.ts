import type Stripe from "stripe";
import SubscriptionPlan, { type SubscriptionPlanKey } from "../models/SubscriptionPlan.js";

const DEFAULT_PLANS: Array<{
  key: SubscriptionPlanKey;
  name: string;
  priceCents: number;
  currency: string;
}> = [
  { key: "bronze", name: "Bronze Plan", priceCents: 1900, currency: "usd" },
  { key: "silver", name: "Silver Plan", priceCents: 4900, currency: "usd" },
  { key: "gold", name: "Gold Plan", priceCents: 9900, currency: "usd" },
];

export const ensureSubscriptionPlans = async (stripe: Stripe | null) => {
  const existing = await SubscriptionPlan.find({
    key: { $in: DEFAULT_PLANS.map((p) => p.key) },
  }).lean();

  const existingKeys = new Set(existing.map((p) => p.key));
  const toCreate = DEFAULT_PLANS.filter((p) => !existingKeys.has(p.key));

  if (toCreate.length) {
    await SubscriptionPlan.insertMany(
      toCreate.map((p) => ({
        key: p.key,
        name: p.name,
        priceCents: p.priceCents,
        currency: p.currency,
        active: true,
      })),
      { ordered: false },
    );
  }

  if (!stripe) {
    return;
  }

  const plans = await SubscriptionPlan.find({
    key: { $in: DEFAULT_PLANS.map((p) => p.key) },
  });

  for (const plan of plans) {
    if (!plan.stripeProductId) {
      const product = await stripe.products.create({
        name: plan.name,
        metadata: { planKey: plan.key },
      });
      plan.stripeProductId = product.id;
    }

    if (!plan.stripePriceId) {
      const price = await stripe.prices.create({
        product: plan.stripeProductId,
        currency: plan.currency || "usd",
        unit_amount: plan.priceCents,
        recurring: { interval: "month" },
        metadata: { planKey: plan.key },
      });
      plan.stripePriceId = price.id;
    }

    await plan.save();
  }
};

export const getPublicPlans = async () => {
  const plans = await SubscriptionPlan.find({ active: true })
    .sort({ priceCents: 1 })
    .select("key name currency priceCents")
    .lean();

  return plans.map((p) => ({
    key: p.key,
    name: p.name,
    currency: p.currency,
    priceCents: p.priceCents,
  }));
};

export const getPlanByKey = async (key: SubscriptionPlanKey) => {
  return SubscriptionPlan.findOne({ key, active: true });
};

export const updatePlanPrice = async (
  stripe: Stripe,
  key: SubscriptionPlanKey,
  nextPriceCents: number,
) => {
  const plan = await SubscriptionPlan.findOne({ key });
  if (!plan) {
    throw new Error("Plan not found");
  }

  if (!plan.stripeProductId) {
    const product = await stripe.products.create({
      name: plan.name,
      metadata: { planKey: plan.key },
    });
    plan.stripeProductId = product.id;
  }

  const price = await stripe.prices.create({
    product: plan.stripeProductId,
    currency: plan.currency || "usd",
    unit_amount: nextPriceCents,
    recurring: { interval: "month" },
    metadata: { planKey: plan.key },
  });

  plan.priceCents = nextPriceCents;
  plan.stripePriceId = price.id;
  await plan.save();

  return plan;
};
