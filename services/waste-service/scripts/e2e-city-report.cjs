// End-to-end check of Module 4 (KCCA city report, insights and issued snapshots) against a running waste-service and a
// local database with migrations 092–095 applied. Uses September 2026 (previous: August) for the figures and January 2020
// for issuing, so it never collides with a real issued report. Fixtures are removed afterwards; the test's own issued
// reports are deleted by briefly lifting the protection trigger inside one local transaction.
//
//   PORT=8193 PERMIT_LIFECYCLE_SCHEDULER=off npm run dev      (in one terminal)
//   E2E_BASE_URL=http://localhost:8193 npm run test:e2e:city-report
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-report-${Date.now()}`;
const ids = { reports: [] };
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

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  const org = async name => (await sql("INSERT INTO organizations(name,type,is_active,created_at) VALUES($1,'waste_collection_company',true,'2026-07-01') RETURNING id", [`${name} ${tag}`]))[0].id;
  ids.alpha = await org("E2E Alpha Collectors");
  ids.beta = await org("E2E Beta Collectors");
  const user = async (name, roleName, organizationId) => {
    const id = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES($1,$2,'not-a-login','active',$3) RETURNING id",
      [name, `${tag}-${roleName}-${Math.random().toString(36).slice(2, 7)}@example.test`, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role(roleName)]);
    if (organizationId) await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  ids.kcca = await user("E2E KCCA Officer", "kcca_admin", null);
  ids.system = await user("E2E System Admin", "system_admin", null);
  ids.alphaAdmin = await user("E2E Alpha Admin", "company_admin", ids.alpha);

  // Alpha holds a permit issued in September; Beta has none.
  ids.permit = (await sql(`INSERT INTO organization_permit_applications(application_number,organization_id,company_name,registration_number,contact_name,email,phone,address,service_description,status,submitted_at,permit_number,valid_from,valid_until)
    VALUES($1,$2,'E2E Alpha','E2E-ALPHA-${Date.now()}','A','a@example.test','+256700000002','Kampala','Household collection in Kampala.','approved','2026-09-01',$3,'2026-09-05','2027-09-04') RETURNING id`,
    [`${tag}-APP`, ids.alpha, `PERMIT-E2E-${Date.now().toString().slice(-7)}`]))[0].id;
  await sql("INSERT INTO organization_permit_activities(permit_application_id,activity_code) VALUES($1,'household_collection')", [ids.permit]);
  await sql("INSERT INTO organization_permit_history(application_id,previous_status,new_status,notes,created_at) VALUES($1,'approved','approved','Permit issued directly by KCCA to E2E Alpha.','2026-09-05 09:00+03')", [ids.permit]);

  const jobs = (orgId, date, status, n) => sql(`INSERT INTO collection_jobs(organization_id,job_date,status) SELECT $1,$2::date,$3 FROM generate_series(1,$4)`, [orgId, date, status, n]);
  await jobs(ids.alpha, "2026-09-10", "completed", 17); await jobs(ids.alpha, "2026-09-11", "missed", 3);
  await jobs(ids.alpha, "2026-08-10", "completed", 19); await jobs(ids.alpha, "2026-08-11", "missed", 1);
  await jobs(ids.beta, "2026-09-12", "completed", 4); await jobs(ids.beta, "2026-09-12", "missed", 6);
  await jobs(ids.beta, "2026-09-13", "cancelled", 5);
  const trip = (orgId, verified) => sql(`INSERT INTO collection_routes(organization_id,name,route_date,status,weight_verified_at) VALUES($1,'E2E trip','2026-09-10','completed',$2)`, [orgId, verified ? "2026-09-10 16:00+03" : null]);
  await trip(ids.alpha, true); await trip(ids.alpha, true); await trip(ids.alpha, true); await trip(ids.alpha, false); await trip(ids.beta, false);
  const ticket = (orgId, date, kg, n) => sql(`INSERT INTO weighbridge_transactions(organization_id,ticket_number,facility,registration,normalized_registration,operation_date,arrival_at,gross_kg,tare_kg,net_kg,status)
    VALUES($1,$2,'Kiteezi','UBC 003E','UBC003E',$3,$3::date+interval '10 hours',$4+10000,10000,$4,'completed')`, [orgId, `${tag}-T${n}`, date, kg]);
  await ticket(ids.alpha, "2026-09-10", 30000, 1); await ticket(ids.alpha, "2026-08-10", 20000, 2);
  const issue = (category, created, resolved) => sql(`INSERT INTO citizen_issues(reporter_user_id,assigned_organization_id,category,title,description,status,created_at,resolved_at)
    VALUES($1,$2,$3,'E2E issue','Reported for the city report test.',$4,$5,$6)`, [ids.kcca, ids.alpha, category, resolved ? "resolved" : "assigned", created, resolved]);
  await issue("missed_collection", "2026-09-02 08:00", "2026-09-02 18:00");
  await issue("missed_collection", "2026-09-03 08:00", "2026-09-04 14:00");
  await issue("overflowing_bin", "2026-09-05 08:00", "2026-09-05 13:00");
  await issue("pickup_request", "2026-09-29 10:00", null);
  await sql(`INSERT INTO collector_compliance_cases(case_number,organization_id,category,severity,title,details,required_action,due_date,created_by,created_at)
    VALUES($1,$2,'service_delivery','critical','Missed collections','Six missed collections in one day.','Recover the missed collections.','2026-09-20',$3,'2026-09-12 12:00+03')`, [`${tag}-C1`, ids.beta, ids.kcca]);
}

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map(r => r.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  const reports = (await sql("SELECT id FROM city_reports WHERE issued_by=ANY($1::uuid[])", [users])).map(r => r.id);
  if (reports.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE city_reports DISABLE TRIGGER trg_protect_city_report");
      await client.query("DELETE FROM city_reports WHERE id=ANY($1::uuid[])", [reports]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("ALTER TABLE city_reports ENABLE TRIGGER trg_protect_city_report");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  await sql("DELETE FROM regulatory_returns WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM citizen_issues WHERE assigned_organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM collection_jobs WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM collection_routes WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM weighbridge_transactions WHERE organization_id=ANY($1::uuid[]) OR ticket_number LIKE $2", [orgs, `${tag}-%`]);
  await sql("DELETE FROM organization_permit_applications WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  // Compliance cases and organization audit events are immutable by design, so the organizations are deactivated.
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

async function run() {
  // Baseline taken before any fixture data exists, by a KCCA account (created when the database has none, e.g. in CI).
  let probe = (await sql("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='kcca_admin' AND u.status='active' LIMIT 1"))[0]?.id;
  if (!probe) {
    probe = (await sql("INSERT INTO users(full_name,email,password_hash,status) VALUES('E2E Baseline Officer',$1,'not-a-login','active') RETURNING id", [`${tag}-baseline@example.test`]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='kcca_admin'", [probe]);
  }
  const before = (await api("GET", "/city-reports/live?period=2026-09", probe)).body.data;
  await setup();
  const baseline = before.headline.current, baselinePrev = before.headline.previous;
  let report;

  console.log("Access and periods");
  await step("only KCCA and system administrators can read city reports", async () => {
    assert.equal((await api("GET", "/city-reports/live?period=2026-09")).status, 401);
    assert.equal((await api("GET", "/city-reports/live?period=2026-09", ids.alphaAdmin)).status, 403);
    assert.equal((await api("GET", "/city-reports/live?period=2026-09", ids.system)).status, 200);
  });
  await step("periods resolve, and future or malformed periods are refused", async () => {
    const q = await api("GET", "/city-reports/live?period=2026-Q3", ids.kcca);
    assert.equal(q.status, 200);
    assert.deepEqual([q.body.data.period.from, q.body.data.period.to, q.body.data.period.previous.key], ["2026-07-01", "2026-09-30", "2026-Q2"]);
    assert.equal((await api("GET", "/city-reports/live?period=2030-01", ids.kcca)).status, 400);
    assert.equal((await api("GET", "/city-reports/live?period=2026-13", ids.kcca)).status, 400);
  });

  console.log("Figures for September 2026");
  await step("headline figures and change on August", async () => {
    report = (await api("GET", "/city-reports/live?period=2026-09", ids.kcca)).body.data;
    const c = report.headline.current, p = report.headline.previous;
    assert.equal(c.jobs_scheduled - baseline.jobs_scheduled, 30, "cancelled jobs are not scheduled work");
    assert.equal(c.jobs_completed - baseline.jobs_completed, 21);
    assert.equal(c.jobs_missed - baseline.jobs_missed, 9);
    assert.equal(c.trips_completed - baseline.trips_completed, 5);
    assert.equal(c.trips_verified - baseline.trips_verified, 3);
    assert.equal(c.disposed_kg - baseline.disposed_kg, 30000);
    assert.equal(p.disposed_kg - baselinePrev.disposed_kg, 20000);
    assert.equal(c.issues_received - baseline.issues_received, 4);
    assert.equal(c.issues_resolved - baseline.issues_resolved, 3);
    assert.equal(c.cases_opened - baseline.cases_opened, 1);
  });
  await step("resident issues are measured against KCCA's standards by category", async () => {
    const missed = report.issues.by_category.find(x => x.category === "missed_collection");
    assert.ok(missed.received >= 2 && missed.resolved >= 2);
    assert.equal(missed.standard_hours, 24);
    if (baseline.issues_resolved === 0) {
      assert.equal(report.headline.current.within_standard_rate, 66.7, "2 of 3 resolved issues within standard");
      assert.equal(report.headline.current.median_resolution_hours, 10);
    }
  });
  await step("licensing counts the September permit and lists the unlicensed collector", async () => {
    assert.ok(report.licensing.issued - before.licensing.issued === 1);
    assert.ok(report.licensing.no_permit_on_record.some(o => o.name === `E2E Beta Collectors ${tag}`));
  });
  await step("the collector league table scores and ranks service", async () => {
    const alpha = report.collectors.find(c => c.id === ids.alpha), beta = report.collectors.find(c => c.id === ids.beta);
    assert.deepEqual([alpha.jobs, alpha.completed_jobs, alpha.completed_trips, alpha.unverified_trips, alpha.open_issues, alpha.overdue_issues], [20, 17, 4, 1, 4, 1]);
    assert.deepEqual([alpha.compliance_state, alpha.service_score, alpha.band], ["compliant", 84, "watch"]);
    assert.deepEqual([beta.jobs, beta.compliance_state, beta.service_score, beta.band, beta.critical_compliance_cases], [10, "permit_missing", 35, "action_required", 1]);
    assert.ok(report.collectors.indexOf(alpha) < report.collectors.indexOf(beta));
  });
  await step("divisions, accountability and six-month trend are included", async () => {
    assert.ok(report.collection.by_division.some(d => d.division === "Not linked to a division" && d.scheduled >= 30));
    assert.ok(report.accountability.cases.some(c => c.category === "service_delivery" && c.opened >= 1));
    assert.deepEqual(report.trend.map(m => m.month), ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    assert.ok(report.trend.at(-1).disposed_kg >= 30000);
  });
  await step("returns filing for September counts both collectors", async () => {
    let r = await api("POST", "/regulatory/returns", ids.alphaAdmin, { period: "2026-09", declarantName: "Ann Alpha", declarantTitle: "Director", confirm: true,
      figures: { customers_served: 0, trips_completed: 4, collections_completed: 17, collections_missed: 3, waste_disposed_kg: 30000, disposal_site: "Kiteezi", vehicles_operated: 1, staff_employed: 1, complaints_received: 4, complaints_resolved: 3 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const after = (await api("GET", "/city-reports/live?period=2026-09", ids.kcca)).body.data;
    assert.equal(after.headline.current.returns_required - baseline.returns_required, 2);
    assert.equal(after.headline.current.returns_filed - baseline.returns_filed, 1);
    assert.equal(after.headline.current.returns_on_time - baseline.returns_on_time, 0, "filed after 15 October");
  });
  await step("insights name the problems in plain language, most serious first", async () => {
    const insights = report.insights;
    const ids_ = insights.map(i => i.id);
    assert.ok(ids_.includes("collectors_action"));
    assert.match(insights.find(i => i.id === "collectors_action").detail, new RegExp(`E2E Beta Collectors ${tag}`));
    assert.ok(ids_.includes("unlicensed"));
    const order = { risk: 0, attention: 1, positive: 2 };
    assert.deepEqual(insights.map(i => order[i.tone]), [...insights.map(i => order[i.tone])].sort());
  });
  await step("the collector table exports to CSV", async () => {
    const r = await api("GET", "/city-reports/live/export.csv?period=2026-09", ids.kcca);
    assert.match(r.type, /text\/csv/);
    assert.match(r.body.split("\r\n").find(l => l.includes(`E2E Beta Collectors ${tag}`)), /,10,4,6,40,1,0,0,0,0,1,35,action_required$/);
  });

  console.log("Issuing official reports");
  await step("an incomplete period cannot be issued, and only KCCA admins issue", async () => {
    const current = (await sql("SELECT to_char(CURRENT_DATE,'YYYY-MM') AS p"))[0].p;
    assert.equal((await api("POST", "/city-reports", ids.kcca, { period: current })).status, 400);
    assert.equal((await api("POST", "/city-reports", ids.system, { period: "2020-01" })).status, 403);
  });
  let first;
  await step("KCCA issues a numbered report with commentary", async () => {
    const r = await api("POST", "/city-reports", ids.kcca, { period: "2020-01", commentary: "Test issue for January 2020." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    first = r.body.data;
    assert.match(first.report_number, /^KCCA-CR-2020-01/);
  });
  await step("the issued report is frozen while live figures move on", async () => {
    await sql(`INSERT INTO weighbridge_transactions(organization_id,ticket_number,facility,registration,normalized_registration,operation_date,arrival_at,gross_kg,tare_kg,net_kg,status)
      VALUES($1,$2,'Kiteezi','UBC 004E','UBC004E','2020-01-15','2020-01-15 10:00',15000,10000,5000,'completed')`, [ids.alpha, `${tag}-T9`]);
    const issued = (await api("GET", `/city-reports/${first.id}`, ids.kcca)).body.data;
    const live = (await api("GET", "/city-reports/live?period=2020-01", ids.kcca)).body.data;
    assert.equal(live.headline.current.disposed_kg - issued.data.headline.current.disposed_kg, 5000);
    assert.equal(issued.commentary, "Test issue for January 2020.");
    await assert.rejects(sql("UPDATE city_reports SET commentary='edited' WHERE id=$1", [first.id]), /cannot be changed/);
    await assert.rejects(sql("DELETE FROM city_reports WHERE id=$1", [first.id]), /cannot be deleted/);
  });
  await step("a second issue needs a reason and supersedes the first", async () => {
    assert.equal((await api("POST", "/city-reports", ids.kcca, { period: "2020-01" })).status, 409);
    const r = await api("POST", "/city-reports", ids.kcca, { period: "2020-01", replaceReason: "Late weighbridge ticket added" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.data.report_number, /^KCCA-CR-2020-01-R1$/);
    const list = (await api("GET", "/city-reports", ids.kcca)).body.data.filter(x => x.period_key === "2020-01");
    const old = list.find(x => x.id === first.id), replacement = list.find(x => x.id === r.body.data.id);
    assert.deepEqual([old.status, old.superseded_by_number, old.superseded_reason], ["superseded", replacement.report_number, "Late weighbridge ticket added"]);
    assert.equal(replacement.status, "issued");
    const csv = await api("GET", `/city-reports/${r.body.data.id}/export.csv`, ids.kcca);
    assert.match(csv.type, /text\/csv/);
  });
}

(process.env.E2E_CLEANUP_ONLY ? Promise.resolve(console.log(`Cleaning up ${tag}`)) : run().then(() => console.log(`\nAll ${passed} checks passed.`)))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => {
    if (process.env.E2E_KEEP) console.log(`Fixtures kept. Remove with: E2E_CLEANUP_TAG=${tag} E2E_CLEANUP_ONLY=1 node scripts/e2e-city-report.cjs`);
    else await cleanup().catch(e => console.error("Cleanup failed", e));
    await pool.end();
  });
