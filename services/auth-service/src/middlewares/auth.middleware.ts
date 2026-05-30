import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { getUserPermissions } from "../repositories/role.repository";

export type AuthenticatedRequest = Request & {
  user?: {
    userId: string;
    email?: string;
    organizationId?: string | null;
  };
};

export function requireAuth(
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
    };

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token",
    });
  }
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
