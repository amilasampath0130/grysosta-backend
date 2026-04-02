import express, { Request, Response } from "express";
import type Stripe from "stripe";
import Advertisement from "../models/Advertisement.js";
import Offer from "../models/Offer.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authMiddleware.js";
import User from "../models/User.js";
import {
  requireStripe,
  stripe,
  stripeSecretKey,
  stripeWebhookSecret,
} from "../lib/stripeClient.js";
import { deleteCloudinaryImage } from "../lib/cloudinary.js";
import {
  ensureSubscriptionPlans,
  getPlanByKey,
  getPublicPlans,
} from "../lib/subscriptionPlans.js";
import {
  normalizeVendorPlanKey,
} from "../lib/vendorBilling.js";

const router = express.Router();

if (!stripeSecretKey) {
  // We don't throw at import-time to keep the server bootable for non-payment routes,
  // but payment endpoints will fail with a clear error.
  console.warn("STRIPE_SECRET_KEY is not set; payment endpoints will not work.");
}

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

const isActiveSubscriptionStatus = (status?: string) =>
  status === "active" || status === "trialing";

const parsePlanKey = (value: unknown) => normalizeVendorPlanKey(value);

const getVendorDashboardBaseUrl = (req: Request) => {
  const configured = [
    process.env.VENDOR_DASHBOARD_URL,
    process.env.FRONTEND_URL,
    process.env.APP_BASE_URL,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const origin = String(req.headers.origin || "").trim();
  if (origin) {
    return origin.replace(/\/$/, "");
  }

  const referer = String(req.headers.referer || "").trim();
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      return refererUrl.origin;
    } catch {
      // ignore invalid referer
    }
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();

  if (!forwardedHost) {
    return "http://localhost:3102";
  }

  return `${forwardedProto || "http"}://${forwardedHost}`.replace(/\/$/, "");
};

const buildVendorDashboardUrl = (
  req: Request,
  pathname: string,
  params: Record<string, string | undefined> = {},
) => {
  const url = new URL(pathname, `${getVendorDashboardBaseUrl(req)}/`);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url
    .toString()
    .replace(/%7BCHECKOUT_SESSION_ID%7D/g, "{CHECKOUT_SESSION_ID}");
};

const shouldPurgeOffersForSubscriptionStatus = (status?: string) =>
  status === "canceled" || status === "unpaid" || status === "incomplete_expired";

const purgeVendorOffers = async (vendorId: string) => {
  if (!vendorId) return { deletedCount: 0 };

  const offers = await Offer.find({ vendor: vendorId }).select(
    "_id imagePublicId",
  );

  if (!offers.length) return { deletedCount: 0 };

  for (const offer of offers) {
    try {
      if (offer.imagePublicId) {
        await deleteCloudinaryImage(offer.imagePublicId);
      }
    } catch (cloudinaryError) {
      console.error("Failed to delete offer image:", cloudinaryError);
    }
  }

  const result = await Offer.deleteMany({ vendor: vendorId });
  return { deletedCount: result.deletedCount || 0 };
};

const getSubscriptionCurrentPeriodEnd = (subscription: Stripe.Subscription) => {
  const ends = (subscription.items?.data || [])
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number");

  if (ends.length === 0) return undefined;
  const minEnd = Math.min(...ends);
  return Number.isFinite(minEnd) ? new Date(minEnd * 1000) : undefined;
};

const cancelPreviousSubscriptionIfNeeded = async (
  session: Stripe.Checkout.Session,
  activeSubscriptionId?: string,
) => {
  const previousSubscriptionId = String(
    session.metadata?.previousSubscriptionId || "",
  ).trim();

  if (
    !previousSubscriptionId ||
    !activeSubscriptionId ||
    previousSubscriptionId === activeSubscriptionId
  ) {
    return;
  }

  const stripeClient = requireStripe();
  let previousSubscription: Stripe.Subscription;
  try {
    previousSubscription = await stripeClient.subscriptions.retrieve(
      previousSubscriptionId,
    );
  } catch (error: any) {
    if (
      error?.type === "StripeInvalidRequestError" &&
      error?.code === "resource_missing"
    ) {
      return;
    }
    throw error;
  }

  if (
    previousSubscription.status === "canceled" ||
    previousSubscription.status === "incomplete_expired"
  ) {
    return;
  }

  try {
    await stripeClient.subscriptions.cancel(previousSubscriptionId);
  } catch (error: any) {
    if (
      error?.type === "StripeInvalidRequestError" &&
      error?.code === "resource_missing"
    ) {
      return;
    }
    throw error;
  }
};

