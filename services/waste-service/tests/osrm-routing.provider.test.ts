import assert from "node:assert/strict";
import test from "node:test";

import { OsrmRoutingProvider } from "../src/routing/providers/osrm-routing.provider";

const originalFetch = global.fetch;

function provider(timeoutMs = 1000) {
  return new OsrmRoutingProvider({
    baseUrl: "https://routing.example.test/",
    profile: "driving",
    timeoutMs,
    healthCheckCoordinate: { latitude: 0.3476, longitude: 32.5825 },
  });
}

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("requests longitude-latitude coordinates and returns GeoJSON metrics", async () => {
  global.fetch = async (input) => {
    assert.equal(
      String(input),
      "https://routing.example.test/route/v1/driving/32.58,0.34;32.6,0.36?overview=full&geometries=geojson&steps=false"
    );

    return new Response(
      JSON.stringify({
        code: "Ok",
        routes: [
          {
            distance: 3210.5,
            duration: 845.2,
            geometry: {
              type: "LineString",
              coordinates: [
                [32.58, 0.34],
                [32.59, 0.35],
                [32.6, 0.36],
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const result = await provider().calculateRoute([
    { latitude: 0.34, longitude: 32.58 },
    { latitude: 0.36, longitude: 32.6 },
  ]);

  assert.equal(result.distanceMeters, 3210.5);
  assert.equal(result.durationSeconds, 845.2);
  assert.deepEqual(result.geometry.coordinates[1], [32.59, 0.35]);
});

test("rejects an invalid route geometry", async () => {
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        code: "Ok",
        routes: [
          {
            distance: 100,
            duration: 30,
            geometry: { type: "LineString", coordinates: [[32.58, 0.34]] },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  await assert.rejects(
    provider().calculateRoute([
      { latitude: 0.34, longitude: 32.58 },
      { latitude: 0.36, longitude: 32.6 },
    ]),
    /invalid route/
  );
});

test("reports a useful timeout error", async () => {
  global.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  await assert.rejects(
    provider(5).calculateRoute([
      { latitude: 0.34, longitude: 32.58 },
      { latitude: 0.36, longitude: 32.6 },
    ]),
    /timed out after 5ms/
  );
});
