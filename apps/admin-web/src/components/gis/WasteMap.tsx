"use client";

import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";

type ZoneMapItem = {
  id: string;
  name: string;
  area_type: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
};

type RouteStop = {
  id: string;
  zone_id: string;
  zone_name: string | null;
  latitude: number | null;
  longitude: number | null;
  stop_order: number;
  status: string;
  waste_type: string;
};

type RouteGeometry = {
  type: "LineString";
  coordinates: [number, number][];
};

type WasteMapProps = {
  zones: ZoneMapItem[];
  routeStops: RouteStop[];
  routeGeometry: RouteGeometry | null;
};

const KAMPALA_CENTER: [number, number] = [0.3476, 32.5825];

export default function WasteMap({
  zones,
  routeStops,
  routeGeometry,
}: WasteMapProps) {
  const mappedZones = zones.filter(
    (zone) => zone.latitude !== null && zone.longitude !== null
  );

  const mappedRouteStops = routeStops
    .filter((stop) => stop.latitude !== null && stop.longitude !== null)
    .sort((a, b) => a.stop_order - b.stop_order);

  const roadRoutePositions: [number, number][] =
    routeGeometry?.type === "LineString"
      ? routeGeometry.coordinates
          .filter(
            ([longitude, latitude]) =>
              Number.isFinite(longitude) && Number.isFinite(latitude)
          )
          .map(
            ([longitude, latitude]) => [latitude, longitude] as [number, number]
          )
      : [];

  return (
    <MapContainer
      center={KAMPALA_CENTER}
      zoom={12}
      scrollWheelZoom
      className="h-[650px] w-full"
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {mappedZones.map((zone) => (
        <CircleMarker
          key={`zone-${zone.id}`}
          center={[Number(zone.latitude), Number(zone.longitude)]}
          radius={7}
          pathOptions={{
            color: "#047857",
            fillColor: "#10b981",
            fillOpacity: 0.7,
          }}
        >
          <Popup>
            <div>
              <strong>{zone.name}</strong>
              <br />
              Type: {zone.area_type.replaceAll("_", " ")}
              <br />
              Status: {zone.is_active ? "Active" : "Inactive"}
            </div>
          </Popup>
        </CircleMarker>
      ))}
      {roadRoutePositions.length >= 2 && (
        <Polyline
          positions={roadRoutePositions}
          pathOptions={{
            color: "#2563eb",
            weight: 4,
          }}
        />
      )}

      {mappedRouteStops.map((stop) => (
        <CircleMarker
          key={`route-stop-${stop.id}`}
          center={[Number(stop.latitude), Number(stop.longitude)]}
          radius={11}
          pathOptions={{
            color: "#1d4ed8",
            fillColor: "#2563eb",
            fillOpacity: 1,
          }}
        >
          <Popup>
            <div>
              <strong>Stop {stop.stop_order}</strong>
              <br />
              {stop.zone_name || "Unknown zone"}
              <br />
              Waste: {stop.waste_type.replaceAll("_", " ")}
              <br />
              Status: {stop.status.replaceAll("_", " ")}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
