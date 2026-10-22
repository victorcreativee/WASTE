// End-to-end check of Module 11 (GPS track checks) against a running waste-service and the local database with migrations
// 092–102 applied. Creates its own fixtures and removes or deactivates them afterwards.
//
//   E2E_BASE_URL=http://localhost:8193 npm run test:e2e:tracks
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-track-${Date.now()}`;
const facilityCode = `E2ET${tag.replace(/\D/g, "").slice(-8)}`;
const FACILITY = { lat: 0.40, lng: 32.66 }, TOWN = { lat: 0.36, lng: 32.62 };
const ids = {}, trips = {}, trucks = {};
let passed = 0;

const sql = async (text, params = []) => (await pool.query(text, params)).rows;
const token = userId => jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
async function api(method, url, user, body) {
  const response = await fetch(`${BASE}/api/waste${url}`, {
    method, headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function step(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const hoursAgo = h => new Date(Date.now() - h * 3600000);

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  const org = async name => (await sql(
    `INSERT INTO organizations(name,type,is_active,created_at,platform_package_id) VALUES($1,'waste_collection_company',true,'2026-08-01',(SELECT id FROM platform_packages WHERE code='collector_professional')) RETURNING id`,
    [`${name} ${tag}`]))[0].id;
  ids.collector = await org("E2E Tracked Collectors");
  ids.other = await org("E2E Other Collectors");
  const user = async (name, roleName, organizationId) => {
    const id = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES($1,$2,'not-a-login','active',$3) RETURNING id",
      [name, `${tag}-${roleName}-${Math.random().toString(36).slice(2, 7)}@example.test`, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role(roleName)]);
    if (organizationId) await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  ids.kcca = await user("E2E KCCA Officer", "kcca_admin", null);
  ids.system = await user("E2E System Admin", "system_admin", null);
  ids.operator = await user("E2E Weighbridge Operator", "weighbridge_operator", null);
  ids.admin = await user("E2E Tracked Admin", "company_admin", ids.collector);
  ids.supervisor = await user("E2E Tracked Supervisor", "supervisor", ids.collector);
  ids.otherAdmin = await user("E2E Other Admin", "company_admin", ids.other);
  ids.driverUser = await user("E2E Driver", "driver", ids.collector);
  ids.driver = (await sql("INSERT INTO drivers(organization_id,user_id,full_name,status) VALUES($1,$2,'E2E Driver','available') RETURNING id", [ids.collector, ids.driverUser]))[0].id;
  ids.today = (await sql("SELECT CURRENT_DATE::text AS d"))[0].d;
  ids.division = (await sql("SELECT id FROM kampala_divisions ORDER BY name LIMIT 1"))[0].id;
  const permit = await api("POST", `/regulatory/organizations/${ids.collector}/permits`, ids.kcca, {
    registrationNumber: `E2E-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, contactName: "Peter Ssali", email: "peter@example.test",
    phone: "+256700000006", address: "Plot 3, Kira Road", serviceDescription: "Household waste collection.",
    validUntil: addDays(ids.today, 300), activityCodes: ["household_collection"], notes: "Fleet inspected",
  });
  assert.equal(permit.status, 201, JSON.stringify(permit.body));
  const authz = await api("POST", "/regulatory/division-authorizations", ids.kcca, { organizationId: ids.collector, permitApplicationId: permit.body.data.id, divisionIds: [ids.division], expiresOn: addDays(ids.today, 300) });
  assert.equal(authz.status, 201, JSON.stringify(authz.body));
  const zone = (await sql("INSERT INTO waste_zones(organization_id,name,division_id) VALUES($1,$2,$3) RETURNING id", [ids.collector, `E2E zone ${tag}`, ids.division]))[0].id;
  ids.route = (await sql("INSERT INTO service_routes(organization_id,name,zone_id,division_id) VALUES($1,$2,$3,$4) RETURNING id", [ids.collector, `E2E route ${tag}`, zone, ids.division]))[0].id;
  for (const n of [1, 2, 3, 4, 5]) {
    const plate = `UT${tag.replace(/\D/g, "").slice(-3)}${n}K`;
    trucks[n] = { plate, id: (await sql("INSERT INTO waste_trucks(organization_id,plate_number,truck_name,status) VALUES($1,$2,$3,'available') RETURNING id", [ids.collector, plate, `E2E truck ${n}`]))[0].id };
  }
}

/** A completed trip that started `started` hours ago and finished `finished` hours ago; optionally with a route line through town. */
async function trip(name, truck, started, finished, withLine = false) {
  trips[name] = (await sql(
    `INSERT INTO collection_routes(organization_id,service_route_id,name,trip_number,truck_id,driver_id,route_date,status,started_at,completed_at,route_geometry)
     VALUES($1,$2,$3,$4,$5,$6,(LOCALTIMESTAMP-make_interval(hours=>$7::int))::date,'completed',LOCALTIMESTAMP-make_interval(hours=>$7::int),LOCALTIMESTAMP-make_interval(hours=>$8::int),
       CASE WHEN $9 THEN ST_GeomFromText('LINESTRING(32.62 0.36,32.62 0.38)',4326) END) RETURNING id`,
    [ids.collector, ids.route, `E2E ${name}`, `${tag}-${name}`.slice(0, 40), trucks[truck].id, ids.driver, started, finished, withLine]))[0].id;
}

