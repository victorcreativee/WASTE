require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),{Client}=require('pg');
async function main(){
 const url=new URL(process.env.DATABASE_URL);
 if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Local development database only');
 const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
 await client.connect();
 try{
  await client.query('BEGIN');
  await client.query(fs.readFileSync(path.join(__dirname,'../../../infrastructure/database/042_account_application_resubmission.sql'),'utf8'));
  await client.query(process.argv.includes('--apply')?'COMMIT':'ROLLBACK');
  console.log(process.argv.includes('--apply')?'Migration 042 applied.':'Migration 042 validated and rolled back.');
 }catch(error){await client.query('ROLLBACK');throw error}finally{await client.end()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
