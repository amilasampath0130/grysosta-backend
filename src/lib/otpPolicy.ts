import type { IUser } from "../models/User.js";

const OTP_COOLDOWN_STEPS_MS = [30_000, 60_000, 2 * 60 * 60 * 1000] as const;

export const OTP_EXPIRY_MS = 5 * 60 * 1000;
export const MAX_OTP_VERIFY_ATTEMPTS = 2;

export const getOtpCooldownMs = (sendCount?: number | null): number => {
  const normalizedSendCount = Math.max(1, Number(sendCount) || 1);
  const stepIndex = Math.min(
    normalizedSendCount - 1,
    OTP_COOLDOWN_STEPS_MS.length - 1,
  );

  return OTP_COOLDOWN_STEPS_MS[stepIndex];
};

export const getOtpMsLeft = (
  sentAt?: Date | null,
  sendCount?: number | null,
): number => {
  if (!sentAt) {
    return 0;
  }

  const elapsed = Date.now() - new Date(sentAt).getTime();
  return Math.max(0, getOtpCooldownMs(sendCount) - elapsed);
};

export const formatOtpDelay = (msLeft: number): string => {
  if (msLeft >= 60 * 60 * 1000) {
    return `${Math.ceil(msLeft / (60 * 60 * 1000))} hour(s)`;
  }

  if (msLeft >= 60 * 1000) {
    return `${Math.ceil(msLeft / (60 * 1000))} minute(s)`;
  }

  return `${Math.ceil(msLeft / 1000)} second(s)`;
};

export const remainingOtpAttempts = (
  failedAttempts?: number | null,
): number => {
  return Math.max(0, MAX_OTP_VERIFY_ATTEMPTS - (Number(failedAttempts) || 0));
};

export const assignOtpToUser = (
  user: IUser,
  hashedOtp: string,
): void => {
  user.adminOtp = hashedOtp;
  user.adminOtpExpires = new Date(Date.now() + OTP_EXPIRY_MS);
  user.adminOtpSentAt = new Date();
  user.adminOtpSendCount = (Number(user.adminOtpSendCount) || 0) + 1;
  user.adminOtpFailedAttempts = 0;
};

export const clearOtpFromUser = (user: IUser): void => {
  user.adminOtp = undefined;
  user.adminOtpExpires = undefined;
  user.adminOtpSentAt = undefined;
  user.adminOtpSendCount = undefined;
  user.adminOtpFailedAttempts = undefined;
};