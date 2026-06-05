"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = healthCheck;
const env_1 = require("../config/env");
const database_1 = require("../config/database");
async function healthCheck(req, res) {
    try {
        const database = await (0, database_1.checkDatabaseHealth)();
        return res.status(200).json({
            success: true,
            service: env_1.env.serviceName,
            status: "healthy",
            environment: env_1.env.nodeEnv,
            timestamp: new Date().toISOString(),
            database,
        });
    }
    catch (error) {
        return res.status(503).json({
            success: false,
            service: env_1.env.serviceName,
            status: "unhealthy",
            message: error instanceof Error ? error.message : "Health check failed",
        });
    }
}
