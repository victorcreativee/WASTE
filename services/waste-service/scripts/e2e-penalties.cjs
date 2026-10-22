// End-to-end check of Module 10 (fines and penalties) against a running waste-service and the local database with
// migrations 092–101 applied. Creates its own fixtures and removes or deactivates them afterwards.
//
//   E2E_BASE_URL=http://localhost:8193 npm run test:e2e:penalties
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-penalty-${Date.now()}`;
const ids = {}, notices = {};
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
const notice = async id => (await api("GET", `/penalties/notices/${id}`, ids.kcca)).body.data;
const noteFor = (user, key) => sql("SELECT category,severity,title,body FROM notifications WHERE recipient_user_id=$1 AND dedupe_key=$2", [user, key]);
const issue = body => api("POST", "/penalties/notices", ids.kcca, { organizationId: ids.collector, ...body });

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  const org = async name => (await sql(
    `INSERT INTO organizations(name,type,is_active,created_at,platform_package_id) VALUES($1,'waste_collection_company',true,'2026-08-01',(SELECT id FROM platform_packages WHERE code='collector_professional')) RETURNING id`,
    [`${name} ${tag}`]))[0].id;
  ids.collector = await org("E2E Fined Collectors");
  ids.other = await org("E2E Other Collectors");
  const user = async (name, roleName, organizationId) => {
    const id = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES($1,$2,'not-a-login','active',$3) RETURNING id",
      [name, `${tag}-${roleName}-${Math.random().toString(36).slice(2, 7)}@example.test`, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role(roleName)]);
    if (organizationId) await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  ids.kcca = await user("E2E KCCA Enforcement Officer", "kcca_admin", null);
  ids.system = await user("E2E System Admin", "system_admin", null);
  ids.admin = await user("E2E Fined Admin", "company_admin", ids.collector);
  ids.supervisor = await user("E2E Fined Supervisor", "supervisor", ids.collector);
  ids.otherAdmin = await user("E2E Other Admin", "company_admin", ids.other);
  ids.today = (await sql("SELECT CURRENT_DATE::text AS d"))[0].d;
  const permit = await api("POST", `/regulatory/organizations/${ids.collector}/permits`, ids.kcca, {
    registrationNumber: `E2E-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, contactName: "Grace Atim", email: "grace@example.test",
    phone: "+256700000005", address: "Plot 9, Port Bell Road", serviceDescription: "Household and commercial waste collection.",
    validUntil: addDays(ids.today, 300), activityCodes: ["household_collection"], notes: "Fleet inspected",
  });
  assert.equal(permit.status, 201, JSON.stringify(permit.body));
  ids.permit = permit.body.data.id;
  ids.site = (await sql(
    `INSERT INTO dumping_sites(location,landmark,responsible_organization_id,responsibility_basis)
     VALUES(ST_SetSRID(ST_MakePoint(32.6,0.33),4326)::geography,$1,$2,'Truck UBA 123X photographed offloading at the site.') RETURNING id`,
    [`E2E Kinawataka swamp ${tag}`, ids.collector]))[0].id;
  ids.schedule = Object.fromEntries((await sql("SELECT code,amount_ugx::float AS a,repeat_amount_ugx::float AS r,is_active FROM penalty_schedule")).map(s => [s.code, s]));
}

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map(r => r.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[]) OR organization_id=ANY($2::uuid[])", [users, orgs]);
  await sql("DELETE FROM penalty_notices WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM penalty_schedule_history WHERE changed_by=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM dumping_sites WHERE landmark LIKE $1", [`%${tag}`]);
  await sql("DELETE FROM organization_division_authorizations WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_permit_applications WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM notification_preferences WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  // Organization audit events are immutable by design, so the organizations are deactivated.
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

async function run() {
  await setup();
  const t = ids.today, s = ids.schedule;

  console.log("Penalty schedule");
  await step("everyone sees the published schedule; only KCCA changes it, and every change is recorded", async () => {
    const list = (await api("GET", "/penalties/schedule", ids.supervisor)).body.data;
    assert.ok(["DUMPING_ATTRIBUTED", "CLEANUP_NOT_DONE", "RETURN_LATE", "UNVERIFIED_DISPOSAL", "COMPLIANCE_UNANSWERED", "OPERATING_OUTSIDE_PERMIT"].every(code => list.some(i => i.code === code)));
    const original = s.RETURN_LATE;
    assert.equal((await api("PUT", "/penalties/schedule/RETURN_LATE", ids.admin, { amountUgx: 1, repeatAmountUgx: 2, isActive: true })).status, 403);
    assert.equal((await api("PUT", "/penalties/schedule/RETURN_LATE", ids.kcca, { amountUgx: 300000, repeatAmountUgx: 250000, isActive: true })).status, 400);
    let r = await api("PUT", "/penalties/schedule/RETURN_LATE", ids.kcca, { amountUgx: 300000, repeatAmountUgx: 600000, isActive: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await api("PUT", "/penalties/schedule/RETURN_LATE", ids.kcca, { amountUgx: original.a, repeatAmountUgx: original.r, isActive: original.is_active });
    assert.equal(r.body.data.amount_ugx, original.a);
    assert.equal((await sql("SELECT COUNT(*)::int AS n FROM penalty_schedule_history WHERE changed_by=$1", [ids.kcca]))[0].n, 2);
  });

  console.log("Issuing");
  await step("KCCA issues a notice tied to its evidence, with the schedule amount and dates; the company is told", async () => {
    assert.equal((await api("POST", "/penalties/notices", ids.supervisor, { organizationId: ids.collector, scheduleCode: "DUMPING_ATTRIBUTED", grounds: "x".repeat(30) })).status, 403);
    assert.equal((await issue({ scheduleCode: "DUMPING_ATTRIBUTED", grounds: "Too short" })).status, 400);
    assert.equal((await api("POST", "/penalties/notices", ids.kcca, { organizationId: ids.other, scheduleCode: "DUMPING_ATTRIBUTED", dumpingSiteId: ids.site, grounds: "Dumping at Kinawataka swamp, see the site record." })).status, 400, "the site is not linked to that company");
    const r = await issue({ scheduleCode: "DUMPING_ATTRIBUTED", dumpingSiteId: ids.site, grounds: "Dumping at Kinawataka swamp attributed on photographic evidence (truck UBA 123X)." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    notices.dumping = r.body.data.id;
    assert.deepEqual([r.body.data.amount_ugx, r.body.data.offence_number, r.body.data.dueOn, r.body.data.appealDeadline], [s.DUMPING_ATTRIBUTED.a, 1, addDays(t, 30), addDays(t, 14)]);
    const [note] = await noteFor(ids.admin, `penalty-issued:${notices.dumping}`);
    assert.equal(note.category, "penalties");
    assert.equal((await issue({ scheduleCode: "DUMPING_ATTRIBUTED", dumpingSiteId: ids.site, grounds: "Second notice for the very same dumping site." })).status, 409, "no double fine");
  });
  await step("a second offence of the same kind within a year is charged at the repeat amount", async () => {
    const r = await issue({ scheduleCode: "DUMPING_ATTRIBUTED", grounds: "Fresh dumping by the same truck at Nakawa market drainage, reported by KCCA officers." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    notices.repeat = r.body.data.id;
    assert.deepEqual([r.body.data.offence_number, r.body.data.amount_ugx], [2, s.DUMPING_ATTRIBUTED.r]);
  });
  await step("companies see only their own notices", async () => {
    const own = (await api("GET", "/penalties/notices", ids.admin)).body.data;
    assert.deepEqual(own.map(n => n.id).sort(), [notices.dumping, notices.repeat].sort());
    assert.equal((await api("GET", "/penalties/notices", ids.otherAdmin)).body.data.length, 0);
    assert.equal((await api("GET", `/penalties/notices/${notices.dumping}`, ids.otherAdmin)).status, 404);
    assert.equal((await api("GET", "/penalties/notices", ids.supervisor)).status, 403, "penalties are for company administrators");
    assert.equal((await api("GET", "/penalties/overview", ids.admin)).status, 403);
  });

  console.log("Appeals");
  await step("one appeal per notice; payment waits for the decision; KCCA reduces the amount with reasons", async () => {
    let r = await api("POST", `/penalties/notices/${notices.dumping}/appeal`, ids.admin, { grounds: "The truck UBA 123X was sold in August; transfer papers attached to our email." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await api("POST", `/penalties/notices/${notices.dumping}/appeal`, ids.admin, { grounds: "Second appeal on the same notice, should fail." })).status, 409);
    assert.equal((await api("POST", `/penalties/notices/${notices.dumping}/payment`, ids.admin, { reference: "PRN123456", paidOn: t })).status, 409);
    assert.equal((await noteFor(ids.kcca, `penalty-appeal:${notices.dumping}`)).length, 1);
    assert.equal((await api("PATCH", `/penalties/notices/${notices.dumping}/decide-appeal`, ids.kcca, { decision: "reduced", note: "Partly credible transfer papers." })).status, 400);
    r = await api("PATCH", `/penalties/notices/${notices.dumping}/decide-appeal`, ids.kcca, { decision: "reduced", newAmount: 1200000, note: "Sale papers show a transfer, but the company's livery was still on the truck." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const n = await notice(notices.dumping);
    assert.deepEqual([n.status, n.amount_ugx, n.original_amount_ugx, n.appeal.decision], ["issued", 1200000, s.DUMPING_ATTRIBUTED.a, "reduced"]);
    assert.ok(n.due_on >= addDays(t, 14));
    assert.equal((await noteFor(ids.admin, `penalty-decision:${notices.dumping}`))[0].severity, "warning");
  });

  console.log("Payment");
  await step("the company submits a payment; KCCA rejects one it cannot find, then confirms the next", async () => {
    assert.equal((await api("POST", `/penalties/notices/${notices.dumping}/payment`, ids.admin, { reference: "PRN123456", paidOn: addDays(t, 2) })).status, 400, "not in the future");
    let r = await api("POST", `/penalties/notices/${notices.dumping}/payment`, ids.admin, { reference: "PRN-WRONG-1", paidOn: t });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await api("PATCH", `/penalties/notices/${notices.dumping}/reject-payment`, ids.kcca, { reason: "No payment with this reference in the KCCA revenue system." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await api("POST", `/penalties/notices/${notices.dumping}/payment`, ids.admin, { reference: "PRN-2026-778899", paidOn: t });
    r = await api("PATCH", `/penalties/notices/${notices.dumping}/confirm-payment`, ids.kcca, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const n = await notice(notices.dumping);
    assert.deepEqual([n.status, n.payment_reference], ["paid", "PRN-2026-778899"]);
    assert.deepEqual(n.history.map(h => h.action), ["issued", "appealed", "appeal_reduced", "payment_submitted", "payment_rejected", "payment_submitted", "paid"]);
    await assert.rejects(sql("UPDATE penalty_notices SET status='issued' WHERE id=$1", [notices.dumping]), /cannot become issued/);
    await assert.rejects(sql("UPDATE penalty_notices SET amount_ugx=amount_ugx+1 WHERE id=$1", [notices.dumping]), /only be reduced/);
    await assert.rejects(sql("UPDATE penalty_history SET note='edited' WHERE notice_id=$1", [notices.dumping]), /cannot be changed/);
  });
  await step("KCCA withdraws a notice with reasons, and records a payment received at its counter", async () => {
    assert.equal((await api("PATCH", `/penalties/notices/${notices.repeat}/withdraw`, ids.kcca, { reason: "short" })).status, 400);
    let r = await api("PATCH", `/penalties/notices/${notices.repeat}/withdraw`, ids.kcca, { reason: "Officer's report could not identify the vehicle." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await issue({ scheduleCode: "RETURN_LATE", returnPeriod: "2026-09", grounds: "The September 2026 monthly return was not filed by 15 October 2026." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.offence_number, 1);
    notices.late = r.body.data.id;
    assert.equal((await api("PATCH", `/penalties/notices/${notices.late}/confirm-payment`, ids.kcca, {})).status, 400, "reference needed");
    r = await api("PATCH", `/penalties/notices/${notices.late}/confirm-payment`, ids.kcca, { reference: "KCCA-CASH-0042", paidOn: t });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await issue({ scheduleCode: "RETURN_LATE", returnPeriod: "2026-09", grounds: "The same September 2026 return, fined a second time." })).status, 409);
  });

  console.log("Overdue and escalation");
  await step("an overdue notice is flagged once; after 30 more days KCCA can suspend the permit, once", async () => {
    let r = await issue({ scheduleCode: "COMPLIANCE_UNANSWERED", grounds: "Compliance notice on missed collections in Nakawa was not acted on by its due date." });
    notices.unpaid = r.body.data.id;
    assert.equal((await api("PATCH", `/penalties/notices/${notices.unpaid}/escalate`, ids.kcca, {})).status, 409, "not yet");
    await sql("UPDATE penalty_notices SET due_on=CURRENT_DATE-31 WHERE id=$1", [notices.unpaid]);
    await api("POST", "/notifications/run-checks", ids.system);
    await api("POST", "/notifications/run-checks", ids.system);
    const key = `penalty-overdue:${notices.unpaid}:${addDays(t, -31)}`;
    assert.equal((await noteFor(ids.admin, key)).length, 1);
    assert.equal((await noteFor(ids.kcca, `penalty-escalate:${notices.unpaid}:${addDays(t, -31)}`)).length, 1);
    const eligible = (await api("GET", `/penalties/notices?status=escalate&organizationId=${ids.collector}`, ids.kcca)).body.data;
    assert.deepEqual(eligible.map(n => n.id), [notices.unpaid]);
    r = await api("PATCH", `/penalties/notices/${notices.unpaid}/escalate`, ids.kcca, { note: "Two reminders sent." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await sql("SELECT status FROM organization_permit_applications WHERE id=$1", [ids.permit]))[0].status, "suspended");
    assert.equal((await api("PATCH", `/penalties/notices/${notices.unpaid}/escalate`, ids.kcca, {})).status, 409);
  });
  await step("paying an escalated fine tells KCCA the permit can be reinstated", async () => {
    await api("POST", `/penalties/notices/${notices.unpaid}/payment`, ids.admin, { reference: "PRN-2026-990011", paidOn: t });
    await api("PATCH", `/penalties/notices/${notices.unpaid}/confirm-payment`, ids.kcca, {});
    assert.equal((await noteFor(ids.kcca, `penalty-paid-escalated:${notices.unpaid}`)).length, 1);
    assert.match((await noteFor(ids.admin, `penalty-paid:${notices.unpaid}`))[0].body, /reinstate your permit/);
  });

  console.log("Overviews");
  await step("KCCA sees amounts issued, collected and outstanding; the company sees its own summary", async () => {
    const o = (await api("GET", "/penalties/overview?period=30d", ids.kcca)).body.data;
    assert.ok(o.totals.issued >= 4 && o.totals.collected_ugx >= 1200000 + s.RETURN_LATE.a + s.COMPLIANCE_UNANSWERED.a);
    assert.ok(o.schedule.some(i => i.code === "DUMPING_ATTRIBUTED" && i.notices >= 2));
    const mine = (await api("GET", "/penalties/company/summary", ids.admin)).body.data;
    assert.deepEqual([mine.open, mine.outstanding_ugx, mine.paid_last_year], [0, 0, 1200000 + s.RETURN_LATE.a + s.COMPLIANCE_UNANSWERED.a]);
  });
}

// E2E_KEEP=1 leaves the fixtures for a manual look; E2E_CLEANUP_TAG=<tag> E2E_CLEANUP_ONLY=1 removes them later.
(process.env.E2E_CLEANUP_ONLY ? Promise.resolve(console.log(`Cleaning up ${tag}`)) : run().then(() => console.log(`\nAll ${passed} checks passed.`)))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => {
    if (process.env.E2E_KEEP) console.log(`Fixtures kept (${tag}). Remove with: E2E_CLEANUP_TAG=${tag} E2E_CLEANUP_ONLY=1 node scripts/e2e-penalties.cjs`);
    else await cleanup().catch(e => console.error("Cleanup failed", e));
    await pool.end();
  });
