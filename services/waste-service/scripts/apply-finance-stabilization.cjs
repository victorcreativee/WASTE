// Apply only the reviewed Phase 0B migration to a local development database.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (process.env.NODE_ENV === 'production' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) {
    throw new Error('This migration runner is restricted to the local development database.');
  }
  const client = new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query('LOCK TABLE organization_finance_settings IN SHARE MODE');
    const before=await client.query('SELECT * FROM organization_finance_settings ORDER BY organization_id');
    await client.query(fs.readFileSync(path.join(__dirname,'../../../infrastructure/database/023_finance_stabilization.sql'),'utf8'));
    const after=await client.query('SELECT * FROM organization_finance_settings ORDER BY organization_id');
    if(JSON.stringify(before.rows)!==JSON.stringify(after.rows)) throw new Error('Existing finance settings unexpectedly changed');
    const count=await client.query('SELECT COUNT(*)::int n FROM organization_finance_setting_history');
    await client.query('COMMIT');
    console.log('Migration 023 applied. Existing opening settings preserved; history rows: '+count.rows[0].n);
  } catch(error) {
    await client.query('ROLLBACK');throw error;
  } finally { await client.end(); }
}
main().catch(error=>{console.error(error.message||error.code);process.exitCode=1;});
