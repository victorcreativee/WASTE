"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = healthCheck;
const env_1 = require("../config/env");
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
async function healthCheck(req, res) {
    async function serviceHealth(name, url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        try {
            const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
            return { status: response.ok ? "healthy" : "unhealthy", service: name, httpStatus: response.status };
        }
        catch {
            return { status: "unhealthy", service: name, httpStatus: null };
        }
        finally {
            clearTimeout(timer);
        }
    }
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
        authService: { status: "unknown", service: "auth-service", httpStatus: null },
        organizationService: { status: "unknown", service: "organization-service", httpStatus: null },
        wasteService: { status: "unknown", service: "waste-service", httpStatus: null },
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
    const [authService, organizationService, wasteService] = await Promise.all([
        serviceHealth("auth-service", `${env_1.env.authServiceUrl}/api/auth/health`),
        serviceHealth("organization-service", `${env_1.env.organizationServiceUrl}/api/organizations/health`),
        serviceHealth("waste-service", `${env_1.env.wasteServiceUrl}/api/waste/health`),
    ]);
    checks.authService = authService;
    checks.organizationService = organizationService;
    checks.wasteService = wasteService;
    if ([authService, organizationService, wasteService].some(check => check.status !== "healthy"))
        overallStatus = "degraded";
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
