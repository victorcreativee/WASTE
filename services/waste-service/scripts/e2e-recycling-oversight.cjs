// End-to-end check of Module 2 (KCCA recycling oversight and recycling licensing) against a running waste-service and
// a local database with migrations 092 and 093 applied. Creates its own fixtures and removes or deactivates them afterwards.
//
//   PORT=8193 PERMIT_LIFECYCLE_SCHEDULER=off npm run dev      (in one terminal)
//   E2E_BASE_URL=http://localhost:8193 npm run test:e2e:recycling
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-recycle-${Date.now()}`;
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
  return { status: response.status, type, headers: response.headers, body: type.includes("json") ? await response.json() : await response.text() };
}
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const recycler = overview => overview.recyclers.find(row => row.id === ids.recycler);

async function attempt(text, params) {
  try { await pool.query(text, params); return null; } catch (error) { return error.message; }
}
const purchase = (material, kg, daysAgo) => attempt(
  `INSERT INTO recycling_material_lots(organization_id,material_type,source_name,quantity_kg,available_kg,collected_on,quality,created_by,origin)
   VALUES($1,$2,'E2E supplier',$3,$3,CURRENT_DATE-$4::int,'sorted',$5,'purchase')`, [ids.recycler, material, kg, daysAgo, ids.recyclerAdmin]);
async function lotId(material) {
  return (await sql("SELECT id FROM recycling_material_lots WHERE organization_id=$1 AND material_type=$2 AND origin='purchase' ORDER BY created_at LIMIT 1", [ids.recycler, material]))[0].id;
}
const sale = async (material, kg, daysAgo) => attempt(
  `INSERT INTO recycling_material_sales(organization_id,lot_id,buyer_name,industry,quantity_kg,unit_price_ugx,sold_on,recorded_by)
   VALUES($1,$2,'E2E Industries','plastic manufacturing',$3,900,CURRENT_DATE-$4::int,$5)`, [ids.recycler, await lotId(material), kg, daysAgo, ids.recyclerAdmin]);

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  const org = async (name, type) => (await sql("INSERT INTO organizations(name,type,is_active) VALUES($1,$2,true) RETURNING id", [`${name} ${tag}`, type]))[0].id;
  ids.recycler = await org("E2E Recyclers", "recycling_company");
  ids.collector = await org("E2E Legacy Collector", "waste_collection_company");
  const user = async (name, roleName, organizationId) => {
    const id = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES($1,$2,'not-a-login','active',$3) RETURNING id",
      [name, `${tag}-${roleName}-${Math.random().toString(36).slice(2, 7)}@example.test`, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role(roleName)]);
    if (organizationId) await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  ids.kcca = await user("E2E KCCA Officer", "kcca_admin", null);
  ids.system = await user("E2E System Admin", "system_admin", null);
  ids.recyclerAdmin = await user("E2E Recycler Admin", "company_admin", ids.recycler);
  ids.today = (await sql("SELECT CURRENT_DATE::text AS d"))[0].d;
}

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map(r => r.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  await sql("DELETE FROM recycling_daily_closures WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM recycling_material_sales WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM recycling_sorting_batches WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM recycling_material_lots WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM weighbridge_transactions WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_division_authorizations WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_permit_applications WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  // Compliance cases and organization audit events are immutable by design, so the organizations are deactivated, not deleted.
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

async function run() {
  await setup();
  const { today } = ids;
  const baseline = (await api("GET", "/recycling-oversight", ids.kcca)).body.data.totals;

  console.log("Access");
  await step("only KCCA and system administrators can open recycling oversight", async () => {
    assert.equal((await api("GET", "/recycling-oversight")).status, 401);
    assert.equal((await api("GET", "/recycling-oversight", ids.recyclerAdmin)).status, 403);
    assert.equal((await api("GET", "/recycling-oversight", ids.system)).status, 200);
  });

  console.log("Licensing recycling companies");
  await step("a recycler with no permit on record is not blocked, but is flagged for action", async () => {
    assert.equal(await purchase("PET", 1000, 5), null);
    const row = recycler((await api("GET", "/recycling-oversight", ids.kcca)).body.data);
    assert.equal(row.standing, "action");
    assert.equal(row.flags[0].code, "no_permit");
    const overview = (await api("GET", "/regulatory/permit-lifecycle/overview", ids.kcca)).body.data;
    assert.ok(overview.no_permit_on_record.some(o => o.id === ids.recycler && o.type === "recycling_company"));
  });
  const issue = (orgId, activityCodes, user = ids.kcca) => api("POST", `/regulatory/organizations/${orgId}/permits`, user, {
    registrationNumber: `E2E-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, contactName: "Esther Nakato", email: "esther@example.test",
    phone: "+256700000001", address: "Plot 9, Nakawa", serviceDescription: "Buying, sorting and selling recyclable plastics and paper.",
    validUntil: addDays(today, 300), activityCodes, notes: "Inspection completed",
  });
  await step("activities must match the organization type, and only KCCA admins may issue", async () => {
    assert.equal((await issue(ids.recycler, ["household_collection"])).status, 400);
    assert.equal((await issue(ids.recycler, ["recyclables_collection"], ids.system)).status, 403);
  });
  await step("KCCA issues a permit directly to the active recycler", async () => {
    const r = await issue(ids.recycler, ["recyclables_collection"]);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids.permit = r.body.data.id;
    const [permit] = await sql("SELECT status,verification_code,permit_number FROM organization_permit_applications WHERE id=$1", [ids.permit]);
    assert.equal(permit.status, "approved");
    assert.match(permit.verification_code, /^[0-9A-F]{4}-/);
    const [entry] = await sql("SELECT notes FROM organization_permit_history WHERE application_id=$1", [ids.permit]);
    assert.match(entry.notes, /issued directly by KCCA/);
  });
  await step("a second permit for the same organization is refused", async () => {
    const r = await issue(ids.recycler, ["recyclables_collection"]);
    assert.equal(r.status, 409);
    assert.match(r.body.message, /already holds permit/);
  });
  await step("the permit's activities decide what may be recorded", async () => {
    assert.equal(await purchase("Box", 600, 3), null, "collection is authorized");
    const blocked = await sale("PET", 300, 2);
    assert.match(blocked, /does not authorize recyclable material trading or recycling and processing/);
    const r = await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.kcca, { action: "update_activities", notes: "Trading added after inspection", activityCodes: ["recyclables_collection", "recyclables_trading"] });
    assert.equal(r.status, 200);
    assert.equal(await sale("PET", 300, 2), null, "sale allowed once trading is authorized");
  });
  await step("legacy collectors can be licensed through the same route", async () => {
    const r = await issue(ids.collector, ["household_collection", "waste_transport"]);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const overview = (await api("GET", "/regulatory/permit-lifecycle/overview", ids.kcca)).body.data;
    assert.ok(!overview.no_permit_on_record.some(o => o.id === ids.collector));
  });

  console.log("City oversight figures");
  await step("record sorting, aged stock, closures and weighbridge disposal", async () => {
    assert.equal(await purchase("Steel", 800, 120), null, "aged steel stock");
    const input = await lotId("PET");
    const output = (await sql(`INSERT INTO recycling_material_lots(organization_id,material_type,source_name,quantity_kg,available_kg,collected_on,quality,created_by,origin,source_lot_id)
      VALUES($1,'PET','Sorting',380,380,CURRENT_DATE-3,'clean',$2,'sorting_output',$3) RETURNING id`, [ids.recycler, ids.recyclerAdmin, input]))[0].id;
    await sql(`INSERT INTO recycling_sorting_batches(organization_id,input_lot_id,output_lot_id,processed_on,input_kg,output_material_type,output_kg,rejected_kg,recorded_by)
      VALUES($1,$2,$3,CURRENT_DATE-3,500,'PET',380,120,$4)`, [ids.recycler, input, output, ids.recyclerAdmin]);
    await sql("INSERT INTO recycling_daily_closures(organization_id,operating_date,closed_by) VALUES($1,CURRENT_DATE-5,$2)", [ids.recycler, ids.recyclerAdmin]);
    await sql(`INSERT INTO weighbridge_transactions(organization_id,ticket_number,facility,registration,normalized_registration,operation_date,arrival_at,gross_kg,tare_kg,net_kg,status)
      VALUES($1,$2,'Kiteezi','UBA 001E','UBA001E',CURRENT_DATE-1,now(),17000,10000,7000,'completed')`, [ids.collector, `${tag}-T1`]);
  });
  let overview;
  await step("city totals add up the recycler's purchases, sorting, sales and disposal", async () => {
    overview = (await api("GET", "/recycling-oversight", ids.kcca)).body.data;
    const t = overview.totals;
    assert.equal(t.collected_kg - baseline.collected_kg, 1600, "PET 1000 + Box 600 in period; aged steel is outside");
    assert.equal(t.sold_kg - baseline.sold_kg, 300);
    assert.equal(t.sorted_kg - baseline.sorted_kg, 380);
    assert.equal(t.residue_kg - baseline.residue_kg, 120);
    assert.equal(t.disposed_kg - baseline.disposed_kg, 7000);
    assert.equal(t.recovery_rate, Math.round(t.collected_kg / (t.collected_kg + t.disposed_kg) * 1000) / 10);
  });
  await step("the recycler is on watch for residue, aged stock and missed closings", async () => {
    const row = recycler(overview);
    assert.equal(row.collected_kg, 1600);
    assert.equal(row.stock_kg, 1000 + 600 + 800 + 380, "available stock including the sorted output");
    assert.equal(row.aged_stock_kg, 800);
    assert.equal(row.active_days, 3);
    assert.equal(row.closed_days, 1);
    assert.deepEqual(row.flags.map(f => f.code).sort(), ["aged_stock", "closure_gap", "high_residue"]);
    assert.equal(row.standing, "watch");
  });
  await step("materials are grouped by each company's catalogue categories", async () => {
    const plastic = overview.categories.find(c => c.category === "plastic"), paper = overview.categories.find(c => c.category === "paper");
    assert.ok(plastic.collected_kg >= 1000 && plastic.sold_kg >= 300);
    assert.ok(paper.collected_kg >= 600);
    assert.ok(overview.industries.some(i => i.industry === "Plastic Manufacturing" && i.kg >= 300));
    assert.equal(overview.monthly.length, 6);
  });
  await step("recycler detail shows its own breakdown, aged stock and closings", async () => {
    const r = await api("GET", `/recycling-oversight/recyclers/${ids.recycler}`, ids.kcca);
    assert.equal(r.status, 200);
    const d = r.body.data;
    assert.deepEqual(d.categories.map(c => [c.category, c.collected_kg, c.sold_kg]), [["plastic", 1000, 300], ["paper", 600, 0]]);
    assert.deepEqual(d.aged_stock.map(a => [a.material_type, a.kg]), [["Steel", 800]]);
    assert.equal(d.closures.length, 1);
    assert.equal(d.monthly.at(-1).collected_kg >= 1000, true);
    assert.equal((await api("GET", "/recycling-oversight/recyclers/not-a-uuid", ids.kcca)).status, 400);
  });
  await step("a custom period excludes activity outside it, and bad periods are refused", async () => {
    const r = await api("GET", `/recycling-oversight?from=${today}&to=${today}`, ids.kcca);
    assert.equal(recycler(r.body.data).collected_kg, 0);
    assert.equal((await api("GET", `/recycling-oversight?from=${today}&to=${addDays(today, -1)}`, ids.kcca)).status, 400);
  });
  await step("CSV export lists the recycler with its standing and flags", async () => {
    const r = await api("GET", "/recycling-oversight/export.csv", ids.kcca);
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/csv/);
    assert.match(r.headers.get("content-disposition"), /kcca-recycling-.*\.csv/);
    const line = r.body.split("\r\n").find(l => l.includes(tag));
    assert.ok(line, "recycler row present");
    assert.match(line, /,watch,1600,380,120,300,/);
    assert.match(line, /rejected as residue/);
  });

  console.log("Enforcement through the permit lifecycle");
  await step("suspension stops new purchases and sales and marks the recycler for action", async () => {
    await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.kcca, { action: "suspend", notes: "Unlicensed dumping of residue" });
    assert.match(await purchase("PET", 50, 0), /suspended\. New material purchases cannot be recorded until KCCA reinstates it/);
    assert.match(await sale("PET", 10, 0), /New material sales cannot be recorded/);
    const row = recycler((await api("GET", "/recycling-oversight", ids.kcca)).body.data);
    assert.equal(row.standing, "action");
    assert.ok(row.flags.some(f => f.code === "permit_suspended"));
    await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.kcca, { action: "reinstate", notes: "Residue disposal contract provided" });
    assert.equal(await purchase("Box", 20, 0), null);
  });
  await step("an expired recycling permit produces a recycling-specific notice", async () => {
    await sql("UPDATE organization_permit_applications SET valid_until=CURRENT_DATE-1 WHERE id=$1", [ids.permit]);
    await api("POST", "/regulatory/permit-lifecycle/run", ids.kcca);
    const [notice] = await sql("SELECT message FROM permit_lifecycle_notices WHERE permit_application_id=$1 AND notice_type='expired'", [ids.permit]);
    assert.match(notice.message, /New material purchases and sales cannot be recorded/);
    assert.match(await purchase("PET", 5, 0), /expired on/);
  });
  await step("KCCA can raise a recycling-operations compliance case", async () => {
    const r = await api("POST", "/compliance/city", ids.kcca, {
      organizationId: ids.recycler, category: "recycling_operations", severity: "warning", title: "Sorting residue above standard",
      details: "24% of sorted material was rejected as residue in the last 30 days.", requiredAction: "Show the licensed disposal route for residue.", dueDate: addDays(today, 7),
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  });
}

// E2E_KEEP=1 leaves the fixtures in place for a manual look; E2E_CLEANUP_TAG=<tag> E2E_CLEANUP_ONLY=1 removes them later.
(process.env.E2E_CLEANUP_ONLY ? Promise.resolve(console.log(`Cleaning up ${tag}`)) : run().then(() => console.log(`\nAll ${passed} checks passed.`)))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => {
    if (process.env.E2E_KEEP) console.log(`Fixtures kept. Remove with: E2E_CLEANUP_TAG=${tag} E2E_CLEANUP_ONLY=1 node scripts/e2e-recycling-oversight.cjs`);
    else await cleanup().catch(e => console.error("Cleanup failed", e));
    await pool.end();
  });
