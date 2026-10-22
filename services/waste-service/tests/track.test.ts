import assert from "node:assert/strict";
import test from "node:test";
import { TRACK_RULES, analyzeTrack, findStops, metres, trackWindow } from "../src/services/track.rules";

const facility = { code: "KITEEZI", lat: 0.4053, lng: 32.5727, radiusM: 300 };
const t0 = Date.parse("2026-10-22T06:00:00Z");
const at = (minutes: number) => t0 + minutes * 60000;
const point = (lat: number, lng: number, minutes: number, routeDistanceM: number | null = 100) => ({ lat, lng, at: at(minutes), routeDistanceM });
// A trip in Nakawa, then the drive north to Kiteezi.
const collection = Array.from({ length: 8 }, (_, i) => point(0.33 + i * 0.002, 32.61, i * 10));
const toFacility = [point(0.37, 32.59, 90, 3000), point(0.4, 32.575, 110, 6000), point(0.4052, 32.5728, 120, 7000)];

test("distance between two points in metres", () => {
  assert.equal(metres(0.4053, 32.5727, 0.4053, 32.5727), 0);
  const d = metres(0.3476, 32.5825, 0.4053, 32.5727);
  assert.ok(d > 6400 && d < 6600, `Kampala centre to Kiteezi is about 6.5 km, got ${d}`);
});

test("a track that reaches the facility is consistent; one that never does is flagged; too few points is no GPS", () => {
  const ok = analyzeTrack({ points: [...collection, ...toFacility], facilities: [facility], ticket: null });
  assert.deepEqual([ok.state, ok.facilityCode, ok.gpsPoints], ["consistent", "KITEEZI", 11]);
  assert.equal(analyzeTrack({ points: collection, facilities: [facility], ticket: null }).state, "no_facility_visit");
  assert.equal(analyzeTrack({ points: collection.slice(0, TRACK_RULES.minPoints - 1), facilities: [facility], ticket: null }).state, "no_gps");
});

test("a ticket recorded while the GPS shows the truck elsewhere contradicts the track", () => {
  const ticketAtFacility = { id: "t", facilityCode: "KITEEZI", arrivalAt: at(121) };
  const agrees = analyzeTrack({ points: [...collection, ...toFacility], facilities: [facility], ticket: ticketAtFacility });
  assert.equal(agrees.state, "consistent");
  assert.ok((agrees.ticketGpsDistanceM ?? 99) < 50);
  const elsewhere = analyzeTrack({ points: collection, facilities: [facility], ticket: { id: "t", facilityCode: "KITEEZI", arrivalAt: at(65) } });
  assert.equal(elsewhere.state, "ticket_mismatch");
  assert.ok((elsewhere.ticketGpsDistanceM ?? 0) > TRACK_RULES.mismatchMinM);
  const noEvidence = analyzeTrack({ points: collection, facilities: [facility], ticket: { id: "t", facilityCode: "KITEEZI", arrivalAt: at(500) } });
  assert.deepEqual([noEvidence.state, noEvidence.ticketGpsDistanceM], ["no_facility_visit", null], "no GPS near the ticket time: no contradiction, but no visit either");
});

test("long stops away from facilities are found, and judged off route only when the route has a line", () => {
  const parked = [0, 10, 20, 35, 45].map(m => point(0.36, 32.64, 100 + m, 1200));
  const stops = findStops([...collection, ...parked], [facility]);
  assert.equal(stops.length, 1);
  assert.deepEqual([stops[0].minutes, stops[0].offRoute], [45, true]);
  assert.equal(findStops([0, 10, 20, 35].map(m => point(0.36, 32.64, m, null)), [facility])[0].offRoute, null);
  assert.equal(findStops([0, 10, 20, 40].map(m => point(0.4053, 32.5727, m, 9000)), [facility]).length, 0, "queuing at the landfill is not a stop");
  assert.equal(findStops([0, 10, 20].map(m => point(0.36, 32.64, m)), [facility]).length, 0, "under 30 minutes");
});

test("the track window covers the trip and the disposal leg", () => {
  const w = trackWindow(new Date("2026-10-22T06:00:00Z"), new Date("2026-10-22T11:00:00Z"));
  assert.deepEqual([w.from.toISOString(), w.to.toISOString()], ["2026-10-22T05:30:00.000Z", "2026-10-22T17:00:00.000Z"]);
});
