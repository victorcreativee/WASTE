// Local integration check. All fixture records are rolled back, including on failure.
require('dotenv').config();
const assert = require('node:assert/strict');
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const fixture = await client.query(`SELECT t.id, t.organization_id, u.id user_id
      FROM waste_trucks t JOIN users u ON u.organization_id=t.organization_id
      ORDER BY t.id,u.id LIMIT 1`);
    assert.equal(fixture.rowCount, 1, 'A local organization with a truck and user is required');
    const { id: truck, organization_id: org, user_id: user } = fixture.rows[0];
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`finance:${org}`]);
    const position = () => client.query(`SELECT organization_cash_position($1) cash,
      organization_committed_funds($1) committed`, [org]);
    const before = (await position()).rows[0];
    const fuel = await client.query(`INSERT INTO truck_fuel_records
      (truck_id,organization_id,litres,cost_ugx,fuel_date,recorded_by)
      VALUES($1,$2,10,100000,CURRENT_DATE,$3) RETURNING id`, [truck,org,user]);
    const linked = await client.query(`SELECT status,amount_ugx,source_type FROM organization_expenses
      WHERE organization_id=$1 AND source_id=$2`, [org,fuel.rows[0].id]);
    assert.equal(linked.rowCount, 1);
    assert.equal(linked.rows[0].status, 'draft');
    assert.equal(linked.rows[0].amount_ugx, '100000');
    assert.equal(linked.rows[0].source_type, 'fleet_fuel');

    const maintenance = await client.query(`INSERT INTO truck_maintenance_records
      (truck_id,organization_id,category,title,status,scheduled_date,cost_ugx,created_by)
      VALUES($1,$2,'repair','Rollback finance test','scheduled',CURRENT_DATE,200000,$3) RETURNING id`, [truck,org,user]);
    const source = maintenance.rows[0].id;
    const count = async () => (await client.query(`SELECT COUNT(*)::int n FROM organization_expenses
      WHERE organization_id=$1 AND source_type='fleet_maintenance' AND source_id=$2`, [org,source])).rows[0].n;
    assert.equal(await count(), 0, 'Scheduled work must not post an expense');
    await client.query(`UPDATE truck_maintenance_records SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=$1`, [source]);
    assert.equal(await count(), 1, 'Completion creates one linked expense');
    await client.query(`UPDATE truck_maintenance_records SET status='completed' WHERE id=$1`, [source]);
    assert.equal(await count(), 1, 'Repeated completion must not duplicate the expense');

    const freeFuel = await client.query(`INSERT INTO truck_fuel_records
      (truck_id,organization_id,litres,cost_ugx,fuel_date,recorded_by)
      VALUES($1,$2,10,0,CURRENT_DATE,$3) RETURNING id`, [truck,org,user]);
    const noExpense = await client.query('SELECT 1 FROM organization_expenses WHERE source_id=$1', [freeFuel.rows[0].id]);
    assert.equal(noExpense.rowCount, 0, 'Zero costs must not create payable expenses');
    assert.deepEqual((await position()).rows[0], before, 'Draft expenses must not change cash or commitments');
    console.log('PASS: fuel linkage, scheduled/completed maintenance, duplicate completion, zero cost, unchanged funding');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
    console.log('Test transaction rolled back; no fixture records retained.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
