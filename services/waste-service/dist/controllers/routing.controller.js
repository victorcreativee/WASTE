"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoutingStatusHandler = getRoutingStatusHandler;
const routing_service_1 = require("../services/routing.service");
async function getRoutingStatusHandler(req, res) {
    const status = await (0, routing_service_1.getRoutingProviderStatus)();
    return res.status(status.reachable ? 200 : 503).json({
        success: status.reachable,
        message: status.message,
        data: status,
    });
}
