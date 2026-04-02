import Advertisement from "../models/Advertisement.js";
import Offer from "../models/Offer.js";

export type VendorPlanKey = "bronze" | "silver" | "gold" | "diamond";

export type VendorPlanLimits = {
  activeOfferLimit: number | null;
  advertisementLimit: number | null;
};

export type VendorPlanDefinition = {
  key: VendorPlanKey;
  name: string;
  currency: string;
  priceCents: number;
  order: number;
  summary: string;
  features: string[];
  limits: VendorPlanLimits;
  legacyPriceCents?: number[];
};

type VendorLike = {
  vendorApplication?: {
    business?: {
      planKey?: unknown;
    };
  };
  vendorSubscription?: {
    planKey?: unknown;
    status?: string;
  };
};

export type VendorPlanUsage = {
  activeOfferCount: number;
  pendingOfferCount: number;
  occupiedOfferCount: number;
  activeAdvertisementCount: number;
  pendingAdvertisementCount: number;
  occupiedAdvertisementCount: number;
};

export const VENDOR_PLAN_KEYS: VendorPlanKey[] = [
  "bronze",
  "silver",
  "gold",
  "diamond",
];

const PLAN_DEFINITIONS: Record<VendorPlanKey, VendorPlanDefinition> = {
  bronze: {
    key: "bronze",
    name: "Bronze",
    currency: "usd",
    priceCents: 1999,
    order: 1,
    summary: "Starter plan for smaller vendors.",
    features: [
      "3 active offers",
      "1 advertisement slot",
      "Vendor listing",
      "Basic analytics",
      "Business profile",
    ],
    limits: {
      activeOfferLimit: 3,
      advertisementLimit: 1,
    },
    legacyPriceCents: [1900],
  },
  silver: {
    key: "silver",
    name: "Silver",
    currency: "usd",
    priceCents: 4999,
    order: 2,
    summary: "Growth plan with more visibility and capacity.",
    features: [
      "8 active offers",
      "3 advertisement slots",
      "Priority search placement",
      "Photo gallery",
      "Promotion tools",
    ],
    limits: {
      activeOfferLimit: 8,
      advertisementLimit: 3,
    },
    legacyPriceCents: [4900],
  },
  gold: {
    key: "gold",
    name: "Gold",
    currency: "usd",
    priceCents: 9999,
    order: 3,
    summary: "Advanced plan for higher-volume promotions.",
    features: [
      "15 active offers",
      "6 advertisement slots",
      "Premium placement",
      "Rewards plus analytics",
      "Push promotions",
    ],
    limits: {
      activeOfferLimit: 15,
      advertisementLimit: 6,
    },
    legacyPriceCents: [9900],
  },
  diamond: {
    key: "diamond",
    name: "Diamond",
    currency: "usd",
    priceCents: 24999,
    order: 4,
    summary: "Top-tier plan with no promotional ceiling.",
    features: [
      "Unlimited offers",
      "Unlimited advertisement slots",
      "Top search ranking",
      "Advanced analytics",
      "VIP support and more",
    ],
    limits: {
      activeOfferLimit: null,
      advertisementLimit: null,
    },
  },
};

const isActiveSubscriptionStatus = (status?: string | null) =>
  status === "active" || status === "trialing";

export const isVendorPlanKey = (value: unknown): value is VendorPlanKey =>
  typeof value === "string" && VENDOR_PLAN_KEYS.includes(value as VendorPlanKey);

export const normalizeVendorPlanKey = (value: unknown): VendorPlanKey | undefined => {
  const normalized = String(value || "").trim().toLowerCase();
  return isVendorPlanKey(normalized) ? normalized : undefined;
};

export const getVendorPlanDefinition = (key: VendorPlanKey) => PLAN_DEFINITIONS[key];

export const getAllVendorPlanDefinitions = () =>
  VENDOR_PLAN_KEYS.map((key) => PLAN_DEFINITIONS[key]).sort((a, b) => a.order - b.order);

export const getVendorActivePlanKey = (vendor?: VendorLike | null) => {
  if (!vendor || !isActiveSubscriptionStatus(vendor.vendorSubscription?.status)) {
    return undefined;
  }

  return normalizeVendorPlanKey(vendor.vendorSubscription?.planKey);
};

export const getVendorRecommendedPlanKey = (vendor?: VendorLike | null) => {
  return (
    getVendorActivePlanKey(vendor) ||
    normalizeVendorPlanKey(vendor?.vendorApplication?.business?.planKey)
  );
};

export const countVendorPlanUsage = async (vendorId: string): Promise<VendorPlanUsage> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    activeOfferCount,
    pendingOfferCount,
    activeAdvertisementCount,
    pendingAdvertisementCount,
  ] = await Promise.all([
    Offer.countDocuments({
      vendor: vendorId,
      status: "APPROVED",
      validUntil: { $gte: today },
    }),
    Offer.countDocuments({
      vendor: vendorId,
      status: "PENDING",
    }),
    Advertisement.countDocuments({
      vendor: vendorId,
      status: "APPROVED",
      endDate: { $gte: today },
    }),
    Advertisement.countDocuments({
      vendor: vendorId,
      status: "PENDING",
    }),
  ]);

  return {
    activeOfferCount,
    pendingOfferCount,
    occupiedOfferCount: activeOfferCount + pendingOfferCount,
    activeAdvertisementCount,
    pendingAdvertisementCount,
    occupiedAdvertisementCount: activeAdvertisementCount + pendingAdvertisementCount,
  };
};

export const buildVendorPlanSnapshot = async (
  vendorId: string,
  vendor?: VendorLike | null,
) => {
  const activePlanKey = getVendorActivePlanKey(vendor);
  const recommendedPlanKey = getVendorRecommendedPlanKey(vendor);
  const activePlan = activePlanKey ? getVendorPlanDefinition(activePlanKey) : null;
  const recommendedPlan = recommendedPlanKey
    ? getVendorPlanDefinition(recommendedPlanKey)
    : null;
  const usage = await countVendorPlanUsage(vendorId);

  return {
    activePlan,
    recommendedPlan,
    usage,
  };
};