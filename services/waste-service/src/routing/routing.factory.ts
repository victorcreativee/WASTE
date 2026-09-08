import { env } from "../config/env";
import { RoutingProvider } from "./routing.provider";
import { OsrmRoutingProvider } from "./providers/osrm-routing.provider";

export function createRoutingProvider(): RoutingProvider {
  const provider = env.routingProvider.trim().toLowerCase();

  switch (provider) {
    case "osrm":
      return new OsrmRoutingProvider({
        baseUrl: env.osrmBaseUrl,
        profile: env.osrmProfile,
        timeoutMs: env.routingRequestTimeoutMs,
        healthCheckCoordinate: {
          latitude: env.routingHealthCheckLatitude,
          longitude: env.routingHealthCheckLongitude,
        },
      });

    default:
      throw new Error(`Unsupported routing provider: ${env.routingProvider}`);
  }
}

export const routingProvider = createRoutingProvider();
