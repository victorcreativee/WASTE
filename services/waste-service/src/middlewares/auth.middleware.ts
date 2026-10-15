import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { dbPool } from "../config/database";
import { env } from "../config/env";

export type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
    organizationId: string | null;
    roles: string[];
  };
};

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Authentication token is required" });
  }
  if (!env.jwtAccessSecret) {
    return res.status(503).json({ success: false, message: "Authentication is not configured" });
  }

  try {
    const claims = jwt.verify(authorization.slice(7), env.jwtAccessSecret) as jwt.JwtPayload & { userId?: string };
    if (!claims.userId) throw new Error("Missing user identity");

    const result = await dbPool.query(
      `SELECT u.status, u.organization_id, o.is_active AS organization_active,
              EXISTS(SELECT 1 FROM organization_memberships m WHERE m.user_id=u.id AND m.organization_id=u.organization_id AND m.status='active') AS membership_active,
              ARRAY_REMOVE(ARRAY_AGG(r.name), NULL) AS roles
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1::uuid
       GROUP BY u.id, o.is_active`,
      [claims.userId]
    );
    const user = result.rows[0];
    if (!user || user.status !== "active") {
      return res.status(401).json({ success: false, message: "User account is unavailable" });
    }
    if (user.roles?.some((role: string) => ["company_admin", "supervisor", "driver", "iot_operator", "recycling_collector", "recycling_sales", "recycling_field_manager"].includes(role)) &&
        (!user.organization_id || user.organization_active !== true || user.membership_active !== true)) {
      return res.status(403).json({ success: false, message: "Your organization or membership is unavailable. Contact your administrator." });
    }
    req.auth = {
      userId: claims.userId,
      organizationId: user.organization_id,
      roles: user.roles ?? [],
    };
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired authentication token" });
  }
}

export function requireRoles(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!req.auth.roles.some((role) => allowedRoles.includes(role))) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this operational resource",
      });
    }
    if (req.auth.roles.some((role) => ["company_admin", "supervisor", "driver", "iot_operator", "recycling_collector", "recycling_sales", "recycling_field_manager"].includes(role)) && !req.auth.organizationId) {
      return res.status(403).json({
        success: false,
        message: "Your account must be linked to an organization",
      });
    }
    next();
  };
}
