import { Request, Response } from "express";
import { env } from "../config/env";
import { checkDatabaseHealth } from "../config/database";
import { checkRedisHealth } from "../config/redis";

export async function healthCheck(req: Request, res: Response) {
  const checks = {
    apiGateway: {
      status: "healthy",
      service: env.serviceName,
    },
    database: {
      status: "unknown",
      details: null as unknown,
    },
    redis: {
      status: "unknown",
      details: null as unknown,
    },
  };

  let overallStatus = "healthy";

  try {
    checks.database.details = await checkDatabaseHealth();
    checks.database.status = "healthy";
  } catch (error) {
    overallStatus = "degraded";
    checks.database.status = "unhealthy";
    checks.database.details = {
      message:
        error instanceof Error ? error.message : "Database health check failed",
    };
  }

  try {
    checks.redis.details = await checkRedisHealth();
    checks.redis.status = "healthy";
  } catch (error) {
    overallStatus = "degraded";
    checks.redis.status = "unhealthy";
    checks.redis.details = {
      message:
        error instanceof Error ? error.message : "Redis health check failed",
    };
  }

  return res.status(overallStatus === "healthy" ? 200 : 503).json({
    success: overallStatus === "healthy",
    message:
      overallStatus === "healthy"
        ? "Platform dependencies are healthy"
        : "Platform health is degraded",
    service: env.serviceName,
    status: overallStatus,
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
    requestId: req.headers["x-request-id"],
    checks,
  });
}
