import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { requireActiveOrganization } from "../services/organization-access.service";
import { env } from "../config/env";
import { getUserPermissions } from "../repositories/role.repository";
import { getUserRoles } from "../repositories/role.repository";
import { findUserById } from "../repositories/auth.repository";
import { sessionIsActive } from "../repositories/session.repository";

export type AuthenticatedRequest = Request & {
  user?: {
    userId: string;
    email?: string;
    organizationId?: string | null;
    sid?: string;
  };
};

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication token is required",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, env.jwtAccessSecret) as {
      userId: string;
      email?: string;
      organizationId?: string | null;
      sid?: string;
    };
    if (!(await sessionIsActive(decoded.sid, decoded.userId))) {
      return res.status(401).json({ success: false, message: "This session has ended. Sign in again." });
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token",
    });
  }
}

export function requireRoles(...allowedRoles: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const [user, roles] = await Promise.all([findUserById(userId), getUserRoles(userId)]);
    if (!user || user.status !== "active") {
      return res.status(401).json({ success: false, message: "User account is unavailable" });
    }
    if (!roles.some((role) => allowedRoles.includes(role.name))) {
      return res.status(403).json({ success: false, message: "You do not have access to manage organization staff" });
    }
    await requireActiveOrganization(user.organization_id, roles, userId);
    req.user = {
      userId,
      email: req.user?.email,
      sid: req.user?.sid,
      organizationId: user.organization_id,
    };
    next();
  };
}
export function requirePermission(permissionCode: string) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const permissions = await getUserPermissions(userId);
    const hasPermission = permissions.some(
      (permission) => permission.code === permissionCode
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
        requiredPermission: permissionCode,
      });
    }

    next();
  };
}
