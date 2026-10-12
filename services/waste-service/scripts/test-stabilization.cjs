// Real PostgreSQL + HTTP regression checks. Fixture writes are ALWAYS rolled back.
// Run from waste-service: node -r ts-node/register/transpile-only scripts/test-stabilization.cjs
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
require('dotenv').config({ quiet: true });
if (process.env.NODE_ENV === 'production') throw new Error('Run against a local development database only');
const dbUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(dbUrl.hostname)) throw new Error('Local database required');
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex'); // Test process only; never printed.
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
if(process.argv.includes('--onboarding'))process.env.WMS_ONBOARDING_ENABLED='true';
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const { dbPool } = require('../src/config/database');
const { dbPool: orgPool } = require('../../organization-service/src/config/database');
const { dbPool: authPool } = require('../../auth-service/src/config/database');
const app = require('../src/app').default;
const orgApp = require('../../organization-service/src/app').default;
const authApp = require('../../auth-service/src/app').default;
const { organizationReport } = require('../src/repositories/report.repository');
const { confirmPayment, recordOrganizationPayment } = require('../src/repositories/billing.repository');
const { requireOrganizationScope, operationalOrganizationScope } = require('../src/middlewares/organization-scope');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  let savepoint = 0, checks = 0;
  const servers = [];
  const check = (condition, message) => { assert.ok(condition, message); checks++; };
  try {
    await client.query('BEGIN');
    if(process.argv.includes('--onboarding'))await client.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../infrastructure/database/025_company_onboarding.sql'),'utf8'));
    if(process.argv.includes('--ownership'))await client.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../infrastructure/database/026_customer_service_relationships.sql'),'utf8'));
    if(process.argv.includes('--provider-requests'))await client.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../infrastructure/database/027_provider_relationship_requests.sql'),'utf8'));
    if(process.argv.includes('--customer-stops')){
      await client.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../infrastructure/database/028_customer_collection_stops.sql'),'utf8'));
      await client.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../infrastructure/database/029_customer_stop_exceptions.sql'),'utf8'));
      await client.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../infrastructure/database/030_schedule_job_automation.sql'),'utf8'));
      await client.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../infrastructure/database/031_route_cancellation_recovery.sql'),'utf8'));
      await client.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../infrastructure/database/032_vehicle_live_tracking.sql'),'utf8'));
      await client.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../infrastructure/database/033_fleet_alert_reviews.sql'),'utf8'));
    }
    if (process.argv.includes('--finance')) await client.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../infrastructure/database/023_finance_stabilization.sql'),'utf8'));
    // Production repository transactions become savepoints inside this outer rollback.
    // Deliberately sequential: this suite does not claim a concurrent-session race test.
    for (const pool of [dbPool, orgPool, authPool]) {
      pool.query = (...args) => client.query(...args);
      pool.connect = async () => {
        const name = 'fixture_' + (++savepoint);
        return {
          query: async (sql, params) => {
            if (sql === 'BEGIN') return client.query('SAVEPOINT ' + name);
            if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + name);
            if (sql === 'ROLLBACK') {
              await client.query('ROLLBACK TO SAVEPOINT ' + name);
              return client.query('RELEASE SAVEPOINT ' + name);
            }
            return client.query(sql, params);
          },
          release() {},
        };
      };
    }
    const serve = async application => {
      const server = await new Promise((resolve, reject) => { const s = application.listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
      servers.push(server);
      return 'http://127.0.0.1:' + server.address().port;
    };
    const base = await serve(app), orgBase = await serve(orgApp), authBase = await serve(authApp);
    const testTokens = new Map();
    async function request(user, path, method = 'GET', body, origin = base) {
      const headers = { 'Content-Type': 'application/json' };
      if (user) {
        if (!testTokens.has(user)) testTokens.set(user,jwt.sign({ userId: user }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m' }));
        headers.Authorization = 'Bearer ' + testTokens.get(user);
      }
      const response = await fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
    const one = async (sql, values) => (await client.query(sql, values)).rows[0];
    const organization = async name => (await one(
      `INSERT INTO organizations(name,type,platform_package_id)
       VALUES($1,'waste_collection_company',(
         SELECT id FROM platform_packages WHERE code='collector_professional' AND is_active LIMIT 1
       )) RETURNING id`,
      [name]
    )).id;
    const a = await organization('Rollback tenant A'), b = await organization('Rollback tenant B');
    const fixturePassword = randomBytes(24).toString('hex');
    const fixtureHash = await require('../../auth-service/node_modules/bcrypt').hash(fixturePassword, 4);
    async function user(org, role) {
      const id = randomUUID();
      await client.query("INSERT INTO users(id,organization_id,full_name,email,password_hash) VALUES($1,$2,$3,$4,$5)", [id, org, 'Rollback ' + role, id + '@rollback.invalid', fixtureHash]);
      const result = await client.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2', [id, role]);
      assert.equal(result.rowCount, 1, 'Required seeded role: ' + role);
      return id;
    }
    const adminA = await user(a, 'company_admin'), adminB = await user(b, 'company_admin');
    const supervisor = await user(a, 'supervisor'), unlinked = await user(null, 'supervisor');
    const kcca = await user(null, 'kcca_admin'), system = await user(null, 'system_admin');
    const driverA = await user(a, 'driver'), driverB = await user(b, 'driver');
    const citizen = await user(null, 'citizen');
    check((await request(null, '/api/auth/login', 'POST', {email: adminA + '@rollback.invalid', password: fixturePassword}, authBase)).status === 200, 'Active organization login retained');
    check((await request(null, '/api/waste/inventory')).status === 401, 'Anonymous access denied');
    for (const actor of [kcca, system]) {
      for (const path of ['/billing/plans','/billing/overview','/finance/expenses','/finance/position',
        '/finance/payables','/contracts','/inventory','/procurement','/fleet/overview',
        '/fleet/trucks/' + randomUUID(),'/reports/organization','/customers']) {
        check((await request(actor, '/api/waste' + path)).status === 403, 'Private route denied: ' + path);
      }
    }
    check((await request(kcca, '/api/waste/zones')).status === 200, 'KCCA operational access retained');
    for (const path of ['/api/waste/trucks','/api/waste/inventory','/api/waste/billing/overview']) {
      check((await request(unlinked, path)).status === 403, 'Unlinked supervisor denied: ' + path);
    }
    check((await request(unlinked, '/api/organizations', 'GET', undefined, orgBase)).status === 403, 'Org service denies unlinked supervisor');
    const myOrg = await request(adminA, '/api/organizations', 'GET', undefined, orgBase);
    check(myOrg.status === 200 && JSON.stringify(myOrg.body.data).includes(a) && !JSON.stringify(myOrg.body.data).includes(b), 'Organization list isolation');
    const foreignOrg = await request(adminA, '/api/organizations/' + b, 'GET', undefined, orgBase);
    check(foreignOrg.status === 404, 'Foreign organization detail denied');
    // Scope helpers fail closed even if a controller is invoked outside its router.
    for (const role of ['company_admin','supervisor']) {
      assert.throws(() => requireOrganizationScope({ auth: { userId: adminA, organizationId: null, roles: [role] } }), { statusCode: 403 }); checks++;
    }
    assert.throws(() => operationalOrganizationScope({ auth: { userId: citizen, organizationId: null, roles: ['citizen'] } }), { statusCode: 403 }); checks++;
    const item = async org => (await one("INSERT INTO inventory_items(organization_id,sku,name,category) VALUES($1,'TEST','Rollback bins','bins') RETURNING id", [org])).id;
    const itemA = await item(a), itemB = await item(b);
    const inventory = await request(adminA, '/api/waste/inventory');
    check(inventory.status === 200 && inventory.body.data.items.length === 1 && inventory.body.data.items[0].id === itemA, 'Tenant A list excludes B inventory');
    const inventoryB = await request(adminB, '/api/waste/inventory');
    check(inventoryB.status === 200 && inventoryB.body.data.items[0].id === itemB, 'Tenant B reads own inventory');
    const move = (id, quantity, movementType = 'receipt') => request(adminA, '/api/waste/inventory/items/' + id + '/movements', 'POST', { quantity, movementType, reason: 'Rollback stock test' });
    check((await move(itemB, 10)).status === 409, 'Cross-tenant stock mutation denied');
    check((await move(itemA, 10)).status === 201, 'Stock receipt SQL works');
    check((await move(itemA, 4, 'issue')).status === 201, 'Stock issue works');
    check((await move(itemA, 7, 'issue')).status === 409, 'Insufficient stock denied');
    check(Number((await one('SELECT quantity FROM inventory_items WHERE id=$1', [itemA])).quantity) === 6, 'Failed issue preserves quantity');
    check(Number((await one('SELECT quantity FROM inventory_items WHERE id=$1', [itemB])).quantity) === 0, 'Foreign quantity unchanged');
    check((await request(supervisor, '/api/waste/inventory')).status === 200, 'Linked supervisor inventory retained');
    const truck = async (org, label) => (await one('INSERT INTO waste_trucks(organization_id,plate_number) VALUES($1,$2) RETURNING id', [org, 'TEST-' + label + randomUUID().slice(0,8)])).id;
    const truckA = await truck(a, 'A'), truckB = await truck(b, 'B');
    check((await request(adminA, '/api/waste/fleet/trucks/' + truckB)).status === 404, 'Cross-tenant fleet detail denied');
    const driver = async (org, uid) => (await one("INSERT INTO drivers(organization_id,user_id,full_name) VALUES($1,$2,'Rollback driver') RETURNING id", [org, uid])).id;
    const da = await driver(a, driverA), db = await driver(b, driverB);
    const job = async (org, truckId, driverId) => (await one("INSERT INTO collection_jobs(organization_id,truck_id,driver_id,job_date,status) VALUES($1,$2,$3,CURRENT_DATE,'assigned') RETURNING id", [org, truckId, driverId])).id;
    const ja = await job(a, truckA, da), jb = await job(b, truckB, db);
    const ownJobs = await request(driverA, '/api/waste/driver/jobs');
    check(ownJobs.status === 200 && JSON.stringify(ownJobs.body.data).includes(ja) && !JSON.stringify(ownJobs.body.data).includes(jb), 'Driver sees own jobs');
    check((await request(driverA, '/api/waste/driver-jobs/' + jb + '/start', 'PATCH', {})).status === 400, 'Driver cannot start foreign job');
    check((await one('SELECT status FROM collection_jobs WHERE id=$1', [jb])).status === 'assigned', 'Foreign job unchanged');
    check((await request(driverA, '/api/waste/driver-jobs/' + ja + '/start', 'PATCH', {})).status === 200, 'Driver can start own assigned job');
    const assign = await request(adminA, '/api/waste/collection-jobs/' + ja + '/assign', 'PATCH', { truckId: truckB, driverId: db });
    check(assign.status === 400, 'Cross-tenant assignment references rejected');
    const spoof = await request(adminA, '/api/waste/trucks', 'POST', { organizationId: b, plateNumber: 'SPOOF-' + randomUUID().slice(0,8), truckName: 'Rollback scope' });
    check(spoof.status === 201 && spoof.body.data.organization_id === a, 'Body organization cannot override tenant');
    // Customer + subscription fixtures, no provider calls.
    const cp = await one("INSERT INTO customer_profiles(user_id,customer_type) VALUES($1,'residential') RETURNING id", [citizen]);
    const loc = await one("INSERT INTO customer_service_locations(customer_id,organization_id,address,location) VALUES($1,$2,'Rollback location',ST_GeogFromText('SRID=4326;POINT(32.58 0.34)')) RETURNING id", [cp.id, a]);
    const plan = await one("INSERT INTO service_plans(organization_id,name,billing_frequency,fee_ugx) VALUES($1,'Rollback package','monthly',100) RETURNING id", [a]);
    const sub = await one("INSERT INTO customer_subscriptions(customer_id,service_location_id,organization_id,plan_id) VALUES($1,$2,$3,$4) RETURNING id", [cp.id, loc.id, a, plan.id]);
    const invoice = async () => (await one("INSERT INTO customer_invoices(invoice_number,subscription_id,customer_id,organization_id,amount_ugx,balance_ugx,due_on) VALUES($1,$2,$3,$4,100,100,CURRENT_DATE+7) RETURNING id", [randomUUID(),sub.id,cp.id,a])).id;
    const inv = await invoice();
    const pending = async (invoiceId, amount = 100) => (await one("INSERT INTO customer_payments(invoice_id,customer_id,organization_id,amount_ugx,provider,created_at) VALUES($1,$2,$3,$4,'manual',CURRENT_DATE-10) RETURNING id", [invoiceId,cp.id,a,amount])).id;
    const p1 = await pending(inv), p2 = await pending(inv);
    const confirmation = (actor, id, ref) => request(actor, '/api/waste/billing/payments/' + id + '/confirm', 'PATCH', { providerReference: ref });
    check((await confirmation(adminB,p1,'TEST-ONE')).status === 409, 'Foreign payment confirmation denied');
    check((await confirmation(adminA,p1,'TEST-ONE')).status === 200, 'First receipt confirmed');
    check((await confirmation(adminA,p1,'TEST-ONE')).status === 409, 'Repeated confirmation rejected');
    check((await confirmation(adminA,p2,'TEST-TWO')).status === 409, 'Stale pending payment cannot over-credit invoice');
    check((await one('SELECT status FROM customer_payments WHERE id=$1',[p2])).status === 'pending', 'Rejected confirmation has no receipt side effect');
    check(Number((await one('SELECT balance_ugx FROM customer_invoices WHERE id=$1',[inv])).balance_ugx) === 0, 'Invoice balance remains zero');
    const inv2 = await invoice(), p3 = await pending(inv2);
    check((await confirmation(adminA,p3,'TEST-ONE')).status === 409, 'Duplicate successful reference across invoices denied');
    check(await recordOrganizationPayment(a,{invoiceId:inv2,amountUgx:100,provider:'cash',providerReference:'TEST-ONE'}) === null, 'Manual receipt shares reference check');
    check(await confirmPayment(p3,null,'TEST-THREE') === null, 'Repository rejects null confirmation scope');
    await client.query("UPDATE customer_invoices SET status='cancelled' WHERE id=$1",[inv2]);
    check((await confirmation(adminA,p3,'TEST-THREE')).status === 409, 'Cancelled invoice cannot receive payment');
    const billing = await request(citizen,'/api/waste/billing/overview');
    check(billing.status === 200 && JSON.stringify(billing.body.data).includes(inv), 'Customer own billing retained');
    // Paid fleet expense is counted once, on its payment date, not logged date.
    const fuel = await one("INSERT INTO truck_fuel_records(truck_id,organization_id,litres,cost_ugx,fuel_date,recorded_by) VALUES($1,$2,1,25,CURRENT_DATE,$3) RETURNING id", [truckA,a,adminA]);
    await client.query("UPDATE organization_expenses SET status='paid',paid_at=CURRENT_TIMESTAMP,expense_date=CURRENT_DATE-10 WHERE source_id=$1 AND organization_id=$2",[fuel.id,a]);
    const today = (await one("SELECT CURRENT_DATE::text today")).today;
    const report = await organizationReport(a,today,today);
    check(Number(report.finance.received) === 100, 'Report receipts use confirmation date');
    check(Number(report.finance.operating_expenses) === 25, 'Report expenses use paid date');
    check(Number(report.finance.received)-Number(report.finance.operating_expenses)-Number(report.finance.supplier_payments) === 75, 'Fleet payment counted once in cash movement');
    if (process.argv.includes('--finance')) await require('./finance-controls.cjs')({client,one,organization,user,check,request});
    // Suspend only fixture organization, then verify all three service boundaries.
    if(process.argv.includes('--onboarding'))await require('./onboarding-tests.cjs')({client,one,check,request,authBase,organization,adminA,kcca,system,driverA,a});
    if(process.argv.includes('--workspace'))await require('./company-workspace-tests.cjs')({client,one,check,request,orgBase,a,b,adminA,adminB,supervisor,kcca,driverA});
    if(process.argv.includes('--ownership'))await require('./customer-ownership-tests.cjs')({client,one,check,request,a,b,adminA,adminB,user});
    if(process.argv.includes('--provider-requests'))await require('./provider-request-tests.cjs')({client,one,check,request,a,b,adminA,adminB,user});
    if(process.argv.includes('--customer-stops'))await require('./customer-stop-tests.cjs')({client,one,check,request,a,b,adminA,adminB,driverA,driverB,kcca,user});
    if (process.argv.includes('--access')) await require('./organization-access-tests.cjs')({client,one,check,request,authBase,orgBase,a,b,adminA,adminB,supervisor,driverA,driverB,kcca,system,citizen,fixturePassword,user});
    if (process.argv.includes('--recycling-isolation')) await require('./recycling-isolation-tests.cjs')({client,one,check,request,a,b,adminA,adminB,user});
    await client.query('UPDATE organizations SET is_active=false WHERE id=$1',[a]);
    check((await request(adminA,'/api/waste/inventory')).status === 403, 'Inactive organization denied in Waste');
    check((await request(adminA,'/api/organizations','GET',undefined,orgBase)).status === 403, 'Inactive organization denied in Organization');
    check((await request(adminA,'/api/auth/organization-users','GET',undefined,authBase)).status === 403, 'Inactive organization denied in Auth staff management');
    check((await request(adminA,'/api/auth/me','GET',undefined,authBase)).status === 403, 'Inactive organization denied in current session');
    check((await request(null,'/api/auth/login','POST',{email: adminA + '@rollback.invalid', password: fixturePassword},authBase)).status === 403, 'Inactive organization login denied');
    check((await request(adminB,'/api/waste/inventory')).status === 200, 'Other organization remains available');
    console.log('PASS: ' + checks + ' stabilization assertions (real PostgreSQL and service HTTP).');
  } finally {
    for (const server of servers) await new Promise(resolve => server.close(resolve));
    await client.query('ROLLBACK');
    await client.end();
    await Promise.all([dbPool.end(),orgPool.end(),authPool.end()]);
    console.log('All fixture records rolled back. No persistent test accounts or financial records.');
  }
}
main().catch(error => { console.error(error.message || error.code || error.name); process.exitCode = 1; });
