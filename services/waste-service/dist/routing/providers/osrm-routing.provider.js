"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OsrmRoutingProvider = void 0;
function isLineStringGeometry(geometry) {
    if (!geometry || typeof geometry !== "object") {
        return false;
    }
    const candidate = geometry;
    return (candidate.type === "LineString" &&
        Array.isArray(candidate.coordinates) &&
        candidate.coordinates.length >= 2 &&
        candidate.coordinates.every((coordinate) => Array.isArray(coordinate) &&
            coordinate.length === 2 &&
            coordinate.every(Number.isFinite)));
}
class OsrmRoutingProvider {
    name = "osrm";
    baseUrl;
    profile;
    timeoutMs;
    healthCheckCoordinate;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/$/, "");
        this.profile = options.profile;
        this.timeoutMs = options.timeoutMs;
        this.healthCheckCoordinate = options.healthCheckCoordinate;
    }
    async calculateRoute(coordinates) {
        if (coordinates.length < 2) {
            throw new Error("At least two coordinates are required for routing");
        }
        const coordinateString = coordinates
            .map(({ latitude, longitude }) => `${longitude},${latitude}`)
            .join(";");
        const response = await this.request(`/route/v1/${this.profile}/${coordinateString}?overview=full&geometries=geojson&steps=false`);
        const route = response.routes?.[0];
        if (response.code !== "Ok" ||
            !route ||
            !Number.isFinite(route.distance) ||
            !Number.isFinite(route.duration) ||
            !isLineStringGeometry(route.geometry)) {
            throw new Error(response.message || `OSRM returned an invalid route: ${response.code}`);
        }
        return {
            distanceMeters: route.distance,
            durationSeconds: route.duration,
            geometry: route.geometry,
        };
    }
    async checkHealth() {
        const { latitude, longitude } = this.healthCheckCoordinate;
        try {
            const response = await this.request(`/nearest/v1/${this.profile}/${longitude},${latitude}?number=1`);
            const reachable = response.code === "Ok";
            return {
                provider: this.name,
                reachable,
                baseUrl: this.baseUrl,
                profile: this.profile,
                message: reachable
                    ? "Routing provider is reachable"
                    : response.message || `Routing provider returned ${response.code}`,
            };
        }
        catch (error) {
            return {
                provider: this.name,
                reachable: false,
                baseUrl: this.baseUrl,
                profile: this.profile,
                message: error instanceof Error
                    ? error.message
                    : "Routing provider health check failed",
            };
        }
    }
    async request(path) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                },
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`Routing provider request failed with status ${response.status}`);
            }
            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                throw new Error("Routing provider returned a non-JSON response");
            }
            const data = (await response.json());
            return data;
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`Routing provider timed out after ${this.timeoutMs}ms`);
            }
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
exports.OsrmRoutingProvider = OsrmRoutingProvider;
