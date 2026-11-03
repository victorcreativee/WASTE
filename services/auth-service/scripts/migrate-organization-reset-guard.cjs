const fs=require("node:fs"),path=require("node:path"),{Pool}=require("pg");require("dotenv").config({path:path.resolve(__dirname,"../.env")});
const apply=process.argv.includes("--apply"),url=process.env.DATABASE_URL||"";
if(!url)throw new Error("DATABASE_URL is required");
if(!/(localhost|127\.0\.0\.1|@database:|@db:|@postgres:)/.test(url)&&process.env.ALLOW_NON_LOCAL_MIGRATION!=="true")throw new Error("Refusing non-local migration without ALLOW_NON_LOCAL_MIGRATION=true");
const sql=fs.readFileSync(path.resolve(__dirname,"../../../infrastructure/database/107_organization_reset_guard.sql"),"utf8"),pool=new Pool({connectionString:url});
(async()=>{const client=await pool.connect();try{await client.query("BEGIN");await client.query(sql);if(apply){await client.query("COMMIT");console.log("Organization reset guard applied.")}else{await client.query("ROLLBACK");console.log("Organization reset guard validated and rolled back.")}}catch(error){await client.query("ROLLBACK");throw error}finally{client.release();await pool.end()}})().catch(error=>{console.error(error);process.exit(1)});
