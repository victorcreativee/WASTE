import { routingProvider } from "../routing/routing.factory";
import { RoutingCoordinate } from "../routing/routing.types";

export async function getRoutingProviderStatus() {
  return routingProvider.checkHealth();
}

export async function calculateRoadRoute(coordinates: RoutingCoordinate[]) {
  try {
    return await routingProvider.calculateRoute(coordinates);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown routing provider error";

    const routingError = new Error(
      `Routing provider failed: ${message}`
    ) as Error & {
      statusCode?: number;
    };

    routingError.statusCode = 502;

    throw routingError;
  }
}