const createSubscriptionCheckoutSession = async ({
  req,
  user,
  planKey,
  stripePriceId,
  nextPath,
  previousSubscriptionId,
}: {
  req: Request;
  user: any;
  planKey: string;
  stripePriceId: string;
  nextPath?: string;
  previousSubscriptionId?: string;
}) => {
  const stripeClient = requireStripe();

  const successUrl =
    String(process.env.STRIPE_SUBSCRIPTION_SUCCESS_URL || "").trim() ||
    buildVendorDashboardUrl(req, "/vendor/billing", {
      success: "1",
      session_id: "{CHECKOUT_SESSION_ID}",
      next: nextPath || undefined,
    });
  const cancelUrl =
    String(process.env.STRIPE_SUBSCRIPTION_CANCEL_URL || "").trim() ||
    buildVendorDashboardUrl(req, "/vendor/billing", {
      canceled: "1",
      next: nextPath || undefined,
    });

  return stripeClient.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer: user.vendorSubscription?.stripeCustomerId,
    customer_email: user.vendorSubscription?.stripeCustomerId ? undefined : user.email,
    line_items: [{ price: stripePriceId, quantity: 1 }],
    metadata: {
      vendorId: String(user._id),
      planKey,
      stripePriceId,
      nextPath: nextPath || "",
      previousSubscriptionId: previousSubscriptionId || "",
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
};

const syncVendorSubscription = async (stripeSub: Stripe.Subscription) => {
  const subscriptionId = String(stripeSub.id || "").trim();
  if (!subscriptionId) return;

  const user = await User.findOne({
    "vendorSubscription.stripeSubscriptionId": subscriptionId,
  });

  if (!user) return;

  const firstItem = stripeSub.items?.data?.[0];
  const price = firstItem?.price;
  const planKeyFromStripe = parsePlanKey((price as any)?.metadata?.planKey);

  user.vendorSubscription = {
    ...(user.vendorSubscription || {}),
    ...(planKeyFromStripe ? { planKey: planKeyFromStripe } : {}),
    ...(price?.id ? { stripePriceId: price.id } : {}),
    status: stripeSub.status,
    currentPeriodEnd: getSubscriptionCurrentPeriodEnd(stripeSub),
    cancelAtPeriodEnd: Boolean(stripeSub.cancel_at_period_end),
  };

  await user.save();

  if (shouldPurgeOffersForSubscriptionStatus(user.vendorSubscription?.status)) {
    await purgeVendorOffers(String(user._id));
  }
};

const upsertVendorSubscriptionFromCheckoutSession = async (
  session: Stripe.Checkout.Session,
) => {
  const vendorId = String(session.metadata?.vendorId || "").trim();
  const planKey = parsePlanKey(session.metadata?.planKey);

  if (!vendorId || !planKey) return;

  const user = await User.findById(vendorId);
  if (!user) return;

  const customerId =
    typeof session.customer === "string" ? session.customer : undefined;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : undefined;

  if (!subscriptionId) {
    user.vendorSubscription = {
      ...(user.vendorSubscription || {}),
      planKey,
      stripeCustomerId: customerId || user.vendorSubscription?.stripeCustomerId,
    };
    await user.save();
    return;
  }

  const stripeClient = requireStripe();
  const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);

  const priceId =
    subscription.items?.data?.[0]?.price?.id ||
    (typeof session.metadata?.stripePriceId === "string"
      ? session.metadata.stripePriceId
      : undefined);

  user.vendorSubscription = {
    ...(user.vendorSubscription || {}),
    planKey,
    status: subscription.status,
    currentPeriodEnd: getSubscriptionCurrentPeriodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    stripeCustomerId: customerId || user.vendorSubscription?.stripeCustomerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: priceId || user.vendorSubscription?.stripePriceId,
  };

  await user.save();

  await cancelPreviousSubscriptionIfNeeded(session, subscriptionId);
};

router.get("/subscription-plans", async (_req: Request, res: Response) => {
  try {
    await ensureSubscriptionPlans(stripe);
    const plans = await getPublicPlans();
    return res.json({
      success: true,
      plans,
      checkoutAvailable: Boolean(stripeSecretKey),
    });
  } catch (error: any) {
    console.error("List subscription plans error:", error);
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Failed to load plans" });
  }
});

