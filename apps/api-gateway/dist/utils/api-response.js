"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSuccess = sendSuccess;
exports.sendError = sendError;
function sendSuccess(res, message, data, statusCode = 200) {
    return res.status(statusCode).json({
        success: true,
        message,
        data: data ?? null,
    });
}
function sendError(res, message, statusCode = 500, details) {
    return res.status(statusCode).json({
        success: false,
        message,
        details: details ?? null,
    });
}
