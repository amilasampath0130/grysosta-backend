import { Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { AuthRequest } from "../controllers/authController.js";
import User from "../models/User.js";

/**
 * Attempts to authenticate a request, but never fails the request.
 *
 * - If a token is present and valid -> sets req.user
 * - If missing/invalid -> req.user remains undefined
 */
export const optionalAuthenticateToken = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
) => {
  try {
    let token = req.cookies?.["auth-token"];

    if (!token) {
      token = req.header("Authorization")?.replace("Bearer ", "");
    }

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string,
    ) as JwtPayload;

    const user = await User.findById(decoded.userId);
    if (user) {
      req.user = user;
    }

    return next();
  } catch {
    return next();
  }
};
