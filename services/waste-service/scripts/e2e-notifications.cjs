// End-to-end check of Module 7 (notifications). Starts its own waste-service on port 8194 wired to a local SMTP server
// (email) and a local webhook receiver (SMS), with the background worker off so the test drives each step.
// Needs the local database with migrations 092–098 applied.
//
//   node scripts/e2e-notifications.cjs
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { spawn } = require("node:child_process");
const http = require("node:http");
const crypto = require("node:crypto");
const { SMTPServer } = require("smtp-server");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const PORT = 8194, SMTP_PORT = 2526, HOOK_PORT = 8199, SECRET = "e2e-webhook-secret";
const BASE = `http://localhost:${PORT}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = process.env.E2E_CLEANUP_TAG || `e2e-notify-${Date.now()}`;
const ids = {}, emails = [], hooks = [];
let hookStatus = 200, passed = 0, service, smtp, hook, pauseLock;

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
const notificationsOf = userId => sql("SELECT * FROM notifications WHERE recipient_user_id=$1 ORDER BY created_at,id", [userId]);
const deliveriesOf = userId => sql("SELECT d.* FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.recipient_user_id=$1 ORDER BY d.created_at,d.channel", [userId]);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startFakes() {
  smtp = new SMTPServer({
    authOptional: true, disabledCommands: ["STARTTLS"],
    onData(stream, session, done) { let raw = ""; stream.on("data", c => { raw += c; }); stream.on("end", () => { emails.push({ to: session.envelope.rcptTo.map(r => r.address), raw }); done(); }); },
  });
  await new Promise(resolve => smtp.listen(SMTP_PORT, "127.0.0.1", resolve));
  hook = http.createServer((req, res) => {
    let body = ""; req.on("data", c => { body += c; });
    req.on("end", () => { hooks.push({ body: JSON.parse(body), signature: req.headers["x-wms-signature"], raw: body }); res.writeHead(hookStatus, { "x-message-id": `hook-${hooks.length}` }); res.end("{}"); });
  });
  await new Promise(resolve => hook.listen(HOOK_PORT, "127.0.0.1", resolve));
}

async function startService() {
  service = spawn("npx", ["ts-node", "--transpile-only", "src/server.ts"], {
    cwd: path.resolve(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT), NOTIFICATION_WORKER: "off", PERMIT_LIFECYCLE_SCHEDULER: "off", PUBLIC_APP_URL: "https://wms.example",
      NOTIFY_EMAIL_PROVIDER: "smtp", SMTP_URL: `smtp://127.0.0.1:${SMTP_PORT}`, NOTIFY_EMAIL_FROM: "Kampala WMS <no-reply@wms.example>",
      NOTIFY_SMS_PROVIDER: "webhook", NOTIFY_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/sms`, NOTIFY_WEBHOOK_SECRET: SECRET },
  });
  let log = ""; service.stdout.on("data", c => { log += c; }); service.stderr.on("data", c => { log += c; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/waste/ready`)).ok) return; } catch { /* starting */ }
    await wait(1000);
  }
  throw new Error(`Test service did not start:\n${log.slice(-2000)}`);
}

async function setup() {
  const role = name => sql("SELECT id FROM roles WHERE name=$1", [name]).then(r => r[0].id);
  ids.company = (await sql("INSERT INTO organizations(name,type,is_active,created_at,platform_package_id) VALUES($1,'waste_collection_company',true,'2026-08-01',(SELECT id FROM platform_packages WHERE code='collector_professional')) RETURNING id", [`E2E Notify Collectors ${tag}`]))[0].id;
  const user = async (name, roleName, organizationId, phone) => {
    const id = (await sql("INSERT INTO users(full_name,email,phone,password_hash,status,organization_id) VALUES($1,$2,$3,'not-a-login','active',$4) RETURNING id",
      [name, `${tag}-${roleName}-${Math.random().toString(36).slice(2, 7)}@example.test`, phone, organizationId]))[0].id;
    await sql("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [id, await role(roleName)]);
    if (organizationId) await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [organizationId, id]);
    return id;
  };
  ids.kcca = await user("E2E KCCA Officer", "kcca_admin", null, null);
  ids.system = await user("E2E System Admin", "system_admin", null, null);
  ids.admin = await user("E2E Company Admin", "company_admin", ids.company, "0772 346 765");
  ids.supervisor = await user("E2E Supervisor", "supervisor", ids.company, "+2568709542");
  ids.today = (await sql("SELECT CURRENT_DATE::text AS d"))[0].d;
}

async function cleanup() {
  const orgs = (await sql("SELECT id FROM organizations WHERE name LIKE $1", [`%${tag}`])).map(r => r.id);
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM notification_preferences WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("DELETE FROM regulatory_returns WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM organization_permit_applications WHERE organization_id=ANY($1::uuid[])", [orgs]);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  // Compliance cases and organization audit events are immutable by design, so the organization is deactivated.
  await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=ANY($1::uuid[])", [orgs]);
}

