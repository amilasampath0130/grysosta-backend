export const STRONG_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!]).{8,}$/;

export const STRONG_PASSWORD_ERROR =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and one special character (@#$%^&*!).";

export const isStrongPassword = (value: string): boolean => {
  return STRONG_PASSWORD_REGEX.test(String(value || ""));
};
