import Stripe from "stripe";

export const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
export const stripeWebhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      // Let the installed Stripe SDK select its default typed API version.
    })
  : null;

export const requireStripe = (): Stripe => {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }
  return stripe;
};
