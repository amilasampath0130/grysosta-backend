import Advertisement from "../models/Advertisement.js";
import Offer from "../models/Offer.js";
import { deleteCloudinaryImage } from "./cloudinary.js";

let cleanupInterval: NodeJS.Timeout | null = null;
let isRunningCleanup = false;

const toStartOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const deleteCloudinaryAssets = async (publicIds: string[]) => {
  const targets = publicIds.map((publicId) => publicId.trim()).filter(Boolean);
  await Promise.allSettled(targets.map((publicId) => deleteCloudinaryImage(publicId)));
};

export const runExpiredContentCleanup = async () => {
  if (isRunningCleanup) {
    return;
  }

  isRunningCleanup = true;

  try {
    const today = toStartOfDay();
    const now = new Date();

    const [expiredOffers, expiredAdvertisements] = await Promise.all([
      Offer.find({ validUntil: { $lt: today } }).select("_id imagePublicId title"),
      Advertisement.find({ endDate: { $lt: now } }).select("_id imagePublicId title"),
    ]);

    if (expiredOffers.length > 0) {
      await Offer.deleteMany({ _id: { $in: expiredOffers.map((offer) => offer._id) } });
      await deleteCloudinaryAssets(
        expiredOffers.map((offer) => String(offer.imagePublicId || "")),
      );
    }

    if (expiredAdvertisements.length > 0) {
      await Advertisement.deleteMany({
        _id: { $in: expiredAdvertisements.map((advertisement) => advertisement._id) },
      });
      await deleteCloudinaryAssets(
        expiredAdvertisements.map((advertisement) =>
          String(advertisement.imagePublicId || ""),
        ),
      );
    }
  } catch (error) {
    console.error("Expired content cleanup failed:", error);
  } finally {
    isRunningCleanup = false;
  }
};

export const startExpiredContentCleanupJob = (intervalMs = 15 * 60 * 1000) => {
  if (cleanupInterval) {
    return;
  }

  void runExpiredContentCleanup();
  cleanupInterval = setInterval(() => {
    void runExpiredContentCleanup();
  }, intervalMs);
};