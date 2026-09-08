"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routingProvider = void 0;
exports.createRoutingProvider = createRoutingProvider;
const env_1 = require("../config/env");
const osrm_routing_provider_1 = require("./providers/osrm-routing.provider");
function createRoutingProvider() {
    const provider = env_1.env.routingProvider.trim().toLowerCase();
    switch (provider) {
        case "osrm":
            return new osrm_routing_provider_1.OsrmRoutingProvider({
                baseUrl: env_1.env.osrmBaseUrl,
                profile: env_1.env.osrmProfile,
                timeoutMs: env_1.env.routingRequestTimeoutMs,
                healthCheckCoordinate: {
                    latitude: env_1.env.routingHealthCheckLatitude,
                    longitude: env_1.env.routingHealthCheckLongitude,
                },
            });
        default:
            throw new Error(`Unsupported routing provider: ${env_1.env.routingProvider}`);
    }
}
exports.routingProvider = createRoutingProvider();
