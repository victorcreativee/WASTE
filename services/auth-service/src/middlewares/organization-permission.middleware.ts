import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.middleware";
import { dbPool } from "../config/database";

/** Run after fresh identity/role checks. Global permissions never bypass tenant grants. */
export function requireOrganizationPermission(code: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user?.userId || !user.organizationId) return res.status(403).json({success:false,message:"An active organization membership is required"});
    const result = await dbPool.query(
      "SELECT 1 FROM organization_effective_permissions($1::uuid,$2::uuid) WHERE code=$3",
      [user.userId,user.organizationId,code]);
    if (!result.rowCount) return res.status(403).json({success:false,message:"Your organization role does not permit this action",requiredPermission:code});
    next();
  };
}
