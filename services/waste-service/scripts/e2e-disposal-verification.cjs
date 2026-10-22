// End-to-end check of Module 8 (disposal verification) against a running waste-service and the local database with
// migrations 092–099 applied. Creates its own fixtures and removes or deactivates them afterwards.
//
//   E2E_BASE_URL=http://localhost:8193 npm run test:e2e:disposal
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-disposal-${Date.now()}`;
const facilityCode = `E2E${tag.replace(/\D/g, "").slice(-8)}`;
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
const hoursAgo = hours => new Date(Date.now() - hours * 3600000).toISOString();

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  const org = async (name, type, pkg) => (await sql(
    `INSERT INTO organizations(name,type,is_active,created_at,platform_package_id) VALUES($1,$2,true,'2026-08-01',(SELECT id FROM platform_packages WHERE code=$3)) RETURNING id`,
    [`${name} ${tag}`, type, pkg]))[0].id;
  ids.collector = await org("E2E Disposal Collectors", "waste_collection_company", "collector_professional");
  ids.other = await org("E2E Other Collectors", "waste_collection_company", "collector_professional");
  ids.recycler = await org("E2E Disposal Recyclers", "recycling_company", "recycling_professional");
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
  ids.admin = await user("E2E Collector Admin", "company_admin", ids.collector);
  ids.supervisor = await user("E2E Collector Supervisor", "supervisor", ids.collector);
  ids.otherAdmin = await user("E2E Other Admin", "company_admin", ids.other);
  ids.recyclerAdmin = await user("E2E Recycler Admin", "company_admin", ids.recycler);
  ids.today = (await sql("SELECT CURRENT_DATE::text AS d"))[0].d;
  ids.division = (await sql("SELECT id FROM kampala_divisions ORDER BY name LIMIT 1"))[0].id;

  // A licensed collector authorized for one division, with a zone, a service route and seven trucks.
  const permit = await api("POST", `/regulatory/organizations/${ids.collector}/permits`, ids.kcca, {
    registrationNumber: `E2E-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, contactName: "Sarah Nakato", email: "sarah@example.test",
    phone: "+256700000004", address: "Plot 5, Jinja Road", serviceDescription: "Household and commercial waste collection.",
    validUntil: addDays(ids.today, 300), activityCodes: ["household_collection", "commercial_collection"], notes: "Fleet inspected",
  });
  assert.equal(permit.status, 201, JSON.stringify(permit.body));
  const authz = await api("POST", "/regulatory/division-authorizations", ids.kcca, { organizationId: ids.collector, permitApplicationId: permit.body.data.id, divisionIds: [ids.division], expiresOn: addDays(ids.today, 300) });
  assert.equal(authz.status, 201, JSON.stringify(authz.body));
  const zone = (await sql("INSERT INTO waste_zones(organization_id,name,division_id) VALUES($1,$2,$3) RETURNING id", [ids.collector, `E2E zone ${tag}`, ids.division]))[0].id;
  ids.route = (await sql("INSERT INTO service_routes(organization_id,name,zone_id,division_id) VALUES($1,$2,$3,$4) RETURNING id", [ids.collector, `E2E route ${tag}`, zone, ids.division]))[0].id;
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const plate = `UE${tag.replace(/\D/g, "").slice(-3)}${n}X`;
    trucks[n] = { plate, id: (await sql("INSERT INTO waste_trucks(organization_id,plate_number,truck_name,status) VALUES($1,$2,$3,'available') RETURNING id", [ids.collector, plate, `E2E truck ${n}`]))[0].id };
  }
}

/** A completed collection trip on a service route, finished `hours` ago. */
async function completedTrip(name, truck, hours) {
  const row = (await sql(
    `INSERT INTO collection_routes(organization_id,service_route_id,name,trip_number,truck_id,route_date,status,started_at,completed_at)
     VALUES($1,$2,$3,$4,$5,(LOCALTIMESTAMP-make_interval(hours=>$6::int))::date,'completed',LOCALTIMESTAMP-make_interval(hours=>$6::int+3),LOCALTIMESTAMP-make_interval(hours=>$6::int)) RETURNING id`,
    [ids.collector, ids.route, `E2E ${name}`, `${tag}-${name}`.slice(0, 40), trucks[truck].id, hours]))[0];
  trips[name] = row.id;
  return row.id;
}

