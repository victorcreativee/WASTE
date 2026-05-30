import { Request, Response } from "express";
import { env } from "../config/env";
import { checkDatabaseHealth } from "../config/database";

export async function healthCheck(req: Request, res: Response) {
  try {
    const database = await checkDatabaseHealth();

    return res.status(200).json({
      success: true,
      service: env.serviceName,
      status: "healthy",
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
      database,
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      service: env.serviceName,
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Health check failed",
    });
  }
}
