import rateLimit from "express-rate-limit";

// General API rate limiting
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: "Too many requests, please try again later."
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limiting for game actions
export const gameActionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Maximum 10 game actions per minute
  message: {
    success: false,
    message: "Too many game actions, please slow down."
  },
  standardHeaders: true,
  legacyHeaders: false,
});