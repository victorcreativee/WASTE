// End-to-end check of customer self-signup (migration 110): a household, office or business creates its own account,
// is matched to the collection companies serving its place, asks one to collect, and the company accepts or declines.
// Then the accepted customer is put on contract, billed and pays like any other customer. Runs against the API gateway
// (auth and waste services) and the local database. Creates its own fixtures and deactivates them afterwards.
//
//   E2E_BASE_URL=http://localhost:8090 npm run test:e2e:customer-signup
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8090").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = `e2e-signup-${Date.now()}`;
const ids = { phones: [] };
let passed = 0;

const sql = async (text, params = []) => (await pool.query(text, params)).rows;
const staffToken = (userId) => jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
async function api(method, url, auth, body) {
  const bearer = !auth ? null : auth.startsWith("ey") ? auth : staffToken(auth);
  const response = await fetch(`${BASE}${url}`, {
    method, headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function step(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
const phone = () => { const value = `0709${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`; ids.phones.push(`+256${value.slice(1)}`); return value; };
const signup = (overrides = {}) => api("POST", "/api/auth/households/signup", null, {
  fullName: "E2E Customer", phone: phone(), password: "secret12", customerType: "office_business",
  divisionId: ids.makindye, areaId: ids.kibuye, address: "Plot 1, E2E Road", ...overrides,
});

async function setup() {
  const role = (name) => sql("SELECT id FROM roles WHERE name=$1", [name]).then((r) => r[0].id);
  const org = async (name) => (await sql(
    `INSERT INTO organizations(name,type,is_active,platform_package_id) VALUES($1,'waste_collection_company',true,(SELECT id FROM platform_packages WHERE code='collector_professional')) RETURNING id`,
    [`${name} ${tag}`]))[0].id;
  const admin = async (organizationId) => {
    const id = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES('E2E Admin',$1,'not-a-login','active',$2) RETURNING id",
      [`${tag}-admin-${Math.random().toString(36).slice(2, 7)}@example.test`, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role("company_admin")]);
    await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  const place = (await sql(`SELECT d.id division, a.id area FROM kampala_divisions d JOIN kampala_division_areas a ON a.division_id=d.id WHERE d.code='makindye' AND a.name='Kibuye'`))[0];
  if (!place) throw new Error("The Kampala area catalogue (migration 044) is missing: Makindye → Kibuye not found");
  ids.makindye = place.division; ids.kibuye = place.area;
  ids.otherArea = (await sql(`SELECT id FROM kampala_division_areas WHERE division_id=$1 AND id<>$2 ORDER BY name LIMIT 1`, [ids.makindye, ids.kibuye]))[0].id;
  ids.elsewhere = (await sql(`SELECT id FROM kampala_divisions WHERE code='kawempe'`))[0].id;

  // Area company: a zone for Kibuye with a drawn boundary. Division company: a zone elsewhere in Makindye, no area.
  ids.areaCo = await org("E2E Kibuye Collectors"); ids.areaAdmin = await admin(ids.areaCo);
  ids.divisionCo = await org("E2E Makindye Collectors"); ids.divisionAdmin = await admin(ids.divisionCo);
  // Zones need KCCA's authorisation for the division, as in production: an approved permit, recorded directly here.
  const kcca = (await sql(`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.name='kcca_admin' WHERE u.status='active' LIMIT 1`))[0];
  if (!kcca) throw new Error("A KCCA administrator account is needed to authorise the test companies");
  for (const organizationId of [ids.areaCo, ids.divisionCo]) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL session_replication_role = replica");
      const permit = (await client.query(`INSERT INTO organization_permit_applications(application_number,organization_id,company_name,registration_number,contact_name,email,phone,address,service_description,status,submitted_at,permit_number,valid_from,valid_until,reviewed_by,reviewed_at)
        VALUES($1,$2,$3,$1,'E2E','e2e@example.test','0700000000','Kampala','Household collection (e2e)','approved',now(),$1,CURRENT_DATE-1,CURRENT_DATE+365,$4,now()) RETURNING id`,
        [`${tag}-${organizationId.slice(0, 8)}`, organizationId, `E2E ${tag}`, kcca.id])).rows[0];
      await client.query(`INSERT INTO organization_division_authorizations(organization_id,division_id,permit_application_id,status,authorized_by) VALUES($1,$2,$3,'active',$4)`, [organizationId, ids.makindye, permit.id, kcca.id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  ids.areaZone = (await sql(`INSERT INTO waste_zones(organization_id,name,area_type,division_id,catalog_area_id,boundary,center_point,is_active)
    VALUES($1,'E2E Kibuye zone','residential',$2,$3,ST_GeomFromText('POLYGON((32.560 0.290,32.575 0.290,32.575 0.302,32.560 0.302,32.560 0.290))',4326),
      ST_SetSRID(ST_Point(32.5675,0.296),4326)::geography,true) RETURNING id`, [ids.areaCo, ids.makindye, ids.kibuye]))[0].id;
  ids.divisionZone = (await sql(`INSERT INTO waste_zones(organization_id,name,area_type,division_id,center_point,is_active)
    VALUES($1,'E2E Makindye zone','residential',$2,ST_SetSRID(ST_Point(32.59,0.28),4326)::geography,true) RETURNING id`, [ids.divisionCo, ids.makindye]))[0].id;
  ids.plan = (await sql(`INSERT INTO service_plans(organization_id,name,customer_type,billing_frequency,fee_ugx,is_active,collections_per_period)
    VALUES($1,'E2E office weekly','office_business','monthly',45000,true,4) RETURNING id`, [ids.areaCo]))[0].id;
  ids.today = (await sql("SELECT CURRENT_DATE::text AS d"))[0].d;
}

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map((r) => r.id);
  const staff = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map((r) => r.id);
  const customers = (await sql("SELECT id FROM users WHERE phone=ANY($1::text[])", [ids.phones])).map((r) => r.id);
  const users = [...staff, ...customers];
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[]) OR organization_id=ANY($2::uuid[])", [users, orgs]);
  await sql("UPDATE customer_provider_requests SET status='cancelled' WHERE requested_organization_id=ANY($1::uuid[]) AND status LIKE 'pending_%'", [orgs]);
  await sql("UPDATE waste_zones SET is_active=false WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("UPDATE organization_division_authorizations SET status='revoked' WHERE organization_id=ANY($1::uuid[])", [orgs]).catch(() => undefined);
  await sql("UPDATE service_plans SET is_active=false WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [staff]).catch(() => undefined);
  // Customer, billing and audit records are kept as evidence; the accounts and companies are switched off.
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)',phone=NULL WHERE id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

async function run() {
  await setup();

  console.log("Finding companies");
  await step("the divisions and areas of Kampala are public", async () => {
    const r = await api("GET", "/api/waste/public/areas");
    assert.equal(r.status, 200);
    assert.ok(r.body.data.find((d) => d.id === ids.makindye).areas.some((a) => a.id === ids.kibuye));
  });
  await step("companies are ranked: drawn zone over area over division", async () => {
    const inside = await api("GET", `/api/waste/public/collectors?divisionId=${ids.makindye}&areaId=${ids.kibuye}&latitude=0.295&longitude=32.565&customerType=office_business`);
    const mine = inside.body.data.filter((c) => [ids.areaCo, ids.divisionCo].includes(c.id));
    assert.deepEqual(mine.map((c) => [c.id, c.match]), [[ids.areaCo, "location"], [ids.divisionCo, "division"]]);
    assert.equal(Number(mine[0].from_fee_ugx), 45000);
    const byArea = await api("GET", `/api/waste/public/collectors?divisionId=${ids.makindye}&areaId=${ids.kibuye}`);
    assert.equal(byArea.body.data.find((c) => c.id === ids.areaCo).match, "area");
    const otherArea = await api("GET", `/api/waste/public/collectors?divisionId=${ids.makindye}&areaId=${ids.otherArea}`);
    assert.equal(otherArea.body.data.find((c) => c.id === ids.areaCo).match, "division");
    const elsewhere = await api("GET", `/api/waste/public/collectors?divisionId=${ids.elsewhere}`);
    assert.ok(!elsewhere.body.data.some((c) => [ids.areaCo, ids.divisionCo].includes(c.id)));
  });
  await step("a place is required to look companies up", async () => {
    assert.equal((await api("GET", "/api/waste/public/collectors")).status, 400);
  });

  console.log("Signing up");
  await step("a company outside the customer's area cannot be chosen, and nothing is created", async () => {
    const r = await signup({ divisionId: ids.elsewhere, areaId: undefined, organizationId: ids.areaCo });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal((await sql("SELECT COUNT(*)::int n FROM users WHERE phone=$1", [ids.phones.at(-1)]))[0].n, 0);
  });
  await step("an area must belong to the chosen division", async () => {
    assert.equal((await signup({ divisionId: ids.elsewhere, areaId: ids.kibuye })).status, 400);
  });
  let customer, customerPhone;
  await step("a customer creates an account and asks the company serving their area", async () => {
    const r = await signup({ fullName: "E2E Office Kibuye", organizationId: ids.areaCo, note: "Two bins" });
    customerPhone = ids.phones.at(-1);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.data.roles.map((x) => x.name ?? x), ["citizen"]);
    customer = r.body.data.tokens.accessToken;
  });
  await step("the same number cannot sign up twice, however it is written", async () => {
    const again = await api("POST", "/api/auth/households/signup", null, { fullName: "Twice", phone: `256 ${customerPhone.slice(4, 7)} ${customerPhone.slice(7)}`, password: "secret12", customerType: "residential", divisionId: ids.makindye, address: "Somewhere 12" });
    assert.equal(again.status, 409);
  });
  await step("signing in with phone and password works; a wrong password is refused the same way as an unknown number", async () => {
    const ok = await api("POST", "/api/auth/households/password", null, { phone: `0${customerPhone.slice(4)}`, password: "secret12" });
    assert.equal(ok.status, 200);
    const wrong = await api("POST", "/api/auth/households/password", null, { phone: customerPhone, password: "nope1234" });
    const unknown = await api("POST", "/api/auth/households/password", null, { phone: "0709000001", password: "nope1234" });
    assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
    assert.equal(wrong.body.message, unknown.body.message);
  });
  await step("the customer's page shows the request waiting, and requests to the company are not possible yet", async () => {
    const me = await api("GET", "/api/waste/households/me", customer);
    assert.equal(me.body.data.company, null);
    assert.equal(me.body.data.serviceRequest.status, "pending_new_provider");
    assert.equal(me.body.data.household.locationPrecise, false);
    assert.equal((await api("POST", "/api/waste/households/me/requests", customer, { kind: "service_complaint", note: "Too early" })).status, 409);
  });
  await step("the area cannot change while a request waits", async () => {
    const r = await api("PUT", "/api/waste/households/me/place", customer, { divisionId: ids.makindye, areaId: ids.otherArea });
    assert.equal(r.status, 409);
  });

  console.log("Company review");
  let request;
  await step("the company is notified and sees the request with phone, type, area and note", async () => {
    const notes = await sql("SELECT title FROM notifications WHERE recipient_user_id=$1", [ids.areaAdmin]);
    assert.ok(notes.some((n) => n.title === "New customer request"));
    const queue = await api("GET", "/api/waste/customers/provider-requests", ids.areaAdmin);
    request = queue.body.data.find((r) => r.customer_phone === customerPhone);
    assert.equal(request.organization_action, "review_acceptance");
    assert.equal(request.customer_type, "office_business");
    assert.equal(request.area_name, "Kibuye");
    assert.equal(request.customer_note, "Two bins");
    assert.equal(request.suggested_zone_id, ids.areaZone);
    assert.equal(request.customer_email, null);
  });
  await step("another company cannot review it", async () => {
    assert.equal((await api("PATCH", `/api/waste/customers/provider-requests/${request.id}`, ids.divisionAdmin, { action: "approve" })).status, 404);
  });
  await step("the company cannot accept into another company's zone", async () => {
    const r = await api("PATCH", `/api/waste/customers/provider-requests/${request.id}`, ids.areaAdmin, { action: "approve", zoneId: ids.divisionZone });
    assert.equal(r.status, 409);
  });
  await step("the company accepts into its zone; the customer is placed at the zone centre and told", async () => {
    const r = await api("PATCH", `/api/waste/customers/provider-requests/${request.id}`, ids.areaAdmin, { action: "approve", zoneId: ids.areaZone });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const me = await api("GET", "/api/waste/households/me", customer);
    assert.equal(me.body.data.company.name, `E2E Kibuye Collectors ${tag}`);
    assert.equal(me.body.data.household.status, "active");
    assert.ok(me.body.data.messages.some((m) => m.title === "Request accepted"));
    const [loc] = await sql(`SELECT l.zone_id, ST_Equals(l.location::geometry, z.center_point::geometry) at_centre FROM customer_service_locations l
      JOIN customer_profiles cp ON cp.id=l.customer_id JOIN users u ON u.id=cp.user_id JOIN waste_zones z ON z.id=l.zone_id WHERE u.phone=$1`, [customerPhone]);
    assert.equal(loc.zone_id, ids.areaZone); assert.equal(loc.at_centre, true);
  });
  await step("the company's customer list flags the missing exact location until the customer shares it", async () => {
    const before = (await api("GET", "/api/waste/customers", ids.areaAdmin)).body.data.find((c) => c.phone === customerPhone);
    assert.ok(before.planning_reasons.some((reason) => reason.startsWith("Exact location not recorded")));
    assert.equal((await api("PUT", "/api/waste/households/me/place", customer, { latitude: 0.296, longitude: 32.566 })).status, 200);
    const after = (await api("GET", "/api/waste/customers", ids.areaAdmin)).body.data.find((c) => c.phone === customerPhone);
    assert.ok(!after.planning_reasons.some((reason) => reason.startsWith("Exact location")));
    assert.ok(!after.planning_reasons.includes("Provider coverage needs review"));
  });
  await step("once served, the customer cannot move themselves to another area", async () => {
    assert.equal((await api("PUT", "/api/waste/households/me/place", customer, { divisionId: ids.elsewhere, areaId: null })).status, 409);
  });

  console.log("Service and billing");
  await step("the customer sends a complaint, which needs a description, to the company's service issues", async () => {
    assert.equal((await api("POST", "/api/waste/households/me/requests", customer, { kind: "service_complaint" })).status, 400);
    const r = await api("POST", "/api/waste/households/me/requests", customer, { kind: "service_complaint", note: "The crew left litter" });
    assert.equal(r.status, 201);
    const [issue] = await sql("SELECT category, assigned_organization_id FROM citizen_issues WHERE id=$1", [r.body.data.id]);
    assert.deepEqual(issue, { category: "service_complaint", assigned_organization_id: ids.areaCo });
  });
  let invoice;
  await step("the company puts the customer on contract and bills them", async () => {
    const contract = await api("POST", "/api/waste/contracts", ids.areaAdmin, { customerId: request.customer_id, planId: ids.plan, startsOn: ids.today, endsOn: `${Number(ids.today.slice(0, 4)) + 1}${ids.today.slice(4)}` });
    assert.equal(contract.status, 201, JSON.stringify(contract.body));
    const active = await api("PATCH", `/api/waste/contracts/${contract.body.data.id}/status`, ids.areaAdmin, { status: "active" });
    assert.equal(active.status, 200, JSON.stringify(active.body));
    const generated = await api("POST", "/api/waste/billing/invoices/generate", ids.areaAdmin, {});
    assert.equal(generated.status < 300, true, JSON.stringify(generated.body));
    const me = await api("GET", "/api/waste/households/me", customer);
    invoice = me.body.data.invoices.find((i) => Number(i.balance_ugx) > 0);
    assert.equal(Number(invoice.amount_ugx), 45000);
  });
  await step("the customer pays by mobile money and the company confirms it", async () => {
    const paid = await api("POST", "/api/waste/billing/payments", customer, { invoiceId: invoice.id, amountUgx: 45000, provider: "mtn_momo", payerPhone: `0${customerPhone.slice(4)}` });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    const confirmed = await api("PATCH", `/api/waste/billing/payments/${paid.body.data.id}/confirm`, ids.areaAdmin, { providerReference: "E2E-REF-1" });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const me = await api("GET", "/api/waste/households/me", customer);
    assert.equal(me.body.data.balanceUgx, 0);
  });

  console.log("Declines and passwords");
  await step("a declined customer is told why and can choose another company", async () => {
    const r = await signup({ fullName: "E2E Shop Kibuye", customerType: "commercial", organizationId: ids.divisionCo });
    const token = r.body.data.tokens.accessToken, shopPhone = ids.phones.at(-1);
    const pending = (await api("GET", "/api/waste/customers/provider-requests", ids.divisionAdmin)).body.data.find((x) => x.customer_phone === shopPhone);
    assert.equal((await api("PATCH", `/api/waste/customers/provider-requests/${pending.id}`, ids.divisionAdmin, { action: "reject", note: "We do not reach Kibuye yet" })).status, 200);
    const me = await api("GET", "/api/waste/households/me", token);
    assert.equal(me.body.data.serviceRequest.status, "rejected");
    assert.ok(me.body.data.messages.some((m) => m.title === "Request declined" && m.body.includes("We do not reach Kibuye yet")));
    const options = await api("GET", "/api/waste/customer-service/provider-options", token);
    assert.ok(options.body.data.some((c) => c.id === ids.areaCo));
    assert.equal((await api("POST", "/api/waste/customer-service/provider-requests", token, { organizationId: ids.areaCo })).status, 201);
  });
  await step("changing the password returns a fresh session and retires the old password", async () => {
    const changed = await api("PUT", "/api/auth/households/me/password", customer, { password: "newpass99" });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal((await api("POST", "/api/auth/households/password", null, { phone: customerPhone, password: "secret12" })).status, 401);
    assert.equal((await api("POST", "/api/auth/households/password", null, { phone: customerPhone, password: "newpass99" })).status, 200);
  });
  await step("staff accounts cannot use the household password route", async () => {
    assert.equal((await api("PUT", "/api/auth/households/me/password", ids.areaAdmin, { password: "whatever1" })).status, 403);
  });

  console.log(`\n${passed} checks passed`);
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch((error) => console.error("cleanup failed:", error.message)); await pool.end(); });
