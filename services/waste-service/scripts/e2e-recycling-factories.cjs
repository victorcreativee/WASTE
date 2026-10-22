// End-to-end check of Module 6 (recycling factories and chain of custody) against a running waste-service and the local
// database with migrations 092–097 applied. Creates its own fixtures and removes or deactivates them afterwards.
//
//   E2E_BASE_URL=http://localhost:8193 npm run test:e2e:factories
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-factory-${Date.now()}`;
const ids = {};
let passed = 0;

const sql = async (text, params = []) => (await pool.query(text, params)).rows;
const token = userId => jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
async function api(method, url, user, body) {
  const response = await fetch(`${BASE}/api/waste${url}`, {
    method, headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function step(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  const org = async (name, type, pkg) => (await sql(
    `INSERT INTO organizations(name,type,is_active,created_at,platform_package_id) VALUES($1,$2,true,'2026-08-01',(SELECT id FROM platform_packages WHERE code=$3)) RETURNING id`,
    [`${name} ${tag}`, type, pkg]))[0].id;
  ids.factory = await org("E2E Pellet Factory", "processing_plant", "factory_standard");
  ids.recycler = await org("E2E Recyclers", "recycling_company", "recycling_professional");
  ids.collector = await org("E2E Collectors", "waste_collection_company", "collector_professional");
  const user = async (name, roleName, organizationId) => {
    const id = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES($1,$2,'not-a-login','active',$3) RETURNING id",
      [name, `${tag}-${roleName}-${Math.random().toString(36).slice(2, 7)}@example.test`, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role(roleName)]);
    if (organizationId) await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  ids.kcca = await user("E2E KCCA Officer", "kcca_admin", null);
  ids.factoryAdmin = await user("E2E Factory Admin", "company_admin", ids.factory);
  ids.factorySupervisor = await user("E2E Factory Supervisor", "supervisor", ids.factory);
  ids.recyclerAdmin = await user("E2E Recycler Admin", "company_admin", ids.recycler);
  ids.today = (await sql("SELECT CURRENT_DATE::text AS d"))[0].d;
  ids.lot = (await sql(`INSERT INTO recycling_material_lots(organization_id,material_type,source_name,quantity_kg,available_kg,collected_on,quality,created_by,origin)
    VALUES($1,'PET','E2E supplier',2000,2000,CURRENT_DATE-20,'sorted',$2,'purchase') RETURNING id`, [ids.recycler, ids.recyclerAdmin]))[0].id;
}

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map(r => r.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  await sql("DELETE FROM factory_dispatches WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM factory_batches WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM factory_intakes WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM regulatory_returns WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM recycling_material_sales WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM recycling_material_lots WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_division_authorizations WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_permit_applications WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  // Compliance cases and organization audit events are immutable by design, so the organizations are deactivated.
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

const issuePermit = (orgId, activityCodes) => api("POST", `/regulatory/organizations/${orgId}/permits`, ids.kcca, {
  registrationNumber: `E2E-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, contactName: "Moses Okello", email: "moses@example.test",
  phone: "+256700000003", address: "Namanve Industrial Park", serviceDescription: "Recycling and processing of recyclable plastics.",
  validUntil: addDays(ids.today, 300), activityCodes, notes: "Site inspection completed",
});
const sell = (kg, soldOn, buyerOrganizationId) => api("POST", "/recycling/sales", ids.recyclerAdmin, {
  lotId: ids.lot, buyerName: "E2E Pellet Factory", saleChannel: "industrial", industry: "Plastic manufacturing", quantityKg: kg,
  unitPriceUgx: 900, soldOn, buyerOrganizationId,
});

