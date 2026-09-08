const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('pg');require('dotenv').config({quiet:true});
async function main(){
 const url=new URL(process.env.DATABASE_URL);
 if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Local development database only');
 const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});await client.connect();
 try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('LOCK TABLE customer_service_locations,customer_profiles IN SHARE MODE');
  const financialSnapshot=async()=>(await client.query(`SELECT
    (SELECT count(*)::int FROM customer_contracts) contracts,
    (SELECT count(*)::int FROM customer_subscriptions) subscriptions,
    (SELECT count(*)::int FROM customer_invoices) invoices,
    (SELECT count(*)::int FROM customer_payments) payments,
    (SELECT count(*)::int FROM customer_service_locations WHERE organization_id IS NOT NULL) assigned_locations`)).rows[0];
  const before=await financialSnapshot();
  await client.query(fs.readFileSync(path.join(__dirname,'../../../infrastructure/database/026_customer_service_relationships.sql'),'utf8'));
  const after=await financialSnapshot();assert.deepEqual(after,before,'Migration must not modify assignments or financial rows');
  const current=(await client.query("SELECT count(*)::int count FROM customer_service_relationships WHERE status IN ('active','suspended')")).rows[0].count;
  const covered=(await client.query('SELECT count(DISTINCT service_location_id)::int count FROM customer_service_relationships')).rows[0].count;
  assert.equal(covered,before.assigned_locations,'Every assigned service location requires relationship history');
  const mismatch=(await client.query(`SELECT count(*)::int count FROM customer_service_relationships csr
    JOIN customer_service_locations csl ON csl.id=csr.service_location_id
    WHERE csr.status IN ('active','suspended') AND (csr.customer_id<>csl.customer_id OR csr.organization_id<>csl.organization_id)`)).rows[0].count;
  assert.equal(mismatch,0,'Backfill must exactly mirror existing ownership');
  await client.query(process.argv.includes('--apply')?'COMMIT':'ROLLBACK');
  console.log(process.argv.includes('--apply')
    ?`Migration 026 applied; ${current} existing assignments preserved.`
    :`Migration 026 validated and rolled back; ${current} assignments checked.`);
 }catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
}main().catch(e=>{console.error(e.message);process.exitCode=1;});
