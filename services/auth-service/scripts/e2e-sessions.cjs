// End-to-end check of Module 5 hardening: server-side sessions (sign out, sign out everywhere, password change,
// legacy tokens), cross-service revocation, readiness, request ids and the CORS allow-list.
// Needs migration 096, an auth-service instance and a waste-service instance started with CORS_ORIGINS=https://allowed.example:
//
//   PORT=8191 npm run dev                                                   (services/auth-service)
//   PORT=8193 PERMIT_LIFECYCLE_SCHEDULER=off CORS_ORIGINS=https://allowed.example npm run dev   (services/waste-service)
//   AUTH_BASE_URL=http://localhost:8191 WASTE_BASE_URL=http://localhost:8193 node scripts/e2e-sessions.cjs
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const assert = require("node:assert/strict");

const AUTH = (process.env.AUTH_BASE_URL || "http://localhost:8191").replace(/\/$/, "");
const WASTE = (process.env.WASTE_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = `e2e-session-${Date.now()}`;
const email = `${tag}@example.test`;
const PASSWORD = "Correct-Horse-Battery-9", NEW_PASSWORD = "Another-Strong-Phrase-7";
let passed = 0, userId;

const sql = async (text, params = []) => (await pool.query(text, params)).rows;
async function call(base, method, url, { token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${url}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, headers: response.headers, body: json ?? text };
}
const login = async (password = PASSWORD) => {
  const r = await call(AUTH, "POST", "/api/auth/login", { body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.tokens;
};
const me = token => call(AUTH, "GET", "/api/auth/me", { token });
const wasteCall = token => call(WASTE, "GET", "/api/waste/regulatory/permit-lifecycle/overview", { token });
async function step(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }

async function setup() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  userId = (await sql("INSERT INTO users(full_name,email,password_hash,status) VALUES('E2E Session Officer',$1,$2,'active') RETURNING id", [email, hash]))[0].id;
  await sql("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='kcca_admin'", [userId]);
}
async function cleanup() {
  if (!userId) return;
  await sql("DELETE FROM user_roles WHERE user_id=$1", [userId]);
  await sql("DELETE FROM users WHERE id=$1", [userId]).catch(() => sql("UPDATE users SET status='inactive' WHERE id=$1", [userId]));
}

async function run() {
  await setup();
  let a, b;

  console.log("Sessions");
  await step("sign-in creates a server-side session carried by both tokens", async () => {
    a = await login();
    const access = jwt.decode(a.accessToken), refresh = jwt.decode(a.refreshToken);
    assert.ok(access.sid && access.sid === refresh.sid);
    const [row] = await sql("SELECT user_id,revoked_at FROM user_sessions WHERE id=$1", [access.sid]);
    assert.deepEqual([row.user_id, row.revoked_at], [userId, null]);
    assert.equal((await me(a.accessToken)).status, 200);
    assert.equal((await wasteCall(a.accessToken)).status, 200);
  });
  await step("signing out ends that session everywhere, immediately", async () => {
    b = await login();
    const r = await call(AUTH, "POST", "/api/auth/logout", { token: a.accessToken, body: { refreshToken: a.refreshToken } });
    assert.deepEqual([r.status, r.body.data.ended], [200, 1]);
    assert.equal((await me(a.accessToken)).status, 401, "auth service rejects the access token");
    assert.equal((await wasteCall(a.accessToken)).status, 401, "other services reject it too");
    const refresh = await call(AUTH, "POST", "/api/auth/refresh", { body: { refreshToken: a.refreshToken } });
    assert.equal(refresh.status, 401);
    assert.match(refresh.body.message, /session has ended/);
    assert.equal((await me(b.accessToken)).status, 200, "the other device stays signed in");
  });
  await step("refresh keeps the same session and records use", async () => {
    const r = await call(AUTH, "POST", "/api/auth/refresh", { body: { refreshToken: b.refreshToken } });
    assert.equal(r.status, 200);
    assert.equal(jwt.decode(r.body.data.tokens.accessToken).sid, jwt.decode(b.accessToken).sid);
    b = r.body.data.tokens;
  });
  await step("sign out everywhere ends every session of the user", async () => {
    const c = await login();
    const r = await call(AUTH, "POST", "/api/auth/logout", { token: b.accessToken, body: { everywhere: true } });
    assert.ok(r.body.data.ended >= 2);
    assert.equal((await me(b.accessToken)).status, 401);
    assert.equal((await me(c.accessToken)).status, 401);
  });
  await step("an expired access token can still sign out using the refresh token", async () => {
    const d = await login();
    const r = await call(AUTH, "POST", "/api/auth/logout", { body: { refreshToken: d.refreshToken } });
    assert.equal(r.body.data.ended, 1);
    assert.equal((await me(d.accessToken)).status, 401);
  });
  await step("signing out with nothing or garbage is harmless", async () => {
    assert.deepEqual((await call(AUTH, "POST", "/api/auth/logout", { body: {} })).body.data, { ended: 0 });
    assert.equal((await call(AUTH, "POST", "/api/auth/logout", { token: "not-a-token", body: { refreshToken: "nope" } })).status, 200);
  });
  await step("tokens issued before sessions existed keep working until they expire, then join a session", async () => {
    const legacyAccess = jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    assert.equal((await me(legacyAccess)).status, 200);
    assert.equal((await wasteCall(legacyAccess)).status, 200);
    const [{ password_hash }] = await sql("SELECT password_hash FROM users WHERE id=$1", [userId]);
    const pwv = require("node:crypto").createHmac("sha256", process.env.JWT_REFRESH_SECRET).update(password_hash).digest("base64url").slice(0, 22);
    const legacyRefresh = jwt.sign({ userId, pwv }, process.env.JWT_REFRESH_SECRET, { expiresIn: "5m" });
    const r = await call(AUTH, "POST", "/api/auth/refresh", { body: { refreshToken: legacyRefresh } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(jwt.decode(r.body.data.tokens.accessToken).sid, "refreshed tokens now carry a session");
  });
  await step("a forged session id is rejected", async () => {
    const forged = jwt.sign({ userId, sid: "00000000-0000-4000-8000-000000000000" }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    assert.equal((await me(forged)).status, 401);
    assert.equal((await wasteCall(forged)).status, 401);
  });
  await step("changing the password signs out every other device but keeps this one", async () => {
    const here = await login(), there = await login();
    const r = await call(AUTH, "PATCH", "/api/auth/password", { token: here.accessToken, body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await me(there.accessToken)).status, 401);
    assert.equal((await me(here.accessToken)).status, 200);
    const [{ revoked_reason }] = await sql("SELECT revoked_reason FROM user_sessions WHERE id=$1", [jwt.decode(there.accessToken).sid]);
    assert.equal(revoked_reason, "password_changed");
  });

  console.log("Readiness, request ids and CORS");
  await step("each service reports ready when its tables exist", async () => {
    for (const [base, url] of [[AUTH, "/api/auth/ready"], [WASTE, "/api/waste/ready"]]) {
      const r = await call(base, "GET", url);
      assert.deepEqual([r.status, r.body.status], [200, "ready"], url);
    }
  });
  await step("request ids are returned, kept when well-formed and replaced when not", async () => {
    const generated = await call(WASTE, "GET", "/api/waste/health");
    assert.match(generated.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
    assert.equal((await call(WASTE, "GET", "/api/waste/health", { headers: { "X-Request-Id": "trace-abc-12345" } })).headers.get("x-request-id"), "trace-abc-12345");
    assert.notEqual((await call(WASTE, "GET", "/api/waste/health", { headers: { "X-Request-Id": "bad id <script>" } })).headers.get("x-request-id"), "bad id <script>");
  });
  await step("CORS answers only allowed browser origins", async () => {
    const preflight = origin => fetch(`${WASTE}/api/waste/health`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" } });
    assert.equal((await preflight("https://allowed.example")).headers.get("access-control-allow-origin"), "https://allowed.example");
    assert.equal((await preflight("https://evil.example")).headers.get("access-control-allow-origin"), null);
  });
}

run()
  .then(() => console.log(`\nAll ${passed} checks passed.`))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch(e => console.error("Cleanup failed", e)); await pool.end(); });