const openCase = (severity, title) => api("POST", "/compliance/city", ids.kcca, {
  organizationId: ids.company, category: "service_delivery", severity, title, details: "Missed collections in Nakawa on three days.",
  requiredAction: "Recover the missed collections and confirm.", dueDate: addDays(ids.today, 5),
});

// Background workers of other waste-service instances on this database (a dev server) skip their delivery ticks while
// this lock is held, so they cannot send the test's messages before the test does.
async function pauseOtherWorkers() {
  pauseLock = await pool.connect();
  await pauseLock.query("SELECT pg_advisory_lock(hashtext('notification-delivery'))");
}

async function run() {
  await pauseOtherWorkers();
  await startFakes();
  await setup();
  await startService();
  let caseId;

  console.log("Creating notifications");
  await step("a critical compliance notice reaches the company's admin and supervisor, with email and SMS queued by default", async () => {
    const r = await openCase("critical", "Repeated missed collections");
    assert.equal(r.status, 201, JSON.stringify(r.body));
    caseId = r.body.data.id;
    const [n] = await notificationsOf(ids.admin);
    assert.deepEqual([n.category, n.severity, n.link], ["compliance", "critical", "/dashboard/compliance"]);
    assert.match(n.title, /Repeated missed collections/);
    assert.equal((await notificationsOf(ids.supervisor)).length, 1);
    assert.deepEqual((await deliveriesOf(ids.admin)).map(d => [d.channel, d.status]), [["email", "pending"], ["sms", "pending"]]);
    assert.equal((await notificationsOf(ids.kcca)).length, 0, "the issuer is not notified of their own notice");
  });
  await step("each person reads and clears only their own notifications", async () => {
    assert.equal((await api("GET", "/notifications/unread-count", ids.admin)).body.data.unread, 1);
    const list = await api("GET", "/notifications?unread=1", ids.admin);
    assert.equal(list.body.pagination.total, 1);
    const supervisorNote = (await notificationsOf(ids.supervisor))[0].id;
    assert.equal((await api("POST", "/notifications/read", ids.admin, { ids: [supervisorNote] })).body.data.updated, 0, "cannot mark someone else's");
    assert.equal((await api("POST", "/notifications/read", ids.admin, { ids: [list.body.data[0].id] })).body.data.updated, 1);
    assert.equal((await api("GET", "/notifications/unread-count", ids.admin)).body.data.unread, 0);
    assert.equal((await api("GET", "/notifications/unread-count")).status, 401);
  });

  console.log("Delivering email and SMS");
  await step("the worker sends email over SMTP and SMS through the signed webhook, and skips an unusable number", async () => {
    const r = await api("POST", "/notifications/process-deliveries", ids.system);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const mail = emails.find(e => e.to.some(to => to.startsWith(`${tag}-company_admin`)));
    assert.ok(mail, "email captured by the SMTP server");
    assert.match(mail.raw, /Subject: \[KCCA WMS\] KCCA compliance notice: Repeated missed collections/);
    assert.match(mail.raw, /https:\/\/wms\.example\/dashboard\/compliance/);
    const sms = hooks.find(h => h.body.to === "+256772346765");
    assert.ok(sms, "SMS to the normalised number");
    assert.equal(sms.signature, crypto.createHmac("sha256", SECRET).update(sms.raw).digest("hex"));
    assert.ok(sms.body.text.length <= 320);
    assert.deepEqual((await deliveriesOf(ids.admin)).map(d => d.status), ["sent", "sent"]);
    const supervisorSms = (await deliveriesOf(ids.supervisor)).find(d => d.channel === "sms");
    assert.equal(supervisorSms.status, "skipped");
    assert.match(supervisorSms.last_error, /not a usable phone number/);
  });
  await step("a failed send is retried later with a growing wait, then succeeds", async () => {
    hookStatus = 500;
    await openCase("critical", "Overflowing bins at Owino market");
    await api("POST", "/notifications/process-deliveries", ids.system);
    let sms = (await deliveriesOf(ids.admin)).filter(d => d.channel === "sms").at(-1);
    assert.deepEqual([sms.status, sms.attempts], ["pending", 1]);
    assert.match(sms.last_error, /Webhook answered 500/);
    const [{ minutes }] = await sql("SELECT round(extract(epoch FROM next_attempt_at-now())/60) AS minutes FROM notification_deliveries WHERE id=$1", [sms.id]);
    assert.equal(Number(minutes), 1);
    hookStatus = 200;
    await sql("UPDATE notification_deliveries SET next_attempt_at=now() WHERE id=$1", [sms.id]);
    await api("POST", "/notifications/process-deliveries", ids.system);
    sms = (await sql("SELECT status,attempts,provider_message_id FROM notification_deliveries WHERE id=$1", [sms.id]))[0];
    assert.deepEqual([sms.status, sms.attempts], ["sent", 2]);
  });
  await step("preferences turn channels off per category; the in-app notification still arrives", async () => {
    const saved = await api("PUT", "/notifications/preferences", ids.admin, { categories: [{ category: "compliance", email: false, sms: false }] });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.data.categories.find(c => c.category === "compliance"), { category: "compliance", email: false, sms: false });
    const before = (await deliveriesOf(ids.admin)).length;
    await openCase("critical", "Illegal dumping near Nakivubo channel");
    assert.equal((await notificationsOf(ids.admin)).at(-1).title, "KCCA compliance notice: Illegal dumping near Nakivubo channel");
    assert.equal((await deliveriesOf(ids.admin)).length, before, "no email or SMS queued");
    assert.equal((await api("PUT", "/notifications/preferences", ids.admin, { categories: [{ category: "nonsense", email: true, sms: true }] })).status, 400);
  });

  console.log("Events across the platform");
  await step("a company's response notifies KCCA, in-app only for routine updates", async () => {
    const r = await api("PATCH", `/compliance/organization/${caseId}/respond`, ids.admin, { response: "Crews redeployed; all missed collections recovered on Saturday." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [n] = await notificationsOf(ids.kcca);
    assert.deepEqual([n.category, n.severity], ["compliance", "info"]);
    assert.match(n.title, /Remediation submitted/);
    assert.equal((await deliveriesOf(ids.kcca)).length, 0, "info items are not emailed by default");
  });
  await step("permit reminders reach the company once, through the lifecycle notices", async () => {
    const r = await api("POST", `/regulatory/organizations/${ids.company}/permits`, ids.kcca, {
      registrationNumber: `E2E-${Date.now()}`, contactName: "Sarah Achieng", email: "sarah@example.test", phone: "+256700000004", address: "Plot 4, Nakawa",
      serviceDescription: "Household and commercial waste collection in Nakawa.", validUntil: addDays(ids.today, 5), activityCodes: ["household_collection"], notes: "Inspection completed",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await api("POST", "/regulatory/permit-lifecycle/run", ids.kcca);
    await api("POST", "/regulatory/permit-lifecycle/run", ids.kcca);
    const permitNotes = (await notificationsOf(ids.admin)).filter(n => n.category === "permit");
    assert.equal(permitNotes.length, 1);
    assert.deepEqual([permitNotes[0].severity, permitNotes[0].title], ["critical", "Permit expires within 7 days"]);
    assert.equal((await notificationsOf(ids.supervisor)).filter(n => n.category === "permit").length, 0, "reminders go to administrators");
  });
  await step("overdue monthly returns are notified once per month", async () => {
    await api("POST", "/notifications/run-checks", ids.system);
    await api("POST", "/notifications/run-checks", ids.system);
    const overdue = (await notificationsOf(ids.admin)).filter(n => n.title === "Monthly return overdue: September 2026");
    assert.equal(overdue.length, 1);
    assert.equal(overdue[0].link, "/dashboard/returns");
  });
  await step("a queried return tells the company what to correct", async () => {
    const filed = await api("POST", "/regulatory/returns", ids.admin, { period: "2026-09", declarantName: "Sarah Achieng", declarantTitle: "Director", confirm: true,
      figures: { customers_served: 10, trips_completed: 0, collections_completed: 0, collections_missed: 0, waste_disposed_kg: 0, disposal_site: "Kiteezi", vehicles_operated: 1, staff_employed: 2, complaints_received: 0, complaints_resolved: 0 } });
    assert.equal(filed.status, 201, JSON.stringify(filed.body));
    await api("PATCH", `/regulatory/returns-register/${filed.body.data.id}`, ids.kcca, { action: "query", notes: "Trips are zero but customers are served; check trip records." });
    const queried = (await notificationsOf(ids.admin)).find(n => n.category === "returns" && /queried/.test(n.title));
    assert.ok(queried);
    assert.equal(queried.severity, "warning");
    assert.match(queried.body, /check trip records/);
  });
  await step("only system administrators run the worker and see delivery problems", async () => {
    assert.equal((await api("POST", "/notifications/process-deliveries", ids.admin)).status, 403);
    assert.equal((await api("GET", "/notifications/deliveries", ids.kcca)).status, 403);
    const summary = await api("GET", "/notifications/deliveries", ids.system);
    assert.equal(summary.status, 200);
    assert.ok(summary.body.data.recent_problems.some(p => /not a usable phone number/.test(p.last_error || "")));
  });
}

// E2E_KEEP=1 leaves the fixtures for a manual look; E2E_CLEANUP_TAG=<tag> E2E_CLEANUP_ONLY=1 removes them later.
(process.env.E2E_CLEANUP_ONLY ? Promise.resolve(console.log(`Cleaning up ${tag}`)) : run().then(() => console.log(`\nAll ${passed} checks passed.`)))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => {
    if (process.env.E2E_KEEP) console.log(`Fixtures kept. Remove with: E2E_CLEANUP_TAG=${tag} E2E_CLEANUP_ONLY=1 node scripts/e2e-notifications.cjs`);
    else await cleanup().catch(e => console.error("Cleanup failed", e));
    service?.kill();
    smtp?.close(() => undefined);
    hook?.close();
    pauseLock?.release();
    await pool.end();
  });