async function run() {
  await setup();
  const t = ids.today;
  let saleId, petIntake, paperIntake, batchId;

  console.log("Licensing and access");
  await step("factories receive their own permit activities; only factory staff open the workspace", async () => {
    assert.equal((await issuePermit(ids.factory, ["recyclables_trading"])).status, 400, "recycler activity refused for a factory");
    let r = await issuePermit(ids.factory, ["recycled_product_manufacturing"]);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids.factoryPermit = r.body.data.id;
    r = await issuePermit(ids.recycler, ["recyclables_collection", "recyclables_trading"]);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await api("GET", "/factory/overview", ids.recyclerAdmin)).status, 403);
    assert.equal((await api("GET", "/factory/overview", ids.factorySupervisor)).status, 200);
    assert.equal((await api("GET", "/organization-context", ids.factoryAdmin)).body.data.type, "processing_plant");
  });
  await step("intake needs the processing activity on the factory's permit", async () => {
    const manual = { supplierName: "Market collectors", materialCategory: "paper", materialDescription: "Mixed cardboard", receivedKg: 300, receivedOn: t };
    let r = await api("POST", "/factory/intakes", ids.factoryAdmin, manual);
    assert.equal(r.status, 400);
    assert.match(r.body.message, /does not authorize recycled material processing.*New material intake|does not authorize recycled material processing/);
    await api("PATCH", `/regulatory/permit-applications/${ids.factoryPermit}`, ids.kcca, { action: "update_activities", notes: "Processing line approved", activityCodes: ["recycled_material_processing", "recycled_product_manufacturing"] });
    r = await api("POST", "/factory/intakes", ids.factoryAdmin, manual);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    paperIntake = r.body.data.id;
  });

  console.log("Chain of custody");
  await step("recyclers see licensed factories and can only name a factory as the buyer", async () => {
    const directory = (await api("GET", "/factories/directory", ids.recyclerAdmin)).body.data;
    assert.ok(directory.some(f => f.id === ids.factory && f.permit_in_force === true));
    const r = await sell(50, t, ids.collector);
    assert.equal(r.status, 400);
    assert.match(r.body.message, /licensed recycling factory/);
  });
  await step("a sale to the factory appears in its expected deliveries", async () => {
    const r = await sell(800, t, ids.factory);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    saleId = r.body.data.id;
    const expected = (await api("GET", "/factory/expected-deliveries", ids.factoryAdmin)).body.data;
    const delivery = expected.find(d => d.sale_id === saleId);
    assert.deepEqual([delivery.sold_kg, delivery.material_category, delivery.state, delivery.seller_name], [800, "plastic", "awaiting", `E2E Recyclers ${tag}`]);
  });
  await step("receiving records the shortfall against the declared weight", async () => {
    const r = await api("POST", "/factory/intakes", ids.factoryAdmin, { sourceSaleId: saleId, receivedKg: 740, rejectedKg: 40, receivedOn: t, vehicleRegistration: "UBE 123A" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    petIntake = r.body.data.id;
    assert.deepEqual([Number(r.body.data.declared_kg), Number(r.body.data.accepted_kg), Number(r.body.data.available_kg), r.body.data.custody_state], [800, 700, 700, "shortfall"]);
    assert.match(r.body.message, /less was received/);
    assert.equal(r.body.data.supplier_organization_id, ids.recycler);
    const [note] = await sql("SELECT category,severity,title FROM notifications WHERE recipient_user_id=$1 AND category='custody'", [ids.recyclerAdmin]);
    assert.deepEqual([note.category, note.severity], ["custody", "warning"], "the recycler is told about the shortfall");
    assert.match(note.title, /Delivery short at E2E Pellet Factory/);
    assert.equal((await api("POST", "/factory/intakes", ids.factoryAdmin, { sourceSaleId: saleId, receivedKg: 740, receivedOn: t })).status, 409);
    assert.ok(!(await api("GET", "/factory/expected-deliveries", ids.factoryAdmin)).body.data.some(d => d.sale_id === saleId));
  });
  await step("a received delivery's quantity and buyer are locked on the recycler's side", async () => {
    await assert.rejects(sql("UPDATE recycling_material_sales SET quantity_kg=700 WHERE id=$1", [saleId]), /already received this delivery/);
  });
  await step("an unreceived delivery older than 7 days is overdue", async () => {
    const r = await sell(200, addDays(t, -10), ids.factory);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids.overdueSale = r.body.data.id;
    const expected = (await api("GET", "/factory/expected-deliveries", ids.factoryAdmin)).body.data;
    assert.equal(expected.find(d => d.sale_id === ids.overdueSale).state, "overdue");
  });

  console.log("Processing and dispatch");
  await step("a batch draws on intakes and records yield and residue", async () => {
    const base = { processedOn: t, productName: "Recycled PET flakes", outputKg: 700, residueKg: 150, residueDisposal: "Licensed hauler to Kiteezi" };
    assert.equal((await api("POST", "/factory/batches", ids.factoryAdmin, { ...base, inputs: [{ intakeId: petIntake, kg: 701 }] })).status, 400, "overdraw");
    assert.equal((await api("POST", "/factory/batches", ids.factoryAdmin, { ...base, residueDisposal: undefined, inputs: [{ intakeId: petIntake, kg: 600 }, { intakeId: paperIntake, kg: 300 }] })).status, 400, "residue disposal required");
    assert.equal((await api("POST", "/factory/batches", ids.factoryAdmin, { ...base, processedOn: addDays(t, 1), inputs: [{ intakeId: petIntake, kg: 600 }] })).status, 400, "future date");
    const r = await api("POST", "/factory/batches", ids.factoryAdmin, { ...base, inputs: [{ intakeId: petIntake, kg: 600 }, { intakeId: paperIntake, kg: 300 }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    batchId = r.body.data.id;
    assert.deepEqual([Number(r.body.data.input_kg), r.body.data.yield_rate], [900, 77.8]);
    const [pet] = await sql("SELECT available_kg FROM factory_intakes WHERE id=$1", [petIntake]);
    assert.equal(Number(pet.available_kg), 100);
  });
  await step("processed intakes cannot be voided; unused ones can, and then cannot be processed", async () => {
    assert.equal((await api("PATCH", `/factory/intakes/${petIntake}/void`, ids.factoryAdmin, { reason: "Recorded twice by mistake" })).status, 409);
    const spare = (await api("POST", "/factory/intakes", ids.factoryAdmin, { supplierName: "Walk-in seller", materialCategory: "metal", materialDescription: "Aluminium cans", receivedKg: 50, receivedOn: t })).body.data.id;
    assert.equal((await api("PATCH", `/factory/intakes/${spare}/void`, ids.factorySupervisor, { reason: "Wrong factory" })).status, 403, "only admins void");
    assert.equal((await api("PATCH", `/factory/intakes/${spare}/void`, ids.factoryAdmin, { reason: "Recorded at the wrong site" })).status, 200);
    const r = await api("POST", "/factory/batches", ids.factoryAdmin, { processedOn: t, productName: "Bales", outputKg: 10, inputs: [{ intakeId: spare, kg: 10 }] });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /voided/);
  });
  await step("dispatch cannot exceed what a batch produced", async () => {
    let r = await api("POST", "/factory/dispatches", ids.factoryAdmin, { batchId, productName: "Recycled PET flakes", quantityKg: 500, buyerName: "Kampala Bottlers Ltd", dispatchedOn: t });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    r = await api("POST", "/factory/dispatches", ids.factoryAdmin, { batchId, productName: "Recycled PET flakes", quantityKg: 250, buyerName: "Kampala Bottlers Ltd", dispatchedOn: t });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Only 200 kg of this batch remain/);
  });
  await step("overview shows stock, month totals and paged lists", async () => {
    const o = (await api("GET", "/factory/overview", ids.factoryAdmin)).body.data;
    assert.deepEqual(o.stock.map(s => [s.material_category, s.kg]), [["plastic", 100]]);
    assert.deepEqual([o.month.accepted_kg, o.month.input_kg, o.month.output_kg, o.month.residue_kg, o.month.dispatched_kg, o.month.yield_rate], [1000, 900, 700, 150, 500, 77.8]);
    const page = await api("GET", "/factory/intakes?limit=1", ids.factoryAdmin);
    assert.deepEqual([page.body.data.length, page.body.pagination.total], [1, 3]);
  });

  console.log("KCCA oversight, returns and enforcement");
  await step("recycling oversight reports factory volumes and custody exceptions", async () => {
    const f = (await api("GET", "/recycling-oversight", ids.kcca)).body.data.factories;
    const mine = f.factories.find(x => x.id === ids.factory);
    assert.deepEqual([mine.accepted_kg, mine.rejected_kg, mine.input_kg, mine.output_kg, mine.residue_kg, mine.dispatched_kg, mine.stock_kg, mine.yield_rate], [1000, 40, 900, 700, 150, 500, 100, 77.8]);
    const exceptions = f.custody_exceptions.filter(e => [saleId, ids.overdueSale].includes(e.sale_id));
    assert.deepEqual(exceptions.map(e => e.state).sort(), ["overdue", "shortfall"]);
  });
  await step("factories file monthly returns with their own figures", async () => {
    const prefill = (await api("GET", "/regulatory/returns/prefill?period=2026-09", ids.factoryAdmin)).body.data;
    assert.equal(prefill.organization_type, "processing_plant");
    const figures = { accepted_kg: 900, rejected_kg: 30, processed_kg: 800, output_kg: 900, residue_kg: 50, residue_disposal: "Licensed hauler", dispatched_kg: 600, staff_employed: 12 };
    let r = await api("POST", "/regulatory/returns", ids.factoryAdmin, { period: "2026-09", declarantName: "Ruth Nambi", declarantTitle: "Plant Manager", confirm: true, figures });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /cannot exceed the material processed/);
    r = await api("POST", "/regulatory/returns", ids.factoryAdmin, { period: "2026-09", declarantName: "Ruth Nambi", declarantTitle: "Plant Manager", confirm: true, figures: { ...figures, output_kg: 700 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const register = (await api("GET", "/regulatory/returns-register?period=2026-09", ids.kcca)).body.data;
    assert.equal(register.companies.find(c => c.organization_id === ids.factory).state, "submitted");
  });
  await step("KCCA can raise a compliance case against a factory", async () => {
    const r = await api("POST", "/compliance/city", ids.kcca, { organizationId: ids.factory, category: "recycling_operations", severity: "advisory",
      title: "Delivery shortfall", details: "60 kg less PET was received than the recycler sold.", requiredAction: "Reconcile the delivery with the recycler.", dueDate: addDays(t, 7) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  });
  await step("an expired factory permit stops new intake with a factory-specific notice", async () => {
    await sql("UPDATE organization_permit_applications SET valid_until=CURRENT_DATE-1 WHERE id=$1", [ids.factoryPermit]);
    await api("POST", "/regulatory/permit-lifecycle/run", ids.kcca);
    const [notice] = await sql("SELECT message FROM permit_lifecycle_notices WHERE permit_application_id=$1 AND notice_type='expired'", [ids.factoryPermit]);
    assert.match(notice.message, /New material intake cannot be recorded/);
    const r = await api("POST", "/factory/intakes", ids.factoryAdmin, { supplierName: "Market collectors", materialCategory: "paper", materialDescription: "Cardboard", receivedKg: 10, receivedOn: t });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /expired on/);
  });
}

// E2E_KEEP=1 leaves the fixtures for a manual look; E2E_CLEANUP_TAG=<tag> E2E_CLEANUP_ONLY=1 removes them later.
(process.env.E2E_CLEANUP_ONLY ? Promise.resolve(console.log(`Cleaning up ${tag}`)) : run().then(() => console.log(`\nAll ${passed} checks passed.`)))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => {
    if (process.env.E2E_KEEP) console.log(`Fixtures kept. Remove with: E2E_CLEANUP_TAG=${tag} E2E_CLEANUP_ONLY=1 node scripts/e2e-recycling-factories.cjs`);
    else await cleanup().catch(e => console.error("Cleanup failed", e));
    await pool.end();
  });
