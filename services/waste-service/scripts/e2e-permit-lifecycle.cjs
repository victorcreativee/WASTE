// End-to-end check of Module 1 (permit lifecycle and authorized activities) against a running waste-service
// and a local database with migration 092 applied. Creates its own fixtures and removes them afterwards.
//
//   PORT=8193 PERMIT_LIFECYCLE_SCHEDULER=off npm run dev      (in one terminal)
//   E2E_BASE_URL=http://localhost:8193 node scripts/e2e-permit-lifecycle.cjs
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-permit-${Date.now()}`;
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
  return { status: response.status, type, body: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const blockReason = async () => (await sql("SELECT organization_permit_block_reason($1,ARRAY['household_collection','commercial_collection']) AS r", [ids.org]))[0].r;
async function tryRouteInsert() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO collection_routes(organization_id,name,route_date,status) VALUES($1,'E2E route',CURRENT_DATE,'planned')", [ids.org]);
    return null;
  } catch (error) {
    return error.message;
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  ids.org = (await sql("INSERT INTO organizations(name,type,is_active) VALUES($1,'waste_collection_company',true) RETURNING id", [`E2E Permit Collectors ${tag}`]))[0].id;
  const user = async (name, roleName, organizationId) => {
    const id = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES($1,$2,'not-a-login','active',$3) RETURNING id",
      [name, `${tag}-${roleName}@example.test`, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role(roleName)]);
    if (organizationId) await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  ids.kcca = await user("E2E KCCA Officer", "kcca_admin", null);
  ids.admin = await user("E2E Company Admin", "company_admin", ids.org);
  ids.supervisor = await user("E2E Supervisor", "supervisor", ids.org);
  ids.permit = (await sql(
    `INSERT INTO organization_permit_applications(application_number,organization_id,company_name,registration_number,contact_name,email,phone,address,service_description,status,submitted_at)
     VALUES($1,$2,$3,$4,'E2E Contact','e2e@example.test','+256700000000','Plot 1, Kampala','Household and commercial collection in Kampala.','under_review',CURRENT_TIMESTAMP) RETURNING id`,
    [`${tag}-APP`, ids.org, `E2E Permit Collectors ${tag}`, `E2E-${Date.now()}`]))[0].id;
  ids.division = (await sql("SELECT id FROM kampala_divisions WHERE code='central'"))[0].id;
  ids.today = (await sql("SELECT CURRENT_DATE::text AS d"))[0].d;
}

// Permits and their lifecycle rows are deleted. Organization audit events are immutable by design, so the
// fixture organization and users that appear in them are deactivated and renamed instead of deleted.
async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`E2E Permit Collectors ${tag}%`])).map(row => row.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(row => row.id);
  await sql("DELETE FROM organization_division_authorizations WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_permit_applications WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

async function run() {
  await setup();
  const { today } = ids;
  let code;

  console.log("Approval and activities");
  await step("approval without activities is refused", async () => {
    const r = await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.kcca, { action: "approve", notes: "Meets requirements", validUntil: addDays(today, 20) });
    assert.equal(r.status, 400);
  });
  await step("activities from another organization type are refused", async () => {
    const r = await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.kcca, { action: "approve", notes: "Meets requirements", validUntil: addDays(today, 20), activityCodes: ["recycling_processing"] });
    assert.equal(r.status, 400);
  });
  await step("company admin cannot decide permits", async () => {
    const r = await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.admin, { action: "approve", notes: "x x x", validUntil: addDays(today, 20), activityCodes: ["household_collection"] });
    assert.equal(r.status, 403);
  });
  await step("KCCA approves with activities; permit number and verification code are issued", async () => {
    const r = await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.kcca, { action: "approve", notes: "Meets requirements", validUntil: addDays(today, 20), activityCodes: ["household_collection", "waste_transport"] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [permit] = await sql("SELECT status,permit_number,verification_code FROM organization_permit_applications WHERE id=$1", [ids.permit]);
    assert.equal(permit.status, "approved");
    assert.match(permit.verification_code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    code = permit.verification_code;
    const activities = await sql("SELECT activity_code FROM organization_permit_activities WHERE permit_application_id=$1 ORDER BY 1", [ids.permit]);
    assert.deepEqual(activities.map(a => a.activity_code), ["household_collection", "waste_transport"]);
  });
  await step("KCCA authorizes the Central division", async () => {
    const r = await api("POST", "/regulatory/division-authorizations", ids.kcca, { organizationId: ids.org, permitApplicationId: ids.permit, divisionIds: [ids.division], expiresOn: addDays(today, 20) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  });
  await step("a valid permit lets the collector plan routes", async () => {
    assert.equal(await blockReason(), null);
    const error = await tryRouteInsert();
    assert.ok(!error || !/KCCA permit/.test(error), error);
  });

  console.log("Reminders and company view");
  await step("lifecycle run issues a 30-day reminder once", async () => {
    let r = await api("POST", "/regulatory/permit-lifecycle/run", ids.kcca);
    assert.equal(r.status, 200);
    r = await api("POST", "/regulatory/permit-lifecycle/run", ids.kcca);
    const notices = await sql("SELECT notice_type FROM permit_lifecycle_notices WHERE permit_application_id=$1", [ids.permit]);
    assert.deepEqual(notices.map(n => n.notice_type), ["expiry_30"]);
  });
  await step("company sees standing, activities, divisions, reminder and an open renewal window", async () => {
    const r = await api("GET", "/regulatory/organization-permit", ids.supervisor);
    assert.equal(r.status, 200);
    const d = r.body.data;
    assert.equal(d.permit.effective_status, "approved");
    assert.deepEqual(d.permit.activities.map(a => a.code), ["household_collection", "waste_transport"]);
    assert.deepEqual(d.permit.divisions.map(x => x.name), ["Central Division"]);
    assert.equal(d.renewal.eligible, true);
    assert.equal(d.notices[0].notice_type, "expiry_30");
  });
  await step("company acknowledges the reminder", async () => {
    const [notice] = await sql("SELECT id FROM permit_lifecycle_notices WHERE permit_application_id=$1", [ids.permit]);
    const r = await api("POST", `/regulatory/organization-permit/notices/${notice.id}/acknowledge`, ids.admin);
    assert.equal(r.status, 200);
  });

  console.log("Public verification");
  await step("anyone can verify the certificate, in any typing style", async () => {
    const r = await api("GET", `/public/permit-verification/${code.toLowerCase().replaceAll("-", " ")}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.status, "approved");
    assert.deepEqual(r.body.data.divisions, ["Central Division"]);
    assert.deepEqual(r.body.data.activities, ["Household collection", "Transport to disposal site"]);
  });
  await step("an unknown code is reported as not found", async () => {
    assert.equal((await api("GET", "/public/permit-verification/0000-0000-0000")).status, 404);
  });
  await step("certificate PDF carries the verification code and QR", async () => {
    const r = await api("GET", "/regulatory/organization-certificate/pdf", ids.admin);
    assert.equal(r.status, 200);
    assert.match(r.type, /application\/pdf/);
    const pdf = r.body.toString("latin1");
    assert.ok(pdf.includes(`(${code}) Tj`));
    assert.ok(pdf.includes("Household collection"));
  });

  console.log("Company renewal requests");
  await step("supervisor cannot request renewal", async () => {
    const r = await api("POST", "/regulatory/organization-permit/renewals", ids.supervisor, { requestedValidUntil: addDays(today, 400), statement: "Please renew our permit." });
    assert.equal(r.status, 403);
  });
  await step("requested date must extend the permit", async () => {
    const r = await api("POST", "/regulatory/organization-permit/renewals", ids.admin, { requestedValidUntil: addDays(today, 10), statement: "Please renew our permit." });
    assert.equal(r.status, 400);
  });
  let requestId;
  await step("company admin requests renewal; a second open request is refused", async () => {
    let r = await api("POST", "/regulatory/organization-permit/renewals", ids.admin, { requestedValidUntil: addDays(today, 400), statement: "Fleet and staffing unchanged. Please renew." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    requestId = r.body.data.id;
    r = await api("POST", "/regulatory/organization-permit/renewals", ids.admin, { requestedValidUntil: addDays(today, 400), statement: "Second request for renewal." });
    assert.equal(r.status, 409);
  });
  await step("company cannot read KCCA's renewal queue", async () => {
    assert.equal((await api("GET", "/regulatory/permit-renewals", ids.admin)).status, 403);
  });
  await step("KCCA rejects; the company is notified and may apply again", async () => {
    let r = await api("PATCH", `/regulatory/permit-renewals/${requestId}`, ids.kcca, { action: "reject", notes: "Submit updated fleet list" });
    assert.equal(r.status, 200);
    r = await api("GET", "/regulatory/organization-permit", ids.admin);
    assert.equal(r.body.data.notices[0].notice_type, "renewal_rejected");
    assert.equal(r.body.data.renewal.eligible, true);
  });
  await step("withdrawn requests close cleanly", async () => {
    let r = await api("POST", "/regulatory/organization-permit/renewals", ids.admin, { requestedValidUntil: addDays(today, 365), statement: "Draft sent by mistake." });
    r = await api("PATCH", `/regulatory/organization-permit/renewals/${r.body.data.id}/withdraw`, ids.admin);
    assert.equal(r.status, 200);
  });
  await step("KCCA approves a new request with its own date; permit, divisions and request are updated together", async () => {
    let r = await api("POST", "/regulatory/organization-permit/renewals", ids.admin, { requestedValidUntil: addDays(today, 400), statement: "Updated fleet list attached." });
    requestId = r.body.data.id;
    r = await api("PATCH", `/regulatory/permit-renewals/${requestId}`, ids.kcca, { action: "approve", notes: "Renewed for one year", validUntil: addDays(today, 365) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [permit] = await sql("SELECT valid_until::text v,renewal_count FROM organization_permit_applications WHERE id=$1", [ids.permit]);
    assert.equal(permit.v, addDays(today, 365));
    assert.equal(permit.renewal_count, 1);
    const [auth] = await sql("SELECT expires_on::text e,status FROM organization_division_authorizations WHERE permit_application_id=$1", [ids.permit]);
    assert.deepEqual(auth, { e: addDays(today, 365), status: "active" });
    const [request] = await sql("SELECT status,granted_valid_until::text g FROM permit_renewal_requests WHERE id=$1", [requestId]);
    assert.deepEqual(request, { status: "approved", g: addDays(today, 365) });
  });
  await step("renewal outside the 90-day window is refused with the opening date", async () => {
    const r = await api("POST", "/regulatory/organization-permit/renewals", ids.admin, { requestedValidUntil: addDays(today, 700), statement: "Too early for renewal." });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /You can apply from/);
  });

  console.log("Suspension and reinstatement");
  await step("suspension blocks route planning, divisions, the certificate and renewal", async () => {
    let r = await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.kcca, { action: "suspend", notes: "Repeated illegal dumping" });
    assert.equal(r.status, 200);
    assert.match(await blockReason(), /suspended/);
    assert.match(await tryRouteInsert(), /suspended/);
    const [auth] = await sql("SELECT status,suspended_by_permit FROM organization_division_authorizations WHERE permit_application_id=$1", [ids.permit]);
    assert.deepEqual(auth, { status: "suspended", suspended_by_permit: true });
    assert.equal((await api("GET", "/regulatory/organization-certificate/pdf", ids.admin)).status, 404);
    assert.equal((await api("GET", `/public/permit-verification/${code}`)).body.data.status, "suspended");
    r = await api("POST", "/regulatory/organization-permit/renewals", ids.admin, { requestedValidUntil: addDays(today, 700), statement: "Request while suspended." });
    assert.equal(r.status, 409);
  });
  await step("reinstatement restores exactly the divisions the suspension removed", async () => {
    const r = await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.kcca, { action: "reinstate", notes: "Corrective action verified" });
    assert.equal(r.status, 200);
    assert.equal(await blockReason(), null);
    const [auth] = await sql("SELECT status,suspended_by_permit FROM organization_division_authorizations WHERE permit_application_id=$1", [ids.permit]);
    assert.deepEqual(auth, { status: "active", suspended_by_permit: false });
  });

  console.log("Automatic expiry");
  await step("a lapsed permit expires automatically and stops operations", async () => {
    await sql("UPDATE organization_permit_applications SET valid_until=CURRENT_DATE-1 WHERE id=$1", [ids.permit]);
    assert.equal((await api("GET", `/public/permit-verification/${code}`)).body.data.status, "expired", "shown as expired even before the job runs");
    const r = await api("POST", "/regulatory/permit-lifecycle/run", ids.kcca);
    assert.ok(r.body.data.expired >= 1);
    const [permit] = await sql("SELECT status,expired_at IS NOT NULL AS stamped FROM organization_permit_applications WHERE id=$1", [ids.permit]);
    assert.deepEqual(permit, { status: "expired", stamped: true });
    const [entry] = await sql("SELECT changed_by,notes FROM organization_permit_history WHERE application_id=$1 ORDER BY created_at DESC LIMIT 1", [ids.permit]);
    assert.equal(entry.changed_by, null);
    assert.match(entry.notes, /Expired automatically/);
    assert.equal((await sql("SELECT status FROM organization_division_authorizations WHERE permit_application_id=$1", [ids.permit]))[0].status, "expired");
    assert.match(await tryRouteInsert(), /expired/);
  });
  await step("an expired permit can request renewal; KCCA renewing directly closes the request", async () => {
    let r = await api("POST", "/regulatory/organization-permit/renewals", ids.admin, { requestedValidUntil: addDays(today, 365), statement: "Our permit lapsed; please renew." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const pending = r.body.data.id;
    r = await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.kcca, { action: "renew", notes: "Renewed at the counter", validUntil: addDays(today, 200) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await sql("SELECT status FROM permit_renewal_requests WHERE id=$1", [pending]))[0].status, "approved");
    assert.equal(await blockReason(), null);
    assert.equal((await sql("SELECT status FROM organization_division_authorizations WHERE permit_application_id=$1", [ids.permit]))[0].status, "active");
  });

  console.log("Activity scope and audit");
  await step("removing collection activities blocks collection routes", async () => {
    const r = await api("PATCH", `/regulatory/permit-applications/${ids.permit}`, ids.kcca, { action: "update_activities", notes: "Transport only", activityCodes: ["waste_transport"] });
    assert.equal(r.status, 200);
    assert.match(await tryRouteInsert(), /does not authorize/);
  });
  await step("permit history is complete and cannot be altered", async () => {
    const r = await api("GET", `/regulatory/permit-applications/${ids.permit}/history`, ids.kcca);
    assert.ok(r.body.data.length >= 10, `history has ${r.body.data.length} entries`);
    await assert.rejects(sql("UPDATE organization_permit_history SET notes='edited' WHERE application_id=$1", [ids.permit]), /cannot be changed/);
  });
  await step("KCCA overview counts are served", async () => {
    const r = await api("GET", "/regulatory/permit-lifecycle/overview", ids.kcca);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data.no_permit_on_record));
  });
}

run()
  .then(() => console.log(`\nAll ${passed} checks passed.`))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch(e => console.error("Cleanup failed", e)); await pool.end(); });
