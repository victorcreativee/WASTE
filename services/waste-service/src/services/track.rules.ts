// GPS track checks: compare a completed trip's GPS track with the disposal facilities and with its KCCA weighbridge ticket.
// Pure so KCCA can review the thresholds and tests can pin them; the repository feeds it the points and stores the result.

export const TRACK_RULES = {
  /** A trip with fewer points than this has no usable track. */
  minPoints: 5,
  /** The track is read from this long before the trip started... */
  windowBeforeMinutes: 30,
  /** ...until this long after it was completed (the drive to the facility). Drivers keep sharing location this long. */
  disposalLegHours: 6,
  /** GPS points this close in time to the ticket's arrival show where the truck was when it was weighed. */
  ticketToleranceMinutes: 20,
  /** If every such point is farther than this (or three times the facility radius, if larger) from the facility, the ticket and track disagree. */
  mismatchMinM: 2000,
  /** A stop is the truck staying within this distance... */
  stopRadiusM: 75,
  /** ...for at least this long. */
  stopMinutes: 30,
  /** A stop farther than this from the planned route is off route (only judged when the route has a line). */
  offRouteM: 500,
  /** Trips completed within this many days are checked again when late GPS data arrives. */
  recheckDays: 3,
};

export type TrackPoint = { lat: number; lng: number; at: number; routeDistanceM: number | null };
export type Facility = { code: string; lat: number; lng: number; radiusM: number };
export type Ticket = { id: string; facilityCode: string; arrivalAt: number } | null;
export type Stop = { lat: number; lng: number; from: string; to: string; minutes: number; offRoute: boolean | null };
export type TrackState = "consistent" | "no_gps" | "no_facility_visit" | "ticket_mismatch";

/** Distance in metres between two coordinates (haversine). */
export function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180, dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

/** Groups consecutive points that stay within stopRadiusM of the first one; keeps groups lasting stopMinutes or more, away from facilities. */
export function findStops(points: TrackPoint[], facilities: Facility[]): Stop[] {
  const stops: Stop[] = [];
  let start = 0;
  const close = (end: number) => {
    const group = points.slice(start, end), first = group[0], last = group[group.length - 1];
    if (!first || group.length < 2) return;
    const minutes = Math.round((last.at - first.at) / 60000);
    if (minutes < TRACK_RULES.stopMinutes) return;
    if (facilities.some(f => metres(first.lat, first.lng, f.lat, f.lng) <= f.radiusM)) return;
    const distances = group.map(p => p.routeDistanceM);
    const offRoute = distances.some(d => d === null) ? null : distances.every(d => (d as number) > TRACK_RULES.offRouteM);
    stops.push({ lat: first.lat, lng: first.lng, from: new Date(first.at).toISOString(), to: new Date(last.at).toISOString(), minutes, offRoute });
  };
  for (let i = 1; i <= points.length; i++) {
    if (i === points.length || metres(points[start].lat, points[start].lng, points[i].lat, points[i].lng) > TRACK_RULES.stopRadiusM) {
      close(i);
      start = i;
    }
  }
  return stops;
}

export function analyzeTrack(input: { points: TrackPoint[]; facilities: Facility[]; ticket: Ticket }) {
  const points = [...input.points].sort((a, b) => a.at - b.at);
  const { facilities, ticket } = input;
  let facilityCode: string | null = null, facilityVisitAt: string | null = null;
  for (const p of points) {
    const hit = facilities.find(f => metres(p.lat, p.lng, f.lat, f.lng) <= f.radiusM);
    if (hit) { facilityCode = hit.code; facilityVisitAt = new Date(p.at).toISOString(); break; }
  }
  let ticketGpsDistanceM: number | null = null, mismatch = false;
  const ticketFacility = ticket ? facilities.find(f => f.code === ticket.facilityCode) : undefined;
  if (ticket && ticketFacility) {
    const near = points.filter(p => Math.abs(p.at - ticket.arrivalAt) <= TRACK_RULES.ticketToleranceMinutes * 60000);
    if (near.length) {
      ticketGpsDistanceM = Math.min(...near.map(p => metres(p.lat, p.lng, ticketFacility.lat, ticketFacility.lng)));
      mismatch = ticketGpsDistanceM > Math.max(TRACK_RULES.mismatchMinM, ticketFacility.radiusM * 3);
    }
  }
  const stops = findStops(points, facilities);
  const state: TrackState = points.length < TRACK_RULES.minPoints ? "no_gps" : mismatch ? "ticket_mismatch" : facilityCode ? "consistent" : "no_facility_visit";
  return {
    state, gpsPoints: points.length,
    firstPointAt: points[0] ? new Date(points[0].at).toISOString() : null,
    lastPointAt: points.length ? new Date(points[points.length - 1].at).toISOString() : null,
    facilityCode, facilityVisitAt, ticketGpsDistanceM, stops,
    offRouteStops: stops.filter(s => s.offRoute === true).length,
    longestStopMinutes: stops.reduce((max, s) => Math.max(max, s.minutes), 0),
  };
}

/** The part of the day a trip's track is read from. */
export function trackWindow(startedAt: Date | null, completedAt: Date) {
  const start = startedAt ?? new Date(completedAt.getTime() - 12 * 3600000);
  return { from: new Date(start.getTime() - TRACK_RULES.windowBeforeMinutes * 60000), to: new Date(completedAt.getTime() + TRACK_RULES.disposalLegHours * 3600000) };
}
