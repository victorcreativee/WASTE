// End-to-end check of Module 12 (Waste Management SaaS subscriptions) against a running waste-service and the local
// database with migrations 092–103 applied. Creates its own fixtures and removes or deactivates them afterwards.
//
//   E2E_BASE_URL=http://localhost:8193 npm run test:e2e:subscriptions
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-saas-${Date.now()}`;
const ids = {};
let passed = 0, plateNo = 0;

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
const sub = orgId => sql("SELECT status,billing_cycle,current_period_start::text AS s,current_period_end::text AS e,pending_package_id,cancel_at_period_end,(SELECT code FROM platform_packages WHERE id=package_id) AS plan FROM organization_subscriptions WHERE organization_id=$1", [orgId]).then(r => r[0]);
const invoices = orgId => sql("SELECT id,kind,status,amount_ugx::float AS amount,due_on::text AS due FROM subscription_invoices WHERE organization_id=$1 ORDER BY issued_at", [orgId]);
const truck = orgId => sql("INSERT INTO waste_trucks(organization_id,plate_number,truck_name,status) VALUES($1,$2,'E2E truck','available') RETURNING id", [orgId, `US${tag.replace(/\D/g, "").slice(-3)}${++plateNo}Z`]);
const runBilling = () => api("POST", "/saas/run-billing", ids.platform);

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  const org = async (name, type, plan) => (await sql(
    `INSERT INTO organizations(name,type,is_active,created_at,platform_package_id) VALUES($1,$2,true,'2026-08-01',(SELECT id FROM platform_packages WHERE code=$3)) RETURNING id`,
    [`${name} ${tag}`, type, plan]))[0].id;
  ids.alpha = await org("E2E Alpha Collectors", "waste_collection_company", "collector_standard");
  ids.beta = await org("E2E Beta Collectors", "waste_collection_company", "collector_standard");
  ids.gamma = await org("E2E Gamma Collectors", "waste_collection_company", "collector_standard");
  const user = async (name, roleName, organizationId) => {
    const id = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES($1,$2,'not-a-login','active',$3) RETURNING id",
      [name, `${tag}-${roleName}-${Math.random().toString(36).slice(2, 7)}@example.test`, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role(roleName)]);
    if (organizationId) await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  ids.platform = await user("E2E Platform Admin", "system_admin", null);
  ids.alphaAdmin = await user("E2E Alpha Admin", "company_admin", ids.alpha);
  ids.alphaSupervisor = await user("E2E Alpha Supervisor", "supervisor", ids.alpha);
  ids.betaAdmin = await user("E2E Beta Admin", "company_admin", ids.beta);
  ids.gammaAdmin = await user("E2E Gamma Admin", "company_admin", ids.gamma);
  ids.applicant = await user("E2E Applicant", "organization_applicant", null);
  ids.today = (await sql("SELECT CURRENT_DATE::text AS d"))[0].d;
  ids.plans = Object.fromEntries((await sql("SELECT code,id,monthly_fee_ugx::float AS m,annual_fee_ugx::float AS a FROM platform_packages")).map(p => [p.code, p]));
}

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map(r => r.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[]) OR organization_id=ANY($2::uuid[])", [users, orgs]);
  await sql("DELETE FROM subscription_invoices WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM subscription_events WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_subscriptions WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM waste_trucks WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_account_applications WHERE applicant_user_id=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM organization_applicant_profiles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM notification_preferences WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)',organization_id=NULL WHERE id=ANY($1::uuid[])", [users]);
  // Organization audit events are immutable by design, so the organizations are deactivated.
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

async function run() {
  await setup();
  const t = ids.today, P = ids.plans;

  console.log("Plans and sign-up");
  await step("the public plan list shows prices and limits for each type of company, without signing in", async () => {
    const r = await api("GET", "/public/plans?type=waste_collection_company");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const standard = r.body.data.find(p => p.code === "collector_standard");
    assert.deepEqual([standard.monthly_fee_ugx, standard.max_vehicles, standard.trial_days], [P.collector_standard.m, 5, 30]);
    assert.ok(!r.body.data.some(p => p.code === "core_collector"), "legacy plans are not offered");
    assert.ok(r.body.data.every(p => p.organization_type === "waste_collection_company"));
  });
  await step("approving a company's account application starts its trial on the plan it chose", async () => {
    await sql("INSERT INTO organization_applicant_profiles(user_id,company_name,registration_number,company_type) VALUES($1,$2,$3,'recycling_company')",
      [ids.applicant, `E2E Gamma Recyclers ${tag}`, `REG-${tag.slice(-6)}`]);
    const app = (await sql(
      `INSERT INTO organization_account_applications(application_number,requested_package_id,administrator_name,administrator_email,administrator_phone,applicant_user_id,evidence_type,certificate_file_name,certificate_mime_type,certificate_file_data)
       VALUES($1,$2,'E2E Applicant','applicant@example.test','+256700000007',$3,'company_registration','reg.pdf','application/pdf','data:application/pdf;base64,JVBERi0xLjQK') RETURNING id`,
      [`ACC-${tag.slice(-8)}`, P.recycling_standard.id, ids.applicant]))[0].id;
    const r = await api("PATCH", `/regulatory/account-applications/${app}`, ids.platform, { action: "approve", notes: "Registration verified" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    ids.recycler = (await sql("SELECT organization_id FROM organization_account_applications WHERE id=$1", [app]))[0].organization_id;
    const s = await sub(ids.recycler);
    assert.deepEqual([s.status, s.plan, s.e], ["trialing", "recycling_standard", addDays(t, 30)]);
  });

  console.log("Trial, plan and limits");
  await step("the platform starts a trial for a company that has none; plan limits apply to vehicles", async () => {
    assert.ok((await api("GET", "/saas/unsubscribed", ids.platform)).body.data.some(o => o.id === ids.alpha));
    let r = await api("POST", "/saas/subscriptions", ids.platform, { organizationId: ids.alpha, planCode: "collector_standard", mode: "trial" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.status, "trialing");
    assert.equal((await api("POST", "/saas/subscriptions", ids.platform, { organizationId: ids.alpha, planCode: "collector_standard", mode: "trial" })).status, 409);
    for (let i = 0; i < 5; i++) await truck(ids.alpha);
    await assert.rejects(truck(ids.alpha), /Standard plan allows 5 vehicles/);
    const mine = (await api("GET", "/subscription", ids.alphaAdmin)).body.data;
    assert.deepEqual([mine.subscription.status, mine.subscription.trial_days_left, mine.usage.vehicles], ["trialing", 30, 5]);
  });
  await step("during the trial a company moves between plans at once; a plan that does not fit its fleet is refused", async () => {
    let r = await api("PATCH", "/subscription/plan", ids.alphaAdmin, { planCode: "collector_professional" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.data.timing, r.body.data.invoice ?? null], ["now", null]);
    assert.equal((await sql("SELECT p.code FROM organizations o JOIN platform_packages p ON p.id=o.platform_package_id WHERE o.id=$1", [ids.alpha]))[0].code, "collector_professional", "features follow the plan");
    await truck(ids.alpha);
    r = await api("PATCH", "/subscription/plan", ids.alphaAdmin, { planCode: "collector_standard" });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /6 vehicles \(the plan allows 5\)/);
    assert.equal((await api("PATCH", "/subscription/plan", ids.alphaAdmin, { planCode: "recycling_standard" })).status, 400, "not for collectors");
    assert.equal((await api("GET", "/subscription", ids.alphaSupervisor)).status, 403, "billing is for company administrators");
  });

  console.log("Billing");
  await step("when the trial ends the first period is invoiced; the company is told", async () => {
    await sql("UPDATE organization_subscriptions SET trial_ends_at=CURRENT_TIMESTAMP-interval '1 minute' WHERE organization_id=$1", [ids.alpha]);
    const r = await runBilling();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = await sub(ids.alpha);
    assert.deepEqual([s.status, s.s, s.e], ["active", t, (await sql("SELECT (CURRENT_DATE+interval '1 month')::date::text AS d"))[0].d]);
    const [invoice] = await invoices(ids.alpha);
    assert.deepEqual([invoice.kind, invoice.amount, invoice.due, invoice.status], ["period", P.collector_professional.m, addDays(t, 7), "open"]);
    assert.equal((await sql("SELECT COUNT(*)::int AS n FROM notifications WHERE recipient_user_id=$1 AND category='billing'", [ids.alphaAdmin]))[0].n, 1);
  });
  await step("an upgrade mid-period is charged for the days left; a downgrade waits for the period end", async () => {
    await api("POST", "/saas/subscriptions", ids.platform, { organizationId: ids.beta, planCode: "collector_standard", mode: "trial" });
    await sql("UPDATE organization_subscriptions SET trial_ends_at=CURRENT_TIMESTAMP-interval '1 minute' WHERE organization_id=$1", [ids.beta]);
    await runBilling();
    let r = await api("PATCH", "/subscription/plan", ids.betaAdmin, { planCode: "collector_professional" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.invoice.amount_ugx, P.collector_professional.m - P.collector_standard.m, "a whole period left");
    r = await api("PATCH", "/subscription/plan", ids.alphaAdmin, { planCode: "collector_professional", billingCycle: "annual" });
    assert.deepEqual([r.status, r.body.data.timing], [200, "period_end"]);
    assert.equal((await sub(ids.alpha)).billing_cycle, "monthly", "annual billing starts next period");
  });
  await step("the company submits a payment; the platform rejects one it cannot find and confirms the next", async () => {
    const [invoice] = await invoices(ids.alpha);
    assert.equal((await api("POST", `/subscription/invoices/${invoice.id}/payment`, ids.betaAdmin, { reference: "MM-123456", paidOn: t })).status, 404);
    let r = await api("POST", `/subscription/invoices/${invoice.id}/payment`, ids.alphaAdmin, { reference: "MM-WRONG", paidOn: t });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await api("PATCH", `/saas/invoices/${invoice.id}/reject-payment`, ids.platform, { reason: "No mobile money payment with this reference" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await api("POST", `/subscription/invoices/${invoice.id}/payment`, ids.alphaAdmin, { reference: "MM-778899001", paidOn: t });
    r = await api("PATCH", `/saas/invoices/${invoice.id}/confirm`, ids.platform, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await invoices(ids.alpha))[0].status, "paid");
    await assert.rejects(sql("UPDATE subscription_invoices SET amount_ugx=1 WHERE id=$1", [invoice.id]), /cannot be changed/);
  });

  console.log("Non-payment and cancellation");
  await step("an unpaid invoice makes the subscription past due, then read-only, until it is paid", async () => {
    await sql("UPDATE subscription_invoices SET due_on=CURRENT_DATE-1 WHERE organization_id=$1 AND status='open'", [ids.beta]);
    await runBilling();
    assert.equal((await sub(ids.beta)).status, "past_due");
    assert.equal((await api("POST", "/service-areas/zones", ids.betaAdmin, {})).status === 402, false, "past due still works");
    await sql("UPDATE subscription_invoices SET due_on=CURRENT_DATE-15 WHERE organization_id=$1 AND status='open'", [ids.beta]);
    await runBilling();
    assert.equal((await sub(ids.beta)).status, "suspended");
    const [note] = await sql("SELECT severity FROM notifications WHERE recipient_user_id=$1 AND title LIKE 'Subscription suspended%'", [ids.betaAdmin]);
    assert.equal(note.severity, "critical");
    let r = await api("POST", "/service-areas/zones", ids.betaAdmin, {});
    assert.equal(r.status, 402);
    assert.equal(r.body.code, "subscription_inactive");
    assert.equal((await api("GET", "/subscription", ids.betaAdmin)).status, 200, "reading still works");
    for (const invoice of await invoices(ids.beta)) {
      if (invoice.status !== "open") continue;
      r = await api("POST", `/subscription/invoices/${invoice.id}/payment`, ids.betaAdmin, { reference: `MM-${invoice.id.slice(0, 8)}`, paidOn: t });
      assert.equal(r.status, 200, "paying is always allowed");
      await api("PATCH", `/saas/invoices/${invoice.id}/confirm`, ids.platform, {});
    }
    assert.equal((await sub(ids.beta)).status, "active");
  });
  await step("a cancelled subscription ends with the period; the platform can bring it back", async () => {
    assert.equal((await api("POST", "/subscription/cancel", ids.alphaAdmin)).status, 200);
    assert.equal((await api("POST", "/subscription/cancel", ids.alphaAdmin)).status, 409);
    await sql("UPDATE organization_subscriptions SET current_period_start=CURRENT_DATE-31,current_period_end=CURRENT_DATE WHERE organization_id=$1", [ids.alpha]);
    await runBilling();
    assert.equal((await sub(ids.alpha)).status, "cancelled");
    assert.equal((await api("POST", "/service-areas/zones", ids.alphaAdmin, {})).status, 402);
    const r = await api("PATCH", `/saas/subscriptions/${ids.alpha}`, ids.platform, { action: "reactivate", reason: "Company asked to come back" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([(await sub(ids.alpha)).status, (await sub(ids.alpha)).s], ["active", t]);
  });

  console.log("Platform administration");
  await step("the platform extends trials, gives complimentary access without limits, and starts billing", async () => {
    await api("POST", "/saas/subscriptions", ids.platform, { organizationId: ids.gamma, planCode: "collector_standard", mode: "trial" });
    let r = await api("PATCH", `/saas/subscriptions/${ids.gamma}`, ids.platform, { action: "extend_trial", days: 10 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await sub(ids.gamma)).e, addDays(t, 40));
    r = await api("PATCH", `/saas/subscriptions/${ids.gamma}`, ids.platform, { action: "make_complimentary", reason: "Pilot partner for Nakawa" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (let i = 0; i < 6; i++) await truck(ids.gamma);
    r = await api("PATCH", `/saas/subscriptions/${ids.gamma}`, ids.platform, { action: "start_billing" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [invoice] = await invoices(ids.gamma);
    assert.deepEqual([(await sub(ids.gamma)).status, invoice.amount], ["active", P.collector_standard.m]);
  });
  await step("the platform sees recurring revenue and statuses; companies see only their own billing", async () => {
    const o = (await api("GET", "/saas/overview", ids.platform)).body.data;
    assert.ok(o.mrr_ugx >= P.collector_professional.m * 2 + P.collector_standard.m);
    assert.ok(o.counts.active >= 3 && o.counts.trialing >= 1);
    assert.equal((await api("GET", "/saas/overview", ids.alphaAdmin)).status, 403);
    const own = (await api("GET", "/subscription/invoices", ids.betaAdmin)).body.data;
    assert.ok(own.length >= 2 && own.every(i => i.organization_id === ids.beta));
    const events = (await api("GET", `/saas/subscriptions/${ids.beta}`, ids.platform)).body.data.events.map(e => e.action);
    assert.ok(["started", "trial_ended", "plan_changed", "past_due", "suspended", "restored"].every(a => events.includes(a)), events.join(","));
  });
}

// E2E_KEEP=1 leaves the fixtures for a manual look; E2E_CLEANUP_TAG=<tag> E2E_CLEANUP_ONLY=1 removes them later.
(process.env.E2E_CLEANUP_ONLY ? Promise.resolve(console.log(`Cleaning up ${tag}`)) : run().then(() => console.log(`\nAll ${passed} checks passed.`)))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => {
    if (process.env.E2E_KEEP) console.log(`Fixtures kept (${tag}). Remove with: E2E_CLEANUP_TAG=${tag} E2E_CLEANUP_ONLY=1 node scripts/e2e-subscriptions.cjs`);
    else await cleanup().catch(e => console.error("Cleanup failed", e));
    await pool.end();
  });
