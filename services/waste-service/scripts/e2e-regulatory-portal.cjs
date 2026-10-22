// End-to-end check of Module 3 (company regulatory portal and monthly statutory returns) against a running
// waste-service and a local database with migrations 092–094 applied. Assumes RETURNS_FIRST_PERIOD is the default (2026-09)
// and today is in October 2026 or later. Creates its own fixtures and removes or deactivates them afterwards.
//
//   PORT=8193 PERMIT_LIFECYCLE_SCHEDULER=off npm run dev      (in one terminal)
//   E2E_BASE_URL=http://localhost:8193 npm run test:e2e:portal
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-portal-${Date.now()}`;
const PERIOD = "2026-09";
const ids = {};
let passed = 0;

const sql = async (text, params = []) => (await pool.query(text, params)).rows;
const token = userId => jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
async function api(method, url, user, body) {
  const response = await fetch(`${BASE}/api/waste${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get("content-type") || "";
  return { status: response.status, type, body: type.includes("json") ? await response.json() : await response.text() };
}
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const collectorFigures = overrides => ({
  customers_served: 0, trips_completed: 1, collections_completed: 0, collections_missed: 0, waste_disposed_kg: 9000,
  disposal_site: "Kiteezi landfill", vehicles_operated: 1, staff_employed: 2, complaints_received: 0, complaints_resolved: 0, ...overrides,
});
const declare = (figures, extra = {}) => ({ declarantName: "Grace Atim", declarantTitle: "Operations Director", figures, confirm: true, ...extra });

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  const org = async (name, type) => (await sql("INSERT INTO organizations(name,type,is_active,created_at) VALUES($1,$2,true,'2026-08-01') RETURNING id", [`${name} ${tag}`, type]))[0].id;
  ids.collector = await org("E2E Portal Collectors", "waste_collection_company");
  ids.recycler = await org("E2E Portal Recyclers", "recycling_company");
  ids.newcomer = (await sql("INSERT INTO organizations(name,type,is_active) VALUES($1,'waste_collection_company',true) RETURNING id", [`E2E Newcomer ${tag}`]))[0].id;
  const user = async (name, roleName, organizationId) => {
    const id = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES($1,$2,'not-a-login','active',$3) RETURNING id",
      [name, `${tag}-${roleName}-${Math.random().toString(36).slice(2, 7)}@example.test`, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role(roleName)]);
    if (organizationId) await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  ids.kcca = await user("E2E KCCA Officer", "kcca_admin", null);
  ids.admin = await user("E2E Collector Admin", "company_admin", ids.collector);
  ids.supervisor = await user("E2E Collector Supervisor", "supervisor", ids.collector);
  ids.recyclerAdmin = await user("E2E Recycler Admin", "company_admin", ids.recycler);
  ids.newcomerAdmin = await user("E2E Newcomer Admin", "company_admin", ids.newcomer);
  // What the platform recorded in September 2026
  await sql("INSERT INTO collection_routes(organization_id,name,route_date,status) VALUES($1,'E2E September trip','2026-09-10','completed')", [ids.collector]);
  await sql(`INSERT INTO weighbridge_transactions(organization_id,ticket_number,facility,registration,normalized_registration,operation_date,arrival_at,gross_kg,tare_kg,net_kg,status)
    VALUES($1,$2,'Kiteezi','UBB 002E','UBB002E','2026-09-10','2026-09-10 10:00+03',22000,10000,12000,'completed')`, [ids.collector, `${tag}-T1`]);
  await sql(`INSERT INTO recycling_material_lots(organization_id,material_type,source_name,quantity_kg,available_kg,collected_on,quality,created_by,origin)
    VALUES($1,'PET','E2E supplier',500,500,'2026-09-05','sorted',$2,'purchase')`, [ids.recycler, ids.recyclerAdmin]);
}

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map(r => r.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  await sql("DELETE FROM regulatory_returns WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM collection_routes WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM weighbridge_transactions WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM recycling_material_lots WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  // Compliance cases and organization audit events are immutable by design, so the organizations are deactivated.
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

async function run() {
  await setup();
  let returnId;

  console.log("Portal and owed months");
  await step("the portal shows permit, compliance, notices and the overdue September return", async () => {
    const r = await api("GET", "/regulatory/portal", ids.supervisor);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body.data;
    assert.equal(d.permit, null);
    assert.equal(d.returns.overdue, 1);
    assert.deepEqual(d.returns.outstanding.map(p => [p.period, p.state]), [[PERIOD, "overdue"]]);
  });
  await step("a company that joined this month owes nothing yet", async () => {
    const r = await api("GET", "/regulatory/returns", ids.newcomerAdmin);
    assert.deepEqual(r.body.data.periods, []);
  });
  await step("only completed, required months can be prepared", async () => {
    const current = (await sql("SELECT to_char(CURRENT_DATE,'YYYY-MM') AS p"))[0].p;
    assert.equal((await api("GET", `/regulatory/returns/prefill?period=${current}`, ids.admin)).status, 400);
    assert.equal((await api("GET", "/regulatory/returns/prefill?period=2026-08", ids.admin)).status, 400);
  });
  await step("prefill shows what the platform recorded for the month", async () => {
    const r = await api("GET", `/regulatory/returns/prefill?period=${PERIOD}`, ids.admin);
    assert.equal(r.status, 200);
    const recorded = r.body.data.recorded;
    assert.equal(recorded.trips_completed, 1);
    assert.equal(recorded.waste_disposed_kg, 12000);
    assert.equal(recorded.staff_employed, 2);
    assert.equal(r.body.data.due_on, "2026-10-15");
  });

  console.log("Filing a return");
  await step("supervisors cannot file; KCCA cannot file for a company", async () => {
    assert.equal((await api("POST", "/regulatory/returns", ids.supervisor, declare(collectorFigures(), { period: PERIOD }))).status, 403);
    assert.equal((await api("POST", "/regulatory/returns", ids.kcca, declare(collectorFigures(), { period: PERIOD }))).status, 403);
  });
  await step("the declaration must be confirmed and the figures complete", async () => {
    assert.equal((await api("POST", "/regulatory/returns", ids.admin, declare(collectorFigures(), { period: PERIOD, confirm: false }))).status, 400);
    const r = await api("POST", "/regulatory/returns", ids.admin, declare(collectorFigures({ disposal_site: "" }), { period: PERIOD }));
    assert.equal(r.status, 400);
    assert.match(r.body.message, /disposal_site/);
    assert.equal((await api("POST", "/regulatory/returns", ids.admin, declare(collectorFigures({ trips_completed: -1 }), { period: PERIOD }))).status, 400);
  });
  await step("a late return is accepted, marked late, and its differences from platform records are kept", async () => {
    const r = await api("POST", "/regulatory/returns", ids.admin, declare(collectorFigures(), { period: PERIOD }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    returnId = r.body.data.id;
    assert.equal(r.body.data.submitted_late, true);
    assert.deepEqual(r.body.data.variances, [{ field: "waste_disposed_kg", declared: 9000, recorded: 12000, difference: -3000 }]);
    assert.equal((await api("POST", "/regulatory/returns", ids.admin, declare(collectorFigures(), { period: PERIOD }))).status, 409);
  });

  console.log("KCCA review");
  await step("the register lists who filed, who is overdue, and differences", async () => {
    const r = await api("GET", `/regulatory/returns-register?period=${PERIOD}`, ids.kcca);
    assert.equal(r.status, 200);
    const mine = r.body.data.companies.find(c => c.organization_id === ids.collector);
    const recycler = r.body.data.companies.find(c => c.organization_id === ids.recycler);
    assert.deepEqual([mine.state, mine.submitted_late, mine.variance_count], ["submitted", true, 1]);
    assert.equal(recycler.state, "overdue");
    assert.ok(!r.body.data.companies.some(c => c.organization_id === ids.newcomer), "not required for September");
    assert.equal((await api("GET", "/regulatory/returns-register", ids.admin)).status, 403);
  });
  await step("KCCA queries the return; the company sees it and corrects it", async () => {
    let r = await api("PATCH", `/regulatory/returns-register/${returnId}`, ids.kcca, { action: "query", notes: "Disposal is 3,000 kg below weighbridge tickets. Check and correct." });
    assert.equal(r.status, 200);
    r = await api("GET", "/regulatory/portal", ids.admin);
    assert.equal(r.body.data.returns.queried, 1);
    assert.equal((await api("PUT", `/regulatory/returns/${returnId}`, ids.supervisor, declare(collectorFigures({ waste_disposed_kg: 12000 })))).status, 403);
    r = await api("PUT", `/regulatory/returns/${returnId}`, ids.admin, declare(collectorFigures({ waste_disposed_kg: 12000 })));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.data.version, r.body.data.status, r.body.data.variances], [2, "submitted", []]);
  });
  await step("KCCA accepts; an accepted return is final", async () => {
    let r = await api("PATCH", `/regulatory/returns-register/${returnId}`, ids.kcca, { action: "accept", notes: "Figures agree with records" });
    assert.equal(r.status, 200);
    assert.equal((await api("PATCH", `/regulatory/returns-register/${returnId}`, ids.kcca, { action: "query", notes: "Again" })).status, 409);
    assert.equal((await api("PUT", `/regulatory/returns/${returnId}`, ids.admin, declare(collectorFigures()))).status, 409);
    await assert.rejects(sql("UPDATE regulatory_returns SET figures='{}' WHERE id=$1", [returnId]), /accepted return cannot be changed/);
  });
  await step("the full history is kept and cannot be altered", async () => {
    const r = await api("GET", `/regulatory/returns-register/${returnId}`, ids.kcca);
    assert.deepEqual(r.body.data.history.map(h => [h.version, h.action]), [[1, "submitted"], [1, "queried"], [2, "resubmitted"], [2, "accepted"]]);
    await assert.rejects(sql("DELETE FROM regulatory_return_history WHERE return_id=$1", [returnId]), /cannot be changed/);
    assert.equal((await api("GET", `/regulatory/returns/${returnId}`, ids.recyclerAdmin)).status, 404, "other companies cannot read it");
  });
  await step("the register exports to CSV", async () => {
    const r = await api("GET", `/regulatory/returns-register/export.csv?period=${PERIOD}`, ids.kcca);
    assert.match(r.type, /text\/csv/);
    const line = r.body.split("\r\n").find(l => l.includes(`E2E Portal Collectors ${tag}`));
    assert.match(line, /,2026-09,accepted,RET-202609-\d+,2,\d{4}-\d{2}-\d{2},yes,0$/);
  });

  console.log("Recycling company return");
  await step("recyclers get material figures and must explain residue disposal", async () => {
    let r = await api("GET", `/regulatory/returns/prefill?period=${PERIOD}`, ids.recyclerAdmin);
    assert.equal(r.body.data.organization_type, "recycling_company");
    assert.equal(r.body.data.recorded.plastic_collected_kg, 500);
    const figures = { materials: [{ category: "plastic", collectedKg: 500, soldKg: 0 }], residue_kg: 40, staff_employed: 1 };
    r = await api("POST", "/regulatory/returns", ids.recyclerAdmin, declare(figures, { period: PERIOD }));
    assert.equal(r.status, 400);
    assert.match(r.body.message, /residue/);
    r = await api("POST", "/regulatory/returns", ids.recyclerAdmin, declare({ ...figures, residue_disposal: "Collected by licensed hauler to Kiteezi" }, { period: PERIOD }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.data.variances, [], "plastic matches records; residue was not recorded, so it is not compared");
  });

  console.log("Free regulatory access");
  await step("compliance cases open even when the company's package excludes them", async () => {
    await sql("UPDATE organizations SET platform_package_id=(SELECT id FROM platform_packages WHERE code='collector_standard') WHERE id=$1", [ids.collector]);
    assert.equal((await api("GET", "/compliance/organization", ids.admin)).status, 200);
    assert.equal((await api("GET", "/billing/plans", ids.admin)).status, 403, "paid SaaS features stay behind the package");
    const r = await api("POST", "/compliance/city", ids.kcca, {
      organizationId: ids.recycler, category: "statutory_returns", severity: "advisory", title: "Monthly return outstanding",
      details: "The September 2026 return was due on 15 October 2026.", requiredAction: "Submit the return in the regulatory portal.", dueDate: "2026-12-31",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  });
}

(process.env.E2E_CLEANUP_ONLY ? Promise.resolve(console.log(`Cleaning up ${tag}`)) : run().then(() => console.log(`\nAll ${passed} checks passed.`)))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => {
    if (process.env.E2E_KEEP) console.log(`Fixtures kept. Remove with: E2E_CLEANUP_TAG=${tag} E2E_CLEANUP_ONLY=1 node scripts/e2e-regulatory-portal.cjs`);
    else await cleanup().catch(e => console.error("Cleanup failed", e));
    await pool.end();
  });
