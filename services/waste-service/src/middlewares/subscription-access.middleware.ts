import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "./auth.middleware";
import { statusOf } from "../repositories/subscription.repository";
import { FULL_ACCESS } from "../services/subscription.rules";

// What a suspended or cancelled company can still change: its subscription and payments, and everything KCCA requires of
// it (the regulatory portal is free and never blocked).
const ALWAYS_ALLOWED = ["/subscription", "/regulatory", "/compliance", "/penalties", "/disposal", "/dumping", "/notifications", "/returns", "/permit"];

/** Makes the platform read-only for company staff whose subscription is suspended or cancelled. */
export async function subscriptionAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.auth?.organizationId) return next();
    if (!req.auth.roles.some(role => ["company_admin", "supervisor", "driver", "recycling_collector", "recycling_sales", "recycling_field_manager"].includes(role))) return next();
    if (ALWAYS_ALLOWED.some(prefix => req.path.startsWith(prefix))) return next();
    const status = await statusOf(req.auth.organizationId);
    if (status === null || FULL_ACCESS.includes(status)) return next();
    return res.status(402).json({ success: false, code: "subscription_inactive",
      message: status === "suspended" ? "Your subscription is suspended. Records stay available to read; pay the overdue invoice to make changes again." : "Your subscription has ended. Resume it to make changes again." });
  } catch (error) {
    next(error);
  }
}
