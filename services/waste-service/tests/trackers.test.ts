import assert from "node:assert/strict";
import test from "node:test";
import { generateApiKey, generateTrackerKey, hashApiKey, parseApiKey, parseTrackerKey } from "../src/services/api-keys";
import { createSchema, parseOsmAnd, parseTimestamp } from "../src/routes/tracker.routes";

test("tracker keys are shaped kwt_<id>_<secret> and are not API keys", () => {
  const a = generateTrackerKey(), b = generateTrackerKey();
  assert.match(a.key, /^kwt_[a-z0-9]{8}_[A-Za-z0-9]{32}$/);
  assert.notEqual(a.key, b.key);
  assert.equal(a.hash, hashApiKey(a.key));
  assert.deepEqual(parseTrackerKey(a.key), { prefix: a.prefix, hash: a.hash });
  assert.equal(parseApiKey(a.key), null);
  assert.equal(parseTrackerKey(generateApiKey().key), null);
  for (const bad of [undefined, "", "352093081234567", a.key.slice(0, -1), `${a.key}x`]) assert.equal(parseTrackerKey(bad), null);
});

test("timestamps: unix seconds, milliseconds or ISO; missing means now; garbage is refused", () => {
  assert.equal(parseTimestamp("1793546207")?.toISOString(), "2026-11-01T15:16:47.000Z");
  assert.equal(parseTimestamp(1793546207000)?.toISOString(), "2026-11-01T15:16:47.000Z");
  assert.equal(parseTimestamp("2026-11-01T15:16:47Z")?.toISOString(), "2026-11-01T15:16:47.000Z");
  assert.ok(Math.abs(parseTimestamp(undefined)!.getTime() - Date.now()) < 1000);
  assert.equal(parseTimestamp("yesterday"), null);
});

test("OsmAnd query form: speed in knots, bearing and accuracy", () => {
  const p = parseOsmAnd({ id: "kwt_x", lat: "0.3136", lon: "32.5811", timestamp: "1793546207", speed: "10", bearing: "90", accuracy: "8" }, {});
  assert.deepEqual({ ...p, recordedAt: p.recordedAt?.toISOString() },
    { id: "kwt_x", recordedAt: "2026-11-01T15:16:47.000Z", latitude: 0.3136, longitude: 32.5811, accuracyM: 8, speedKph: 18.52, heading: 90 });
  assert.equal(parseOsmAnd({ id: "kwt_x", lat: "0.3", lon: "32.5", speed: "-1" }, {}).speedKph, null, "unknown speed");
  assert.equal(parseOsmAnd({ id: "kwt_x", lon: "32.5" }, {}).latitude, null);
});

test("OsmAnd form body and Traccar Client JSON (speed in metres a second)", () => {
  assert.equal(parseOsmAnd({}, { id: "kwt_y", lat: "0.31", lon: "32.58" }).id, "kwt_y");
  const p = parseOsmAnd({}, { device_id: "kwt_z", location: { timestamp: "2026-11-01T15:16:47Z", coords: { latitude: 0.315, longitude: 32.583, accuracy: 5, speed: 5, heading: 180 } } });
  assert.deepEqual({ ...p, recordedAt: p.recordedAt?.toISOString() },
    { id: "kwt_z", recordedAt: "2026-11-01T15:16:47.000Z", latitude: 0.315, longitude: 32.583, accuracyM: 5, speedKph: 18, heading: 180 });
});

test("registering a tracker needs a truck and a name", () => {
  assert.equal(createSchema.safeParse({ truckId: "eeeeeeee-0000-0000-0000-000000000001", label: "FMB920" }).success, true);
  assert.equal(createSchema.safeParse({ truckId: "eeeeeeee-0000-0000-0000-000000000001", label: "F" }).success, false);
  assert.equal(createSchema.safeParse({ truckId: "UBA 123X", label: "FMB920" }).success, false);
});
