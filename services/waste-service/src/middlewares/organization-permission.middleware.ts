import { NextFunction, Response } from "express";
import { dbPool } from "../config/database";
import { AuthenticatedRequest } from "./auth.middleware";

async function hasAnyPermission(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  permissionCodes: string[]
) {
  const identity = req.auth;
  if (!identity?.userId || !identity.organizationId) {
    return res.status(403).json({
      success: false,
      message: "An active organization membership is required",
    });
  }

  try {
    const result = await dbPool.query(
      `SELECT code
       FROM organization_effective_permissions($1::uuid, $2::uuid)
       WHERE code = ANY($3::text[])
       LIMIT 1`,
      [identity.userId, identity.organizationId, permissionCodes]
    );
    if (!result.rowCount) {
      return res.status(403).json({
        success: false,
        message: "Your organization role does not permit this action",
        requiredPermissions: permissionCodes,
      });
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireOrganizationPermission(code: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) =>
    hasAnyPermission(req, res, next, [code]);
}

export function requireAnyOrganizationPermission(...codes: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) =>
    hasAnyPermission(req, res, next, codes);
}

/** Allow a public-facing account role or an explicitly granted tenant permission. */
export function requireRoleOrOrganizationPermission(allowedRoles: string[], ...codes: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.auth?.roles.some(role => allowedRoles.includes(role))) return next();
    return hasAnyPermission(req, res, next, codes);
  };
}
