import { NextFunction, Request, Response } from "express";
import { dbPool } from "../config/database";
import { AuthenticatedRequest } from "./auth.middleware";

/** Staff management is currently a recycling-company capability only. */
export async function requireRecyclingCompany(req: Request, res: Response, next: NextFunction) {
  const organizationId = (req as AuthenticatedRequest).user?.organizationId;
  if (!organizationId) {
    return res.status(403).json({ success: false, message: "Your account is not linked to an organization" });
  }
  const result = await dbPool.query(
    "SELECT 1 FROM organizations WHERE id=$1::uuid AND type='recycling_company'",
    [organizationId],
  );
  if (!result.rowCount) {
    return res.status(403).json({ success: false, message: "Staff management is available only to recycling companies" });
  }
  return next();
}
