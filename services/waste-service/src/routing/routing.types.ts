export interface RoutingCoordinate {
  latitude: number;
  longitude: number;
}

export interface RoutingLineStringGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface RoutingResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: RoutingLineStringGeometry;
}

export interface RoutingProviderHealth {
  provider: string;
  reachable: boolean;
  baseUrl: string;
  profile: string;
  message: string;
}