const ticket = (truck, { hours = 50, status = "completed", code = "BUYALA", organizationId = ids.collector, net = 6200 } = {}) => {
  const arrival = hoursAgo(hours), departure = hoursAgo(hours - 0.5);
  return api("POST", "/weighbridge/transactions", ids.operator, {
    organizationId, facility: "Typed by the operator", facilityCode: code, registration: trucks[truck].plate, driverName: "E2E Driver",
    routeSource: "Nakawa market", operationDate: arrival.slice(0, 10), arrivalAt: arrival, grossKg: 15000, tareCaptureMode: "second_weighing", status,
    ...(status === "completed" ? { tareKg: 15000 - net, departureAt: departure } : {}),
  });
};

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map(r => r.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  await sql("DELETE FROM trip_disposal_explanations WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM weighbridge_transactions WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM collection_routes WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM service_routes WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM waste_zones WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM waste_trucks WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM disposal_facilities WHERE code=$1", [facilityCode]);
  await sql("DELETE FROM regulatory_returns WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_division_authorizations WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_permit_applications WHERE organization_id=ANY($1::uuid[])", [orgs]);
  // KCCA-wide notifications about these companies reach every KCCA officer, so they are removed by organization too.
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[]) OR organization_id=ANY($2::uuid[])", [users, orgs]);
  await sql("DELETE FROM notification_preferences WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  // Organization audit events are immutable by design, so the organizations are deactivated.
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

const summary = async (user = ids.admin) => (await api("GET", "/disposal/summary?period=30d", user)).body.data;
const tripsIn = async (state, user = ids.admin) => (await api("GET", `/disposal/trips?period=30d${state ? `&state=${state}` : ""}`, user)).body.data;
const stateOf = async name => (await tripsIn()).find(t => t.trip_id === trips[name])?.state;

async function run() {
  await setup();

  console.log("Disposal facilities");
  await step("tickets must name a registered, active facility; the facility name comes from the registry", async () => {
    const list = (await api("GET", "/disposal/facilities", ids.operator)).body.data;
    assert.ok(["BUYALA", "KITEEZI"].every(code => list.some(f => f.code === code)));
    assert.equal((await api("PUT", "/disposal/facilities", ids.admin, { code: facilityCode, name: "E2E transfer", kind: "transfer_station" })).status, 403);
    let r = await api("PUT", "/disposal/facilities", ids.kcca, { code: facilityCode, name: "E2E Nakawa transfer station", kind: "transfer_station", isActive: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await ticket(7, { code: facilityCode });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /active disposal facility/);
    assert.equal((await ticket(7, { code: "NOWHERE1" })).status, 400);
    await api("PUT", "/disposal/facilities", ids.kcca, { code: facilityCode, name: "E2E Nakawa transfer station", kind: "transfer_station", isActive: true });
    assert.ok(!(await api("GET", "/disposal/facilities", ids.operator)).body.data.some(f => f.code === "NOWHERE1"));
  });

  console.log("Trip disposal states");
  await step("each completed trip gets a state: verified, weighing, pending, declared or unverified", async () => {
    await completedTrip("verified", 1, 60);
    await completedTrip("missing", 2, 60);
    await completedTrip("recent", 3, 2);
    await completedTrip("declared", 4, 60);
    await completedTrip("weighing", 5, 60);
    let r = await ticket(1, { hours: 55, net: 6200 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.trip_id, trips.verified, "the weighbridge matches the trip by vehicle and date");
    assert.equal(r.body.data.facility, "Buyala Waste Management Facility");
    r = await ticket(5, { hours: 54, status: "open" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    r = await api("PATCH", `/trips/${trips.declared}/weighbridge`, ids.supervisor, { ticketNumber: "OWN-123", facility: "Kiteezi", verifiedWeightKg: 5000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await stateOf("verified"), "verified");
    assert.equal(await stateOf("missing"), "unverified");
    assert.equal(await stateOf("recent"), "pending");
    assert.equal(await stateOf("declared"), "declared");
    assert.equal(await stateOf("weighing"), "weighing");
    const s = await summary();
    assert.deepEqual([s.completed_trips, s.due_trips, s.exceptions, s.verification_rate, s.standing, s.verified_kg], [5, 3, 2, 33.3, "action", 6200]);
    assert.ok(s.facilities.some(f => f.code === "BUYALA" && f.net_kg === 6200));
  });
  await step("a company cannot overwrite a KCCA weighbridge weight with its own figures", async () => {
    const r = await api("PATCH", `/trips/${trips.verified}/weighbridge`, ids.admin, { ticketNumber: "OWN-999", facility: "Kiteezi", verifiedWeightKg: 9000 });
    assert.equal(r.status, 400);
    const [trip] = await sql("SELECT verified_weight_kg FROM collection_routes WHERE id=$1", [trips.verified]);
    assert.equal(Number(trip.verified_weight_kg), 6200);
  });

  console.log("Explanations");
  await step("the company explains a trip without a ticket; KCCA is told; invalid explanations are refused", async () => {
    const explain = (trip, body, user = ids.supervisor) => api("POST", `/disposal/trips/${trips[trip]}/explanation`, user, body);
    assert.equal((await explain("verified", { reason: "no_load", details: "Came back empty." })).status, 409);
    let r = await explain("missing", { reason: "combined_load", details: "Weighed together with another trip." });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /weighbridge ticket/);
    r = await explain("missing", { reason: "no_load", details: "Market was closed; the truck came back empty." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids.explanation = r.body.data.id;
    assert.equal((await explain("missing", { reason: "other", details: "Second try at the same time." })).status, 409);
    assert.equal(await stateOf("missing"), "explanation_review");
    const [note] = await sql("SELECT category,link FROM notifications WHERE recipient_user_id=$1 AND dedupe_key=$2", [ids.kcca, `disposal-explanation:${ids.explanation}`]);
    assert.deepEqual([note.category, note.link], ["disposal", "/dashboard/disposal-oversight"]);
  });
  await step("KCCA rejects with a reason, the company explains again, and KCCA accepts", async () => {
    assert.equal((await api("PATCH", `/disposal/explanations/${ids.explanation}/review`, ids.supervisor, { action: "accept" })).status, 403);
    assert.equal((await api("PATCH", `/disposal/explanations/${ids.explanation}/review`, ids.kcca, { action: "reject" })).status, 400, "a rejection needs a reason");
    let r = await api("PATCH", `/disposal/explanations/${ids.explanation}/review`, ids.kcca, { action: "reject", note: "GPS shows the truck at the market for two hours" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [note] = await sql("SELECT severity,body FROM notifications WHERE recipient_user_id=$1 AND dedupe_key=$2", [ids.admin, `disposal-review:${ids.explanation}`]);
    assert.equal(note.severity, "warning");
    assert.match(note.body, /GPS shows the truck/);
    assert.equal(await stateOf("missing"), "unverified");
    assert.equal((await api("PATCH", `/disposal/explanations/${ids.explanation}/review`, ids.kcca, { action: "accept" })).status, 409, "reviewed once");
    await assert.rejects(sql("UPDATE trip_disposal_explanations SET review_note='changed later' WHERE id=$1", [ids.explanation]), /cannot be changed/);
    r = await api("POST", `/disposal/trips/${trips.missing}/explanation`, ids.admin, { reason: "vehicle_breakdown", details: "Truck broke down at Kireka; load moved to the next day's trip." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const waiting = (await api("GET", `/disposal/explanations?organizationId=${ids.collector}`, ids.kcca)).body.data;
    assert.deepEqual(waiting.map(e => e.id), [r.body.data.id]);
    assert.equal((await api("PATCH", `/disposal/explanations/${r.body.data.id}/review`, ids.kcca, { action: "accept" })).status, 200);
    assert.equal(await stateOf("missing"), "explained");
    assert.equal((await summary()).verification_rate, 66.7);
  });

  console.log("Tickets without a trip");
  await step("an unlinked ticket is listed; the company links it to the right trip, not to one with another vehicle", async () => {
    let r = await ticket(6, { hours: 30, net: 4100 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.trip_id, null);
    ids.unlinked = r.body.data.id;
    let list = (await api("GET", "/disposal/tickets?period=30d&unlinked=1", ids.admin)).body.data;
    assert.deepEqual(list.map(t => t.id), [ids.unlinked]);
    assert.equal((await summary()).unlinked_tickets, 1);
    r = await api("PATCH", `/disposal/tickets/${ids.unlinked}/link`, ids.supervisor, { tripId: trips.declared });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /vehicle does not match/);
    await completedTrip("late-link", 6, 32);
    r = await api("PATCH", `/disposal/tickets/${ids.unlinked}/link`, ids.supervisor, { tripId: trips["late-link"] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await stateOf("late-link"), "verified");
    assert.equal((await api("PATCH", `/disposal/tickets/${ids.unlinked}/link`, ids.supervisor, { tripId: trips["late-link"] })).status, 409);
    list = (await api("GET", "/disposal/tickets?period=30d&unlinked=1", ids.admin)).body.data;
    assert.equal(list.length, 0);
  });
  await step("KCCA accepts a load that belongs to no trip; it can no longer be linked", async () => {
    let r = await ticket(7, { hours: 28, net: 2500, code: facilityCode });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const id = r.body.data.id;
    assert.ok((await api("GET", `/disposal/city/tickets?period=30d&unlinked=1&organizationId=${ids.collector}`, ids.kcca)).body.data.some(t => t.id === id));
    assert.equal((await api("PATCH", `/disposal/tickets/${id}/accept-without-trip`, ids.kcca, { reason: "no" })).status, 400);
    r = await api("PATCH", `/disposal/tickets/${id}/accept-without-trip`, ids.kcca, { reason: "Truck hired by Nakawa division for a market clean-up" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await api("PATCH", `/disposal/tickets/${id}/accept-without-trip`, ids.kcca, { reason: "Again, a second time" })).status, 409);
    assert.equal((await api("PATCH", `/disposal/tickets/${id}/link`, ids.admin, { tripId: trips.declared })).status, 409);
    assert.equal((await summary()).unlinked_tickets, 0);
  });

  console.log("Access and isolation");
  await step("companies see only their own disposal records; other organizations and roles are refused", async () => {
    const other = await summary(ids.otherAdmin);
    assert.equal(other.completed_trips, 0);
    assert.equal((await tripsIn(null, ids.otherAdmin)).length, 0);
    assert.equal((await api("POST", `/disposal/trips/${trips.declared}/explanation`, ids.otherAdmin, { reason: "no_load", details: "Not our trip at all." })).status, 404);
    assert.equal((await api("PATCH", `/disposal/tickets/${ids.unlinked}/link`, ids.otherAdmin, { tripId: trips.declared })).status, 404);
    assert.equal((await api("GET", "/disposal/summary", ids.recyclerAdmin)).status, 403);
    assert.equal((await api("GET", "/disposal/city", ids.admin)).status, 403);
    assert.equal((await api("GET", "/disposal/summary")).status, 401);
    assert.equal((await api("GET", "/disposal/trips?state=lost", ids.admin)).status, 400);
  });

  console.log("KCCA overview and notices");
  await step("KCCA sees the company's rate, standing and exceptions, and the city totals", async () => {
    const r = await api("GET", "/disposal/city?period=30d", ids.kcca);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const company = r.body.data.companies.find(c => c.id === ids.collector);
    assert.deepEqual([company.completed_trips, company.due_trips, company.verification_rate, company.standing, company.exceptions], [6, 4, 75, "action", 1]);
    assert.ok(company.permit_number);
    assert.ok(r.body.data.city.completed_trips >= 6);
    assert.ok(r.body.data.facilities.some(f => f.code === facilityCode && f.net_kg === 2500));
    const exceptions = (await api("GET", `/disposal/city/trips?period=30d&state=exceptions&organizationId=${ids.collector}`, ids.kcca)).body.data;
    assert.deepEqual(exceptions.map(t => t.state), ["declared"]);
  });
  await step("the daily check tells the company once a day what needs attention; disposal notices can be switched off by email", async () => {
    await api("POST", "/notifications/run-checks", ids.system);
    await api("POST", "/notifications/run-checks", ids.system);
    const notes = await sql("SELECT title,body,severity FROM notifications WHERE recipient_user_id=$1 AND category='disposal' AND dedupe_key LIKE 'disposal-gaps:%'", [ids.supervisor]);
    assert.equal(notes.length, 1);
    assert.match(notes[0].body, /1 completed trip without a KCCA weighbridge ticket/);
    const r = await api("PUT", "/notifications/preferences", ids.admin, { categories: [{ category: "disposal", email: false, sms: false }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.categories.find(c => c.category === "disposal").email, false);
  });
}

// E2E_KEEP=1 leaves the fixtures for a manual look; E2E_CLEANUP_TAG=<tag> E2E_CLEANUP_ONLY=1 removes them later.
(process.env.E2E_CLEANUP_ONLY ? Promise.resolve(console.log(`Cleaning up ${tag}`)) : run().then(() => console.log(`\nAll ${passed} checks passed.`)))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => {
    if (process.env.E2E_KEEP) console.log(`Fixtures kept (${tag}). Remove with: E2E_CLEANUP_TAG=${tag} E2E_CLEANUP_ONLY=1 node scripts/e2e-disposal-verification.cjs`);
    else await cleanup().catch(e => console.error("Cleanup failed", e));
    await pool.end();
  });