router.post(
  "/create-subscription-checkout-session",
  authenticateToken,
  authorizeRoles("vendor"),
  async (req: Request, res: Response) => {
    try {
      const stripeClient = requireStripe();
      await ensureSubscriptionPlans(stripeClient);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = (req as any).user as any;

      if (!user || user.vendorStatus !== "APPROVED") {
        return res.status(403).json({
          success: false,
          message: "Only approved vendors can subscribe to a plan",
        });
      }

      const planKey = parsePlanKey((req.body as any)?.planKey);
      const nextPath = String((req.body as any)?.nextPath || "").trim();

      if (!planKey) {
        return res
          .status(400)
          .json({ success: false, message: "planKey is required" });
      }

      const plan = await getPlanByKey(planKey);
      if (!plan || !plan.stripePriceId) {
        return res
          .status(500)
          .json({ success: false, message: "Plan is not configured" });
      }

      const session = await createSubscriptionCheckoutSession({
        req,
        user,
        planKey,
        stripePriceId: plan.stripePriceId,
        nextPath,
      });

      return res.json({ success: true, url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Create subscription checkout session error:", error);
      return res
        .status(500)
        .json({ success: false, message: error?.message || "Failed to start checkout" });
    }
  },
);

router.post(
  "/confirm-subscription-checkout-session",
  authenticateToken,
  authorizeRoles("vendor"),
  async (req: Request, res: Response) => {
    try {
      const stripeClient = requireStripe();

      const { sessionId } = (req.body || {}) as { sessionId?: string };
      const trimmedSessionId = String(sessionId || "").trim();
      if (!trimmedSessionId) {
        return res
          .status(400)
          .json({ success: false, message: "sessionId is required" });
      }

      if (trimmedSessionId === "{CHECKOUT_SESSION_ID}") {
        return res.status(400).json({
          success: false,
          message: "Stripe did not substitute the checkout session id in the success URL",
        });
      }

      const session = await stripeClient.checkout.sessions.retrieve(trimmedSessionId);
      if (!session) {
        return res
          .status(404)
          .json({ success: false, message: "Checkout session not found" });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = String((req as any).user?._id || "").trim();
      const vendorId = String(session.metadata?.vendorId || "").trim();

      if (!userId || !vendorId || userId !== vendorId) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }

      if (session.status !== "complete") {
        return res.status(409).json({
          success: false,
          message: "Checkout not completed yet",
          status: session.status,
        });
      }

      await upsertVendorSubscriptionFromCheckoutSession(session);

      const user = await User.findById(userId).select("vendorSubscription");

      return res.json({
        success: true,
        vendorSubscription: user?.vendorSubscription || null,
        isActive: isActiveSubscriptionStatus(user?.vendorSubscription?.status),
      });
    } catch (error: any) {
      console.error("Confirm subscription checkout session error:", error);
      return res
        .status(500)
        .json({ success: false, message: error?.message || "Failed to confirm subscription" });
    }
  },
);

router.post(
  "/change-subscription-plan",
  authenticateToken,
  authorizeRoles("vendor"),
  async (req: Request, res: Response) => {
    try {
      const stripeClient = requireStripe();
      await ensureSubscriptionPlans(stripeClient);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = (req as any).user as any;
      if (!user || user.vendorStatus !== "APPROVED") {
        return res.status(403).json({
          success: false,
          message: "Only approved vendors can manage subscriptions",
        });
      }

      const subscriptionId = String(user.vendorSubscription?.stripeSubscriptionId || "").trim();
      const planKey = parsePlanKey((req.body as any)?.planKey);
      const nextPath = String((req.body as any)?.nextPath || "").trim();

      if (!planKey) {
        return res
          .status(400)
          .json({ success: false, message: "planKey is required" });
      }

      const plan = await getPlanByKey(planKey);
      if (!plan?.stripePriceId) {
        return res
          .status(500)
          .json({ success: false, message: "Plan is not configured" });
      }

      if (!subscriptionId) {
        return res.status(409).json({
          success: false,
          code: "SUBSCRIPTION_CHECKOUT_REQUIRED",
          message: "This vendor does not have a Stripe subscription yet. Start checkout to switch plans.",
        });
      }

      const session = await createSubscriptionCheckoutSession({
        req,
        user,
        planKey,
        stripePriceId: plan.stripePriceId,
        nextPath,
        previousSubscriptionId: subscriptionId,
      });

      return res.json({
        success: true,
        action: "checkout",
        url: session.url,
        sessionId: session.id,
      });
    } catch (error: any) {
      console.error("Change subscription plan error:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to change subscription plan",
      });
    }
  },
);

router.post(
  "/cancel-subscription",
  authenticateToken,
  authorizeRoles("vendor"),
  async (req: Request, res: Response) => {
    try {
      const stripeClient = requireStripe();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = (req as any).user as any;
      if (!user || user.vendorStatus !== "APPROVED") {
        return res.status(403).json({
          success: false,
          message: "Only approved vendors can manage subscriptions",
        });
      }

      const subscriptionId = String(user.vendorSubscription?.stripeSubscriptionId || "").trim();
      if (!subscriptionId) {
        return res.status(400).json({
          success: false,
          message: "No Stripe subscription found for this vendor",
        });
      }

      let canceled: Stripe.Subscription;
      try {
        canceled = await stripeClient.subscriptions.cancel(subscriptionId);
      } catch (error: any) {
        if (
          error?.type === "StripeInvalidRequestError" &&
          error?.code === "resource_missing"
        ) {
          const dbUser = await User.findById(user._id).select("vendorSubscription");
          if (!dbUser) {
            return res
              .status(404)
              .json({ success: false, message: "Vendor not found" });
          }

          dbUser.vendorSubscription = {
            ...(dbUser.vendorSubscription || {}),
            status: "canceled",
            currentPeriodEnd: undefined,
            cancelAtPeriodEnd: false,
            stripeSubscriptionId: undefined,
          };

          await dbUser.save();

          const purge = await purgeVendorOffers(String(dbUser._id));

          return res.json({
            success: true,
            message: "Subscription was already removed in Stripe. Vendor offers were removed.",
            vendorSubscription: dbUser.vendorSubscription,
            deletedOffersCount: purge.deletedCount,
          });
        }

        throw error;
      }

      const dbUser = await User.findById(user._id).select("vendorSubscription");
      if (!dbUser) {
        return res
          .status(404)
          .json({ success: false, message: "Vendor not found" });
      }

      dbUser.vendorSubscription = {
        ...(dbUser.vendorSubscription || {}),
        status: canceled.status,
        currentPeriodEnd: getSubscriptionCurrentPeriodEnd(canceled),
        cancelAtPeriodEnd: Boolean(canceled.cancel_at_period_end),
      };

      await dbUser.save();

      const purge = await purgeVendorOffers(String(dbUser._id));

      return res.json({
        success: true,
        message: "Subscription canceled. Vendor offers were removed.",
        vendorSubscription: dbUser.vendorSubscription,
        deletedOffersCount: purge.deletedCount,
      });
    } catch (error: any) {
      console.error("Cancel subscription error:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to cancel subscription",
      });
    }
  },
);

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

      const stripeClient = requireStripe();

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
        buildVendorDashboardUrl(req, "/vendor/dashboard", {
          payment: "success",
          session_id: "{CHECKOUT_SESSION_ID}",
        });
      const cancelUrl =
        String(process.env.STRIPE_CHECKOUT_CANCEL_URL || "").trim() ||
        buildVendorDashboardUrl(req, "/vendor/dashboard", {
          payment: "cancel",
        });

      const session = await stripeClient.checkout.sessions.create({
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

      const stripeClient = requireStripe();

      const { sessionId } = (req.body || {}) as { sessionId?: string };
      const trimmedSessionId = String(sessionId || "").trim();
      if (!trimmedSessionId) {
        return res
          .status(400)
          .json({ success: false, message: "sessionId is required" });
      }

      if (trimmedSessionId === "{CHECKOUT_SESSION_ID}") {
        return res.status(400).json({
          success: false,
          message: "Stripe did not substitute the checkout session id in the success URL",
        });
      }

      const session = await stripeClient.checkout.sessions.retrieve(trimmedSessionId);
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
        const stripeClient = requireStripe();
        event = stripeClient.webhooks.constructEvent(
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

        if (session.mode === "subscription") {
          await upsertVendorSubscriptionFromCheckoutSession(session);
          return res.json({ received: true });
        }

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

      if (
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.deleted"
      ) {
        const subscription = event.data.object as Stripe.Subscription;
        await syncVendorSubscription(subscription);
      }

      return res.json({ received: true });
    } catch (error) {
      console.error("Stripe webhook handler error:", error);
      return res.status(500).send("Webhook handler failed");
    }
  },
);

export default router;