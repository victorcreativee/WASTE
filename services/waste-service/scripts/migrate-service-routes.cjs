require("dotenv").config();
const fs=require("node:fs"),path=require("node:path"),{Client}=require("pg");
async function main(){
  const url=new URL(process.env.DATABASE_URL);
  if(process.env.NODE_ENV==="production"||!["localhost","127.0.0.1","[::1]"].includes(url.hostname))throw Error("Local development database only");
  const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
  await client.connect();
  try{
    await client.query("BEGIN");
    await client.query(fs.readFileSync(path.join(__dirname,"../../../infrastructure/database/043_service_routes.sql"),"utf8"));
    const tables=await client.query(`SELECT to_regclass('public.service_routes') routes,to_regclass('public.service_route_customers') customers`);
    if(!tables.rows[0].routes||!tables.rows[0].customers)throw Error("Service-route tables were not created");
    if(process.argv.includes("--apply")){await client.query("COMMIT");console.log("Migration 043 applied; existing operational data preserved.");}
    else{await client.query("ROLLBACK");console.log("Migration 043 validated and rolled back; existing operational data preserved.");}
  }catch(error){await client.query("ROLLBACK");throw error;}finally{await client.end();}
}
main().catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
