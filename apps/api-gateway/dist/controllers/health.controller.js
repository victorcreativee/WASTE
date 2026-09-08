"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = healthCheck;
const env_1 = require("../config/env");
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
async function healthCheck(req, res) {
    const checks = {
        apiGateway: {
            status: "healthy",
            service: env_1.env.serviceName,
        },
        database: {
            status: "unknown",
            details: null,
        },
        redis: {
            status: "unknown",
            details: null,
        },
    };
    let overallStatus = "healthy";
    try {
        checks.database.details = await (0, database_1.checkDatabaseHealth)();
        checks.database.status = "healthy";
    }
    catch (error) {
        overallStatus = "degraded";
        checks.database.status = "unhealthy";
        checks.database.details = {
            message: error instanceof Error ? error.message : "Database health check failed",
        };
    }
    try {
        checks.redis.details = await (0, redis_1.checkRedisHealth)();
        checks.redis.status = "healthy";
    }
    catch (error) {
        overallStatus = "degraded";
        checks.redis.status = "unhealthy";
        checks.redis.details = {
            message: error instanceof Error ? error.message : "Redis health check failed",
        };
    }
    return res.status(overallStatus === "healthy" ? 200 : 503).json({
        success: overallStatus === "healthy",
        message: overallStatus === "healthy"
            ? "Platform dependencies are healthy"
            : "Platform health is degraded",
        service: env_1.env.serviceName,
        status: overallStatus,
        environment: env_1.env.nodeEnv,
        timestamp: new Date().toISOString(),
        requestId: req.headers["x-request-id"],
        checks,
    });
}
