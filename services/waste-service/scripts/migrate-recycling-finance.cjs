const fs=require('fs');const path=require('path');const {Pool}=require('pg');require('dotenv').config({path:path.resolve(__dirname,'../.env')});
const apply=process.argv.includes('--apply'),url=process.env.DATABASE_URL||'';
if(!url)throw new Error('DATABASE_URL is required');
if(!/(localhost|127\.0\.0\.1)/.test(url)&&process.env.ALLOW_NON_LOCAL_MIGRATION!=='true')throw new Error('Refusing non-local migration without ALLOW_NON_LOCAL_MIGRATION=true');
const sql=fs.readFileSync(path.resolve(__dirname,'../../../infrastructure/database/062_recycling_finance_integration.sql'),'utf8'),pool=new Pool({connectionString:url});
(async()=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query(sql);if(apply){await c.query('COMMIT');console.log('Migration 062 applied.')}else{await c.query('ROLLBACK');console.log('Migration 062 validated and rolled back.')}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release();await pool.end()}})().catch(e=>{console.error(e);process.exit(1)});
