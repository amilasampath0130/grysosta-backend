import express, { Request, Response } from "express";
import Stripe from "stripe";
import Advertisement from "../models/Advertisement.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
const stripeWebhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();

if (!stripeSecretKey) {
  // We don't throw at import-time to keep the server bootable for non-payment routes,
  // but payment endpoints will fail with a clear error.
  console.warn("STRIPE_SECRET_KEY is not set; payment endpoints will not work.");
}

const stripe = new Stripe(stripeSecretKey, {
  // Let the installed Stripe SDK select its default typed API version.
});

const DEFAULT_AD_FEE_CENTS = 500; // $5.00 per payment

const toUtcDateOnly = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addUtcDays = (date: Date, days: number) => {
  const d = toUtcDateOnly(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
};

const parseIsoDateOnly = (value: unknown): Date | undefined => {
  const str = String(value || "").trim();
  if (!str) return undefined;
  // Accept YYYY-MM-DD or ISO strings; normalize to UTC date-only
  const date = new Date(str);
  if (isNaN(date.getTime())) return undefined;
  return toUtcDateOnly(date);
};

const getAdFeeCents = () => {
  const raw = String(process.env.STRIPE_ADVERTISEMENT_FEE_CENTS || "").trim();
  if (!raw) return DEFAULT_AD_FEE_CENTS;

  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_AD_FEE_CENTS;
  }
  return value;
};

router.post(
  "/create-advertisement-checkout-session",
  authenticateToken,
  authorizeRoles("vendor"),
  async (req: Request, res: Response) => {
    try {
      if (!stripeSecretKey) {
        return res
          .status(500)
          .json({ success: false, message: "Stripe is not configured" });
      }

      const feeCents = getAdFeeCents();
      if (!feeCents) {
        return res.status(500).json({
          success: false,
          message: "Advertisement payment fee is not configured",
        });
      }

      const { advertisementId } = (req.body || {}) as { advertisementId?: string };
      const trimmedId = String(advertisementId || "").trim();
      if (!trimmedId) {
        return res
          .status(400)
          .json({ success: false, message: "advertisementId is required" });
      }

      const advertisement = await Advertisement.findById(trimmedId).select(
        "_id vendor title isPaid startDate endDate paidFrom paidThrough stripeCheckoutSessionId",
      );
      if (!advertisement) {
        return res
          .status(404)
          .json({ success: false, message: "Advertisement not found" });
      }

      // Ensure the logged-in vendor owns the advertisement
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = (req as any).user?._id;
      if (!userId || String(advertisement.vendor) !== String(userId)) {
        return res
          .status(403)
          .json({ success: false, message: "Forbidden" });
      }

      if (!advertisement.startDate || !advertisement.endDate) {
        return res.status(400).json({
          success: false,
          message: "Advertisement is missing startDate/endDate",
        });
      }

      // Backfill legacy paid ads to enable extensions.
      if (
        advertisement.isPaid === true &&
        !advertisement.paidThrough &&
        advertisement.startDate &&
        advertisement.endDate
      ) {
        advertisement.paidFrom = advertisement.startDate;
        advertisement.paidThrough = advertisement.endDate;
      }

      const scheduleStart = toUtcDateOnly(advertisement.startDate);
      const scheduleEnd = toUtcDateOnly(advertisement.endDate);

      let coverageStart = scheduleStart;
      let coverageEnd = scheduleEnd;

      if (advertisement.paidThrough) {
        const paidThrough = toUtcDateOnly(advertisement.paidThrough);
        if (scheduleEnd.getTime() <= paidThrough.getTime()) {
          return res.status(400).json({
            success: false,
            message: "This advertisement is already paid for the selected dates",
          });
        }

        coverageStart = addUtcDays(paidThrough, 1);
        coverageEnd = scheduleEnd;
      }

      const successUrl =
        String(process.env.STRIPE_CHECKOUT_SUCCESS_URL || "").trim() ||
        "http://localhost:3002/vendor/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}";
      const cancelUrl =
        String(process.env.STRIPE_CHECKOUT_CANCEL_URL || "").trim() ||
        "http://localhost:3002/vendor/dashboard?payment=cancel";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        client_reference_id: String(advertisement._id),
        metadata: {
          advertisementId: String(advertisement._id),
          vendorId: String(advertisement.vendor),
          coverageStart: coverageStart.toISOString().slice(0, 10),
          coverageEnd: coverageEnd.toISOString().slice(0, 10),
        },
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "Advertisement submission fee",
                description: advertisement.title,
              },
              unit_amount: feeCents,
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      advertisement.stripeCheckoutSessionId = session.id;
      advertisement.pendingPaymentCoverageStart = coverageStart;
      advertisement.pendingPaymentCoverageEnd = coverageEnd;
      await advertisement.save();

      return res.json({
        success: true,
        url: session.url,
        sessionId: session.id,
      });
    } catch (error: any) {
      console.error("Create Stripe checkout session error:", error);
      return res
        .status(500)
        .json({ success: false, message: error?.message || "Payment failed" });
    }
  },
);

