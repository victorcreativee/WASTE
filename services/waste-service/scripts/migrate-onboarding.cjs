const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('pg');require('dotenv').config({quiet:true});
async function main(){
 const url=new URL(process.env.DATABASE_URL);
 if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Local development database only');
 const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});await client.connect();
 try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('LOCK TABLE users,user_roles IN SHARE MODE');
  const snapshot=async()=>(await client.query('SELECT id,organization_id,status,password_hash FROM users ORDER BY id')).rows;
  const before=await snapshot();
  await client.query(fs.readFileSync(path.join(__dirname,'../../../infrastructure/database/025_company_onboarding.sql'),'utf8'));
  assert.deepEqual(await snapshot(),before);
  await client.query(process.argv.includes('--apply')?'COMMIT':'ROLLBACK');
  console.log(process.argv.includes('--apply')?'Migration 025 applied; existing users unchanged.':'Migration 025 validated and rolled back; existing users unchanged.');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
}main().catch(e=>{console.error(e.message);process.exitCode=1;});
