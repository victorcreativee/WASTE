"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoutingProviderStatus = getRoutingProviderStatus;
exports.calculateRoadRoute = calculateRoadRoute;
const routing_factory_1 = require("../routing/routing.factory");
async function getRoutingProviderStatus() {
    return routing_factory_1.routingProvider.checkHealth();
}
async function calculateRoadRoute(coordinates) {
    try {
        return await routing_factory_1.routingProvider.calculateRoute(coordinates);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown routing provider error";
        const routingError = new Error(`Routing provider failed: ${message}`);
        routingError.statusCode = 502;
        throw routingError;
    }
}
