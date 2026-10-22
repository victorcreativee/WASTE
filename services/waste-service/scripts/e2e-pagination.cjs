// End-to-end check of backward-compatible pagination on the largest list endpoints (weighbridge transactions, resident
// issues, customers, customer collection stops) against a running waste-service and the local database.
//
//   E2E_BASE_URL=http://localhost:8193 node scripts/e2e-pagination.cjs
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const assert = require("node:assert/strict");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:8193").replace(/\/$/, "");
if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run against a non-local database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = `e2e-paging-${Date.now()}`;
const ids = {};
let passed = 0;
const TICKETS = 7, ISSUES = 7;

const sql = async (text, params = []) => (await pool.query(text, params)).rows;
const token = userId => jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
async function api(url, user = ids.admin) {
  const response = await fetch(`${BASE}/api/waste${url}`, { headers: { Authorization: `Bearer ${token(user)}` } });
  return { status: response.status, total: response.headers.get("x-total-count"), body: await response.json() };
}
async function step(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }

async function setup() {
  ids.org = (await sql(`INSERT INTO organizations(name,type,is_active,platform_package_id)
    VALUES($1,'waste_collection_company',true,(SELECT id FROM platform_packages WHERE code='collector_professional')) RETURNING id`, [`E2E Paging Collectors ${tag}`]))[0].id;
  ids.admin = (await sql("INSERT INTO users(full_name,email,password_hash,status,organization_id) VALUES('E2E Paging Admin',$1,'not-a-login','active',$2) RETURNING id", [`${tag}-admin@example.test`, ids.org]))[0].id;
  await sql("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='company_admin'", [ids.admin]);
  await sql("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [ids.org, ids.admin]);
  // All tickets share one date and one created_at (single statement), so only the id tie-breaker keeps pages stable.
  await sql(`INSERT INTO weighbridge_transactions(organization_id,ticket_number,facility,registration,normalized_registration,operation_date,arrival_at,gross_kg,tare_kg,net_kg,status)
    SELECT $1,$2||'-'||n,'Kiteezi','UBD 00'||n||'E','UBD00'||n||'E','2026-09-15','2026-09-15 10:00',20000,10000,10000,'completed' FROM generate_series(1,$3) n`, [ids.org, tag, TICKETS]);
  await sql(`INSERT INTO citizen_issues(reporter_user_id,assigned_organization_id,category,title,description,status,created_at)
    SELECT $1,$2,'missed_collection','E2E paging issue '||n,'Created to test pagination.','assigned','2026-09-15 08:00' FROM generate_series(1,$3) n`, [ids.admin, ids.org, ISSUES]);
}

async function cleanup() {
  const users = (await sql("SELECT id FROM users WHERE email LIKE $1", [`${tag}-%`])).map(r => r.id);
  if (ids.org) {
    await sql("DELETE FROM citizen_issues WHERE assigned_organization_id=$1", [ids.org]);
    await sql("DELETE FROM weighbridge_transactions WHERE organization_id=$1", [ids.org]);
  }
  await sql("DELETE FROM notifications WHERE recipient_user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
  await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await sql("UPDATE users SET status='inactive',full_name='E2E fixture (inactive)' WHERE id=ANY($1::uuid[])", [users]);
  // Organization audit events are immutable by design, so the organization is deactivated rather than deleted.
  if (ids.org) await sql("UPDATE organizations SET is_active=false,name='[e2e fixture] '||name WHERE id=$1", [ids.org]);
}

async function walk(endpoint, size) {
  const seen = [];
  for (let offset = 0, guard = 0; guard < 20; guard++) {
    const r = await api(`${endpoint}${endpoint.includes("?") ? "&" : "?"}limit=${size}&offset=${offset}`);
    assert.equal(r.status, 200);
    seen.push(...r.body.data.map(row => row.id));
    if (!r.body.pagination.has_more) { assert.equal(r.body.pagination.next_offset, null); break; }
    offset = r.body.pagination.next_offset;
  }
  return seen;
}

async function checkEndpoint(label, endpoint, expected) {
  await step(`${label}: without paging parameters the response is unchanged`, async () => {
    const r = await api(endpoint);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data));
    assert.equal(r.body.pagination, undefined);
    assert.equal(r.total, null);
    assert.equal(r.body.data.length, expected);
  });
  await step(`${label}: a page carries its total, header and next offset`, async () => {
    const r = await api(`${endpoint}?limit=3`);
    assert.equal(r.body.data.length, 3);
    assert.equal(r.total, String(expected));
    assert.deepEqual(r.body.pagination, { limit: 3, offset: 0, total: expected, returned: 3, has_more: true, next_offset: 3, page: 1, page_size: 3 });
  });
  await step(`${label}: walking every page returns each row exactly once, in the unpaged order`, async () => {
    const all = (await api(endpoint)).body.data.map(row => row.id);
    const paged = await walk(endpoint, 3);
    assert.equal(new Set(paged).size, paged.length, "no row appears twice");
    assert.deepEqual(paged, all);
  });
  await step(`${label}: page/pageSize matches limit/offset, and past the end is empty`, async () => {
    const a = await api(`${endpoint}?page=2&pageSize=3`), b = await api(`${endpoint}?limit=3&offset=3`);
    assert.deepEqual(a.body.data.map(r => r.id), b.body.data.map(r => r.id));
    const beyond = await api(`${endpoint}?limit=3&offset=100`);
    assert.deepEqual([beyond.body.data.length, beyond.body.pagination.has_more, beyond.body.pagination.total], [0, false, expected]);
  });
}

async function run() {
  await setup();
  console.log("Weighbridge transactions");
  await checkEndpoint("weighbridge", "/weighbridge/transactions", TICKETS);
  console.log("Resident issues");
  await checkEndpoint("resident issues", "/citizen-issues", ISSUES);

  console.log("Customers and collection stops");
  for (const endpoint of ["/customers", "/customer-collection-stops"]) {
    await step(`${endpoint}: unpaged unchanged, paged adds pagination`, async () => {
      const plain = await api(endpoint), paged = await api(`${endpoint}?limit=1`);
      assert.equal(plain.status, 200, JSON.stringify(plain.body));
      assert.deepEqual([Array.isArray(plain.body.data), plain.body.pagination], [true, undefined]);
      assert.equal(paged.body.pagination.total, plain.body.data.length);
      assert.ok(paged.body.data.length <= 1);
    });
  }

  console.log("Validation");
  await step("invalid paging parameters are refused with a clear message", async () => {
    for (const [query, message] of [["limit=0", /between 1 and 500/], ["limit=501", /between 1 and 500/], ["offset=-1", /whole number/], ["limit=2&page=1", /either limit and offset/]]) {
      const r = await api(`/weighbridge/transactions?${query}`);
      assert.equal(r.status, 400, query);
      assert.match(r.body.message, message);
    }
  });
}

run()
  .then(() => console.log(`\nAll ${passed} checks passed.`))
  .catch(error => { console.error(`\nFAILED after ${passed} checks:`, error); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch(e => console.error("Cleanup failed", e)); await pool.end(); });
