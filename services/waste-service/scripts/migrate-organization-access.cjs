// Local-only additive migration; default is rollback validation. Use --apply after validation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('pg');
require('dotenv').config({quiet:true});
async function main(){
 const url=new URL(process.env.DATABASE_URL);
 if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Local development database only');
 const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
 await client.connect();
 try{
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('LOCK TABLE users,user_roles,roles IN SHARE MODE');
  const snapshot=async()=>(await client.query("SELECT u.id,u.organization_id,u.status,u.password_hash,COALESCE(array_agg(ur.role_id ORDER BY ur.role_id) FILTER(WHERE ur.role_id IS NOT NULL),'{}') roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id GROUP BY u.id ORDER BY u.id")).rows;
  const before=await snapshot();
  await client.query(fs.readFileSync(path.join(__dirname,'../../../infrastructure/database/024_organization_access.sql'),'utf8'));
  assert.deepEqual(await snapshot(),before,'Migration must preserve every existing identity, password and global role');
  const missing=await client.query(`SELECT COUNT(*)::int n FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
    WHERE u.organization_id IS NOT NULL AND r.name IN ('company_admin','supervisor','driver','iot_operator')
    AND NOT EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_membership_roles mr ON mr.membership_id=m.id
      JOIN organization_roles ar ON ar.id=mr.role_id WHERE m.user_id=u.id AND m.organization_id=u.organization_id AND ar.legacy_role_name=r.name)`);
  assert.equal(missing.rows[0].n,0,'Every current tenant role must have its scoped binding');
  const excessive=await client.query(`SELECT COUNT(*)::int n FROM organization_role_permissions rp JOIN organization_roles r ON r.id=rp.role_id
    WHERE r.legacy_role_name IN ('supervisor','driver','iot_operator')`);
  assert.equal(excessive.rows[0].n,0,'Do not grant administration permissions to operational roles');
  const counts=await client.query('SELECT (SELECT count(*)::int FROM organization_memberships) memberships,(SELECT count(*)::int FROM organization_roles) roles');
  if(process.argv.includes('--apply')){await client.query('COMMIT');console.log('Migration 024 APPLIED; identities/global roles unchanged; verified scoped backfill:',counts.rows[0]);}
  else{await client.query('ROLLBACK');console.log('Migration 024 validation PASSED and rolled back:',counts.rows[0]);}
 }catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
}
main().catch(e=>{console.error(e.message||e.code);process.exitCode=1;});