/** GPS points for a truck: [hoursAgo, lat, lng] triples. */
async function gps(truck, points) {
  for (const [h, lat, lng] of points) {
    await sql(`INSERT INTO vehicle_location_events(organization_id,truck_id,location,accuracy_m,speed_kph,recorded_at,source)
      VALUES($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,10,20,$5,'driver_mobile')`, [ids.collector, trucks[truck].id, lng, lat, hoursAgo(h)]);
  }
}
const inTown = (fromHours, count, step = 0.25) => Array.from({ length: count }, (_, i) => [fromHours - i * step, TOWN.lat + i * 0.002, TOWN.lng]);

const ticket = (truck, arrivedHoursAgo) => {
  const arrival = hoursAgo(arrivedHoursAgo), departure = hoursAgo(arrivedHoursAgo - 0.3);
  return api("POST", "/weighbridge/transactions", ids.operator, {
    organizationId: ids.collector, facility: "Typed by the operator", facilityCode, registration: trucks[truck].plate, driverName: "E2E Driver",
    routeSource: "Nakawa", operationDate: arrival.toISOString().slice(0, 10), arrivalAt: arrival.toISOString(), grossKg: 14000, tareCaptureMode: "second_weighing",
    status: "completed", tareKg: 8000, departureAt: departure.toISOString(),
  });
};

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map(r => r.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[]) OR organization_id=ANY($2::uuid[])", [users, orgs]);
  await sql("DELETE FROM trip_track_checks WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM vehicle_location_events WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM weighbridge_transactions WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM collection_routes WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM service_routes WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM waste_zones WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM drivers WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM waste_trucks WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM disposal_facilities WHERE code=$1", [facilityCode]);
  await sql("DELETE FROM regulatory_returns WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_division_authorizations WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_permit_applications WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM notification_preferences WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  // Organization audit events are immutable by design, so the organizations are deactivated.
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

const checks = async (user = ids.kcca, query = "") => (await api("GET", `/tracks/checks?period=30d${query}`, user)).body.data;
const stateOf = async name => (await checks(ids.kcca, `&organizationId=${ids.collector}`)).find(c => c.trip_id === trips[name])?.state;

async function run() {
  await setup();

  console.log("Facility geofences");
  await step("KCCA sets where a facility is and how far its gate area reaches", async () => {
    let r = await api("PUT", "/disposal/facilities", ids.kcca, { code: facilityCode, name: "E2E Landfill", kind: "landfill" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await api("PUT", `/tracks/facilities/${facilityCode}/location`, ids.supervisor, { latitude: FACILITY.lat, longitude: FACILITY.lng, radiusM: 400 })).status, 403);
    assert.equal((await api("PUT", `/tracks/facilities/${facilityCode}/location`, ids.kcca, { latitude: FACILITY.lat, longitude: FACILITY.lng, radiusM: 20 })).status, 400);
    r = await api("PUT", `/tracks/facilities/${facilityCode}/location`, ids.kcca, { latitude: FACILITY.lat, longitude: FACILITY.lng, radiusM: 400 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const list = (await api("GET", "/tracks/facilities", ids.kcca)).body.data;
    assert.ok(list.some(f => f.code === facilityCode && Number(f.radius_m) === 400 && Math.abs(Number(f.latitude) - FACILITY.lat) < 1e-6));
  });

  console.log("Checking trips");
  await step("tracks are compared with the facility and the weighbridge ticket once the disposal leg is over", async () => {
    // A: collects in town, drives to the landfill, weighed there.
    await trip("consistent", 1, 13, 8);
    await gps(1, [...inTown(12.5, 8), [7.6, 0.38, 32.64], [7.2, FACILITY.lat + 0.0005, FACILITY.lng], [7.0, FACILITY.lat, FACILITY.lng + 0.0005]]);
    let r = await ticket(1, 7.1);
    assert.equal(r.body.data.trip_id, trips.consistent);
    // B: weighed at the landfill while its GPS was still in town.
    await trip("mismatch", 2, 13, 8);
    await gps(2, inTown(12.5, 24));
    r = await ticket(2, 7.5);
    assert.equal(r.body.data.trip_id, trips.mismatch);
    // C: never goes near a facility, and parks 45 minutes well away from its route.
    await trip("no-visit", 3, 13, 8, true);
    await gps(3, [...inTown(12.5, 6), [10.5, 0.37, 32.65], [10.25, 0.37, 32.65], [10.0, 0.37, 32.65], [9.75, 0.37, 32.65]]);
    // D: two points only.
    await trip("no-gps", 4, 13, 8);
    await gps(4, inTown(12, 2));
    // E: finished an hour ago, disposal leg still open.
    await trip("open", 5, 4, 1);
    r = await api("POST", "/tracks/run", ids.system);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await stateOf("consistent"), "consistent");
    assert.equal(await stateOf("mismatch"), "ticket_mismatch");
    assert.equal(await stateOf("no-visit"), "no_facility_visit");
    assert.equal(await stateOf("no-gps"), "no_gps");
    assert.equal(await stateOf("open"), undefined);
    const c = (await checks(ids.kcca, `&organizationId=${ids.collector}&view=stops`))[0];
    assert.deepEqual([c.trip_id, c.off_route_stops, c.longest_stop_minutes], [trips["no-visit"], 1, 45]);
  });
  await step("KCCA is told when GPS contradicts a ticket, and the company gets one daily digest", async () => {
    const [mismatch] = await sql("SELECT severity,body FROM notifications WHERE recipient_user_id=$1 AND dedupe_key=$2", [ids.kcca, `track-mismatch:${trips.mismatch}`]);
    assert.equal(mismatch.severity, "warning");
    assert.match(mismatch.body, /km from the facility/);
    await api("POST", "/tracks/run", ids.system);
    const digests = await sql("SELECT body FROM notifications WHERE recipient_user_id=$1 AND dedupe_key LIKE 'track-digest:%'", [ids.admin]);
    assert.equal(digests.length, 1);
    assert.match(digests[0].body, /1 trip whose GPS track never reached a disposal facility and 1 weighbridge ticket recorded while/);
    assert.equal((await sql("SELECT COUNT(*)::int AS n FROM notifications WHERE recipient_user_id=$1 AND dedupe_key=$2", [ids.kcca, `track-mismatch:${trips.mismatch}`]))[0].n, 1);
  });
  await step("the trip detail carries the track, the facility and the ticket for the map", async () => {
    const d = (await api("GET", `/tracks/checks/${trips.mismatch}`, ids.kcca)).body.data;
    assert.equal(d.points.length, 24);
    assert.ok(d.facilities.some(f => f.code === facilityCode));
    assert.ok(d.ticket_number && d.ticket_gps_distance_m > 2000);
    const line = (await api("GET", `/tracks/checks/${trips["no-visit"]}`, ids.kcca)).body.data.route_line;
    assert.equal(line.type, "LineString");
  });

  console.log("Late data and the disposal leg");
  await step("a trip is checked again when late GPS data shows it reached the facility", async () => {
    assert.equal((await api("POST", `/tracks/checks/${trips.open}/recheck`, ids.kcca)).status, 409);
    await gps(3, [[7.5, FACILITY.lat, FACILITY.lng], [7.4, FACILITY.lat + 0.0003, FACILITY.lng]]);
    assert.equal((await api("POST", `/tracks/checks/${trips["no-visit"]}/recheck`, ids.admin)).status, 403);
    const r = await api("POST", `/tracks/checks/${trips["no-visit"]}/recheck`, ids.kcca);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.data.previous, r.body.data.state], ["no_facility_visit", "consistent"]);
  });
  await step("drivers keep sharing location after completing a trip until it is weighed", async () => {
    const send = routeId => api("POST", "/fleet/live/location", ids.driverUser, { routeId, latitude: 0.37, longitude: 32.63, accuracyM: 8, speedKph: 30 });
    let r = await send(trips.open);
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    r = await send(trips.consistent);
    assert.equal(r.status, 403, "already weighed");
  });

  console.log("Access and overview");
  await step("companies see only their own checks; KCCA sees coverage and consistency per company", async () => {
    assert.equal((await checks(ids.supervisor)).length, 4);
    assert.equal((await checks(ids.otherAdmin)).length, 0);
    assert.equal((await api("GET", `/tracks/checks/${trips.mismatch}`, ids.otherAdmin)).status, 404);
    const o = (await api("GET", `/tracks/overview?period=30d&organizationId=${ids.collector}`, ids.kcca)).body.data;
    const company = o.companies.find(c => c.id === ids.collector);
    assert.deepEqual([company.checked, company.consistent, company.no_gps, company.ticket_mismatch, company.no_facility_visit, company.gps_coverage, company.consistent_rate], [4, 2, 1, 1, 0, 75, 66.7]);
    assert.ok(o.unchecked_trips >= 1, "the open trip is not checked yet");
    const own = (await api("GET", "/tracks/overview?period=30d", ids.admin)).body.data;
    assert.deepEqual(own.companies.map(c => c.id), [ids.collector]);
  });
}

// E2E_KEEP=1 leaves the fixtures for a manual look; E2E_CLEANUP_TAG=<tag> E2E_CLEANUP_ONLY=1 removes them later.
(process.env.E2E_CLEANUP_ONLY ? Promise.resolve(console.log(`Cleaning up ${tag}`)) : run().then(() => console.log(`\nAll ${passed} checks passed.`)))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => {
    if (process.env.E2E_KEEP) console.log(`Fixtures kept (${tag}). Remove with: E2E_CLEANUP_TAG=${tag} E2E_CLEANUP_ONLY=1 node scripts/e2e-track-checks.cjs`);
    else await cleanup().catch(e => console.error("Cleanup failed", e));
    await pool.end();
  });