router.post(
  "/confirm-checkout-session",
  authenticateToken,
  authorizeRoles("vendor"),
  async (req: Request, res: Response) => {
    try {
      if (!stripeSecretKey) {
        return res
          .status(500)
          .json({ success: false, message: "Stripe is not configured" });
      }

      const { sessionId } = (req.body || {}) as { sessionId?: string };
      const trimmedSessionId = String(sessionId || "").trim();
      if (!trimmedSessionId) {
        return res
          .status(400)
          .json({ success: false, message: "sessionId is required" });
      }

      const session = await stripe.checkout.sessions.retrieve(trimmedSessionId);
      if (!session) {
        return res
          .status(404)
          .json({ success: false, message: "Checkout session not found" });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = String((req as any).user?._id || "").trim();
      const vendorId = String(session.metadata?.vendorId || "").trim();
      const advertisementId = String(session.metadata?.advertisementId || "").trim();

      if (!advertisementId) {
        return res.status(400).json({
          success: false,
          message: "Checkout session is missing advertisement metadata",
        });
      }

      if (!userId || !vendorId || vendorId !== userId) {
        return res
          .status(403)
          .json({ success: false, message: "Forbidden" });
      }

      if (session.payment_status !== "paid") {
        return res.status(409).json({
          success: false,
          message: "Payment not completed yet",
          paymentStatus: session.payment_status,
        });
      }

      const coverageStart = parseIsoDateOnly(session.metadata?.coverageStart);
      const coverageEnd = parseIsoDateOnly(session.metadata?.coverageEnd);

      if (!coverageEnd) {
        return res.status(400).json({
          success: false,
          message: "Checkout session is missing coverage dates",
        });
      }

      const advertisement = await Advertisement.findOne({
        _id: advertisementId,
        vendor: userId,
      });

      if (!advertisement) {
        return res
          .status(404)
          .json({ success: false, message: "Advertisement not found" });
      }

      const nextPaidFrom =
        advertisement.paidFrom || coverageStart || advertisement.startDate;
      const nextPaidThrough = advertisement.paidThrough
        ? new Date(
            Math.max(
              toUtcDateOnly(advertisement.paidThrough).getTime(),
              toUtcDateOnly(coverageEnd).getTime(),
            ),
          )
        : coverageEnd;

      advertisement.paidFrom = nextPaidFrom || undefined;
      advertisement.paidThrough = nextPaidThrough;

      if (advertisement.startDate && advertisement.endDate && advertisement.paidThrough) {
        const fullyPaid =
          toUtcDateOnly(advertisement.endDate).getTime() <=
          toUtcDateOnly(advertisement.paidThrough).getTime();
        advertisement.isPaid = fullyPaid;
      } else {
        advertisement.isPaid = true;
      }

      advertisement.paidAt = new Date();
      advertisement.stripeCheckoutSessionId = session.id;
      advertisement.stripePaymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : undefined;
      advertisement.paymentAmountCents =
        typeof session.amount_total === "number" ? session.amount_total : undefined;
      advertisement.paymentCurrency =
        typeof session.currency === "string" ? session.currency : undefined;
      advertisement.pendingPaymentCoverageStart = undefined;
      advertisement.pendingPaymentCoverageEnd = undefined;

      await advertisement.save();

      return res.json({
        success: true,
        advertisement: {
          _id: advertisement._id,
          isPaid: advertisement.isPaid,
          paidAt: advertisement.paidAt,
          paidFrom: advertisement.paidFrom,
          paidThrough: advertisement.paidThrough,
          status: advertisement.status,
        },
      });
    } catch (error: any) {
      console.error("Confirm checkout session error:", error);
      return res
        .status(500)
        .json({ success: false, message: error?.message || "Failed to confirm payment" });
    }
  },
);

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      if (!stripeSecretKey) {
        return res
          .status(500)
          .json({ success: false, message: "Stripe is not configured" });
      }
      if (!stripeWebhookSecret) {
        return res.status(500).json({
          success: false,
          message: "STRIPE_WEBHOOK_SECRET is not configured",
        });
      }

      const signature = req.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        return res.status(400).send("Missing Stripe signature");
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          // `express.raw()` gives us a Buffer
          req.body,
          signature,
          stripeWebhookSecret,
        );
      } catch (err: any) {
        console.error("Stripe webhook signature verification failed:", err);
        return res.status(400).send(`Webhook Error: ${err?.message || "Invalid"}`);
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const advertisementId = String(session.metadata?.advertisementId || "").trim();

        const coverageStart = parseIsoDateOnly(session.metadata?.coverageStart);
        const coverageEnd = parseIsoDateOnly(session.metadata?.coverageEnd);

        if (advertisementId && session.payment_status === "paid" && coverageEnd) {
          const advertisement = await Advertisement.findById(advertisementId);
          if (advertisement) {
            const nextPaidFrom =
              advertisement.paidFrom || coverageStart || advertisement.startDate;
            const nextPaidThrough = advertisement.paidThrough
              ? new Date(
                  Math.max(
                    toUtcDateOnly(advertisement.paidThrough).getTime(),
                    toUtcDateOnly(coverageEnd).getTime(),
                  ),
                )
              : coverageEnd;

            advertisement.paidFrom = nextPaidFrom || undefined;
            advertisement.paidThrough = nextPaidThrough;

            if (advertisement.startDate && advertisement.endDate && advertisement.paidThrough) {
              advertisement.isPaid =
                toUtcDateOnly(advertisement.endDate).getTime() <=
                toUtcDateOnly(advertisement.paidThrough).getTime();
            } else {
              advertisement.isPaid = true;
            }

            advertisement.paidAt = new Date();
            advertisement.stripeCheckoutSessionId = session.id;
            advertisement.stripePaymentIntentId =
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : undefined;
            advertisement.paymentAmountCents =
              typeof session.amount_total === "number" ? session.amount_total : undefined;
            advertisement.paymentCurrency =
              typeof session.currency === "string" ? session.currency : undefined;
            advertisement.pendingPaymentCoverageStart = undefined;
            advertisement.pendingPaymentCoverageEnd = undefined;

            await advertisement.save();
          }
        }
      }

      return res.json({ received: true });
    } catch (error) {
      console.error("Stripe webhook handler error:", error);
      return res.status(500).send("Webhook handler failed");
    }
  },
);

export default router;