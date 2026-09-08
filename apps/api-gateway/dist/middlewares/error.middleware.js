"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMiddleware = errorMiddleware;
const app_error_1 = require("../utils/app-error");
const logger_1 = require("../utils/logger");
function errorMiddleware(error, req, res, next) {
    const requestId = req.headers["x-request-id"]?.toString();
    if (error instanceof app_error_1.AppError) {
        logger_1.logger.warn(error.message, {
            requestId,
            path: req.originalUrl,
            statusCode: error.statusCode,
        });
        return res.status(error.statusCode).json({
            success: false,
            message: error.message,
            requestId,
        });
    }
    logger_1.logger.error("Unhandled server error", {
        requestId,
        path: req.originalUrl,
        message: error.message,
        stack: error.stack,
    });
    return res.status(500).json({
        success: false,
        message: "Internal server error",
        requestId,
    });
}
