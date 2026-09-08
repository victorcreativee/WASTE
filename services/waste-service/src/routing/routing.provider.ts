import {
  RoutingCoordinate,
  RoutingProviderHealth,
  RoutingResult,
} from "./routing.types";

export interface RoutingProvider {
  readonly name: string;

  calculateRoute(coordinates: RoutingCoordinate[]): Promise<RoutingResult>;

  checkHealth(): Promise<RoutingProviderHealth>;
}
