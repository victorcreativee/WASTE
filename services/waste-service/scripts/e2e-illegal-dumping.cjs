// End-to-end check of Module 9 (illegal dumping enforcement) against a running waste-service and the local database with
// migrations 092–100 applied. Creates its own fixtures and removes or deactivates them afterwards.
//
//   E2E_BASE_URL=http://localhost:8193 npm run test:e2e:dumping
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-dumping-${Date.now()}`;
const PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const ids = {};
let passed = 0;
// A random spot in central Kampala for each run, so runs never merge with each other's sites.
const base = { lat: 0.30 + Math.random() * 0.06, lng: 32.55 + Math.random() * 0.06 };
const near = (metresNorth, metresEast = 0) => ({ latitude: base.lat + metresNorth / 111320, longitude: base.lng + metresEast / 111320 });

const sql = async (text, params = []) => (await pool.query(text, params)).rows;
const token = userId => jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
async function api(method, url, user, body) {
  const response = await fetch(`${BASE}/api/waste${url}`, {
    method, headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get("content-type") || "";
  return { status: response.status, type, body: type.includes("json") ? await response.json() : null };
}
async function step(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const site = id => api("GET", `/dumping/sites/${id}`, ids.kcca).then(r => r.body.data);
const issueStatus = async id => (await sql("SELECT status FROM citizen_issues WHERE id=$1", [id]))[0].status;
const noteFor = (user, key) => sql("SELECT category,severity,title,body FROM notifications WHERE recipient_user_id=$1 AND dedupe_key=$2", [user, key]);

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  const org = async name => (await sql(
    `INSERT INTO organizations(name,type,is_active,created_at,platform_package_id) VALUES($1,'waste_collection_company',true,'2026-08-01',(SELECT id FROM platform_packages WHERE code='collector_professional')) RETURNING id`,
    [`${name} ${tag}`]))[0].id;
  ids.collector = await org("E2E Cleanup Collectors");
  ids.other = await org("E2E Careless Haulers");
  const user = async (name, roleName, organizationId) => {
    const id = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES($1,$2,'not-a-login','active',$3) RETURNING id",
      [name, `${tag}-${roleName}-${Math.random().toString(36).slice(2, 7)}@example.test`, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role(roleName)]);
    if (organizationId) await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  ids.kcca = await user("E2E KCCA Enforcement Officer", "kcca_admin", null);
  ids.system = await user("E2E System Admin", "system_admin", null);
  ids.resident = await user("E2E Resident", "citizen", null);
  ids.neighbour = await user("E2E Neighbour", "citizen", null);
  ids.admin = await user("E2E Cleanup Admin", "company_admin", ids.collector);
  ids.supervisor = await user("E2E Cleanup Supervisor", "supervisor", ids.collector);
  ids.otherAdmin = await user("E2E Haulers Admin", "company_admin", ids.other);
  ids.today = (await sql("SELECT CURRENT_DATE::text AS d"))[0].d;
  ids.division = (await sql("SELECT id FROM kampala_divisions WHERE is_active ORDER BY name LIMIT 1"))[0].id;
}

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map(r => r.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  const sites = (await sql(
    `SELECT DISTINCT s.id::text FROM dumping_sites s LEFT JOIN dumping_reports r ON r.site_id=s.id
     WHERE r.reporter_user_id=ANY($1::uuid[]) OR s.responsible_organization_id=ANY($2::uuid[]) OR s.cleanup_organization_id=ANY($2::uuid[])`, [users, orgs])).map(r => r.id);
  // KCCA-wide notices about these sites reach every KCCA officer, so they are removed by the site in their key.
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[]) OR organization_id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM unnest($3::text[]) AS s(id) WHERE dedupe_key LIKE '%'||s.id||'%')", [users, orgs, sites]);
  await sql("DELETE FROM dumping_sites WHERE id=ANY($1::uuid[])", [sites]);
  await sql("DELETE FROM citizen_issues WHERE reporter_user_id=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM notification_preferences WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  // Organization audit events are immutable by design, so the organizations are deactivated.
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

async function run() {
  await setup();
  const t = ids.today;

  console.log("Reporting");
  await step("a resident's illegal-dumping issue with a location becomes a dumping site; KCCA is told", async () => {
    const r = await api("POST", "/citizen-issues", ids.resident, {
      category: "illegal_dumping", title: "Rubbish dumped by the drainage channel", description: "Bags of household rubbish and building rubble dumped overnight.",
      address: "Behind Nakawa market, near the footbridge", ...near(0), divisionId: ids.division, photo: PHOTO,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.dumping_site.outcome, "new_site");
    ids.issue = r.body.data.id;
    ids.site = (await sql("SELECT site_id FROM dumping_reports WHERE citizen_issue_id=$1", [ids.issue]))[0].site_id;
    const [note] = await noteFor(ids.kcca, `dumping-site:${ids.site}`);
    assert.equal(note.category, "dumping");
    assert.match(note.title, /Behind Nakawa market/);
    const plain = await api("POST", "/citizen-issues", ids.resident, { category: "illegal_dumping", title: "Dumping somewhere", description: "I could not share my location this time." });
    assert.equal(plain.status, 201);
    assert.equal(plain.body.data.dumping_site, null, "no location, no site");
  });
  await step("a report within 75 m joins the same site; one outside Kampala is refused", async () => {
    let r = await api("POST", "/dumping/reports", ids.supervisor, { ...near(30, 20), description: "Our crew saw fresh dumping here this morning.", photo: PHOTO });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.data.outcome, r.body.data.site_id], ["additional_report", ids.site]);
    r = await api("POST", "/dumping/reports", ids.supervisor, { latitude: -1.29, longitude: 36.82, description: "Somewhere far away from Kampala." });
    assert.equal(r.status, 400);
    const s = await site(ids.site);
    assert.deepEqual([s.status, s.report_count, s.photo_count, s.division_id], ["reported", 2, 2, ids.division]);
  });
  await step("residents and companies see only sites they are part of; photos follow the same rule", async () => {
    assert.equal((await api("GET", `/dumping/sites/${ids.site}`, ids.resident)).status, 200);
    assert.equal((await api("GET", `/dumping/sites/${ids.site}`, ids.neighbour)).status, 404);
    assert.equal((await api("GET", `/dumping/sites/${ids.site}`, ids.admin)).status, 200, "the collector reported it");
    assert.equal((await api("GET", `/dumping/sites/${ids.site}`, ids.otherAdmin)).status, 404);
    assert.equal((await api("GET", "/dumping/sites", ids.resident)).status, 403);
    const detail = (await api("GET", `/dumping/sites/${ids.site}`, ids.admin)).body.data;
    assert.ok(detail.reports.every(rep => rep.source !== "resident" || rep.reporter_name === null), "companies do not see residents' names");
    const photo = await api("GET", `/dumping/photos/${detail.photos[0].id}`, ids.resident);
    assert.deepEqual([photo.status, photo.type], [200, "image/png"]);
    assert.equal((await api("GET", `/dumping/photos/${detail.photos[0].id}`, ids.otherAdmin)).status, 404);
    const mine = (await api("GET", "/dumping/my-reports", ids.resident)).body.data;
    assert.ok(mine.some(rep => rep.site_id === ids.site));
  });

  console.log("Inspection and responsibility");
  await step("only KCCA verifies, before any cleanup order; the resident's issue moves to triaged", async () => {
    assert.equal((await api("PATCH", `/dumping/sites/${ids.site}/verify`, ids.supervisor, { size: "medium", wasteTypes: ["household"], note: "Seen it" })).status, 403);
    assert.equal((await api("PATCH", `/dumping/sites/${ids.site}/order-cleanup`, ids.kcca, { organizationId: ids.collector })).status, 409);
    const r = await api("PATCH", `/dumping/sites/${ids.site}/verify`, ids.kcca, { size: "medium", wasteTypes: ["household", "construction"], note: "About three cubic metres of household waste and rubble.", photo: PHOTO });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await issueStatus(ids.issue), "triaged");
  });
  await step("KCCA holds a company responsible only with evidence; the company is told and can see the site", async () => {
    let r = await api("PATCH", `/dumping/sites/${ids.site}/responsibility`, ids.kcca, { organizationId: ids.other, basis: "truck" });
    assert.equal(r.status, 400);
    r = await api("PATCH", `/dumping/sites/${ids.site}/responsibility`, ids.kcca, { organizationId: ids.other, basis: "Resident photo shows a truck with the company's livery offloading at 06:10." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [note] = await noteFor(ids.otherAdmin, `dumping-responsible:${ids.site}:${ids.other}`);
    assert.equal(note.severity, "warning");
    assert.equal((await api("GET", `/dumping/sites/${ids.site}`, ids.otherAdmin)).status, 200);
    const attributed = (await api("GET", "/dumping/company/sites?kind=attributed", ids.otherAdmin)).body.data;
    assert.deepEqual(attributed.map(s => s.id), [ids.site]);
  });

  console.log("Cleanup");
  await step("KCCA orders a cleanup within the time allowed for the size; the collector is told", async () => {
    assert.equal((await api("PATCH", `/dumping/sites/${ids.site}/order-cleanup`, ids.kcca, { organizationId: ids.collector, dueOn: addDays(t, 6) })).status, 400);
    const r = await api("PATCH", `/dumping/sites/${ids.site}/order-cleanup`, ids.kcca, { organizationId: ids.collector, note: "Separate the rubble." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.cleanup_due_on, addDays(t, 5));
    const [note] = await noteFor(ids.supervisor, `dumping-order:${ids.site}:${addDays(t, 5)}:${ids.collector}`);
    assert.equal(note.severity, "warning");
    assert.equal(await issueStatus(ids.issue), "in_progress");
    const orders = (await api("GET", "/dumping/company/sites", ids.supervisor)).body.data;
    assert.deepEqual(orders.map(s => s.id), [ids.site]);
  });
  await step("only the ordered company reports the cleanup, with a photo; KCCA sends it back once, then confirms", async () => {
    assert.equal((await api("PATCH", `/dumping/sites/${ids.site}/cleanup-report`, ids.otherAdmin, { note: "Done", photo: PHOTO })).status, 403);
    assert.equal((await api("PATCH", `/dumping/sites/${ids.site}/cleanup-report`, ids.supervisor, { note: "Done" })).status, 400, "photo required");
    assert.equal((await api("PATCH", `/dumping/sites/${ids.site}/confirm`, ids.kcca, { note: "Looks fine" })).status, 409, "the company reports first");
    let r = await api("PATCH", `/dumping/sites/${ids.site}/cleanup-report`, ids.supervisor, { note: "Cleared with one tipper trip.", photo: PHOTO });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await api("PATCH", `/dumping/sites/${ids.site}/reject-cleanup`, ids.kcca, { reason: "Rubble is still in the channel." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rejected = await sql("SELECT severity FROM notifications WHERE recipient_user_id=$1 AND dedupe_key LIKE $2", [ids.supervisor, `dumping-rejected:${ids.site}:%`]);
    assert.equal(rejected[0].severity, "warning");
    await api("PATCH", `/dumping/sites/${ids.site}/cleanup-report`, ids.supervisor, { note: "Rubble removed from the channel.", photo: PHOTO });
    r = await api("PATCH", `/dumping/sites/${ids.site}/confirm`, ids.kcca, { note: "Inspected: channel and verge clear.", photo: PHOTO });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await issueStatus(ids.issue), "resolved");
    const [thanks] = await noteFor(ids.resident, `dumping-cleared-reporter:${ids.site}:0`);
    assert.equal(thanks.category, "dumping");
    const s = await site(ids.site);
    assert.deepEqual(s.history.map(h => h.action), ["reported", "additional_report", "verified", "responsibility_set", "cleanup_ordered", "cleanup_reported", "cleanup_rejected", "cleanup_reported", "cleared"]);
    await assert.rejects(sql("UPDATE dumping_site_history SET note='edited' WHERE site_id=$1", [ids.site]), /cannot be changed/);
    await assert.rejects(sql("UPDATE dumping_sites SET status='verified' WHERE id=$1", [ids.site]), /cannot become verified/);
  });
  await step("dumping at the same place after clearance brings the site back and makes it a hotspot", async () => {
    const r = await api("POST", "/dumping/reports", ids.neighbour, { ...near(-20, 10), description: "They are dumping here again." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.data.outcome, r.body.data.site_id, r.body.data.status], ["recurred", ids.site, "reported"]);
    const s = await site(ids.site);
    assert.deepEqual([s.recurrence_count, s.hotspot, s.cleanup_organization_id], [1, true, null]);
    assert.equal((await noteFor(ids.kcca, `dumping-recurred:${ids.site}:1`))[0].severity, "warning");
  });

  console.log("Other paths");
  await step("hazardous waste gets two days; a KCCA crew cleanup is confirmed by KCCA directly", async () => {
    let r = await api("POST", "/dumping/reports", ids.kcca, { ...near(600, 600), landmark: "Kinawataka road verge", divisionId: ids.division, description: "Drums of used oil left on the verge." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const id = r.body.data.site_id;
    await api("PATCH", `/dumping/sites/${id}/verify`, ids.kcca, { size: "large", wasteTypes: ["hazardous"], note: "Six drums of used engine oil." });
    assert.equal((await site(id)).hazardous, true);
    assert.equal((await api("PATCH", `/dumping/sites/${id}/order-cleanup`, ids.kcca, { organizationId: null, dueOn: addDays(t, 3) })).status, 400);
    r = await api("PATCH", `/dumping/sites/${id}/order-cleanup`, ids.kcca, { organizationId: null });
    assert.equal(r.body.data.cleanup_due_on, addDays(t, 2));
    assert.equal((await api("PATCH", `/dumping/sites/${id}/confirm`, ids.kcca, { note: "KCCA hazardous team removed the drums." })).status, 200);
  });
  await step("KCCA closes a false report with a reason; a closed report stays closed", async () => {
    let r = await api("POST", "/dumping/reports", ids.admin, { ...near(1200, -300), divisionId: ids.division, description: "Pile of soil next to a building site." });
    const id = r.body.data.site_id;
    assert.equal((await api("PATCH", `/dumping/sites/${id}/dismiss`, ids.kcca, { reason: "no" })).status, 400);
    r = await api("PATCH", `/dumping/sites/${id}/dismiss`, ids.kcca, { reason: "Soil stockpiled by a licensed contractor with a permit." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await api("PATCH", `/dumping/sites/${id}/dismiss`, ids.kcca, { reason: "Closing it a second time." })).status, 409);
    r = await api("POST", "/dumping/reports", ids.admin, { ...near(1205, -300), divisionId: ids.division, description: "Same pile, reported again later." });
    assert.equal(r.body.data.outcome, "new_site", "a dismissed site is never reopened");
    ids.fourth = r.body.data.site_id;
  });
  await step("an overdue cleanup is flagged to the company and KCCA once; KCCA sees it in the overview", async () => {
    await api("PATCH", `/dumping/sites/${ids.fourth}/verify`, ids.kcca, { size: "small", wasteTypes: ["construction"], note: "Second pile appeared, unrelated to the contractor." });
    await api("PATCH", `/dumping/sites/${ids.fourth}/order-cleanup`, ids.kcca, { organizationId: ids.collector });
    await sql("UPDATE dumping_sites SET cleanup_due_on=CURRENT_DATE-1 WHERE id=$1", [ids.fourth]);
    await api("POST", "/notifications/run-checks", ids.system);
    await api("POST", "/notifications/run-checks", ids.system);
    const key = `dumping-overdue:${ids.fourth}:${addDays(t, -1)}`;
    assert.equal((await noteFor(ids.supervisor, key)).length, 1);
    assert.equal((await noteFor(ids.kcca, key)).length, 1);
    const overdue = (await api("GET", "/dumping/sites?status=overdue", ids.kcca)).body.data;
    assert.ok(overdue.some(s => s.id === ids.fourth && s.overdue));
    const o = (await api("GET", "/dumping/overview?period=30d", ids.kcca)).body.data;
    assert.ok(o.totals.overdue >= 1 && o.totals.hotspots >= 1 && o.totals.cleared >= 1);
    const cleaner = o.companies.find(c => c.id === ids.collector), careless = o.companies.find(c => c.id === ids.other);
    assert.deepEqual([cleaner.open_orders, cleaner.overdue_orders, careless.attributed_recent], [1, 1, 1]);
    assert.ok(o.sites.some(s => s.id === ids.site && s.hotspot));
    assert.equal((await api("GET", "/dumping/company/overview", ids.admin)).body.data.overdue_orders, 1);
    assert.equal((await api("GET", "/dumping/overview", ids.admin)).status, 403);
  });
}

// E2E_KEEP=1 leaves the fixtures for a manual look; E2E_CLEANUP_TAG=<tag> E2E_CLEANUP_ONLY=1 removes them later.
(process.env.E2E_CLEANUP_ONLY ? Promise.resolve(console.log(`Cleaning up ${tag}`)) : run().then(() => console.log(`\nAll ${passed} checks passed.`)))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => {
    if (process.env.E2E_KEEP) console.log(`Fixtures kept (${tag}). Remove with: E2E_CLEANUP_TAG=${tag} E2E_CLEANUP_ONLY=1 node scripts/e2e-illegal-dumping.cjs`);
    else await cleanup().catch(e => console.error("Cleanup failed", e));
    await pool.end();
  });
