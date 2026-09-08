require('dotenv').config({quiet:true});
const readline=require('node:readline/promises');
const {stdin,stdout}=require('node:process');
const bcrypt=require('bcrypt');
const {Client}=require('pg');

async function hiddenQuestion(prompt){
 if(!stdin.isTTY)return '';
 stdout.write(prompt);stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');
 return await new Promise((resolve,reject)=>{let value='';const onData=key=>{if(key==='\u0003'){cleanup();reject(new Error('Cancelled'));return;}if(key==='\r'||key==='\n'){stdout.write('\n');cleanup();resolve(value);return;}if(key==='\u007f'){if(value){value=value.slice(0,-1);stdout.write('\b \b');}return;}if(key>=' '){value+=key;stdout.write('*');}};const cleanup=()=>{stdin.off('data',onData);stdin.setRawMode(false);stdin.pause();};stdin.on('data',onData);});
}

function validatePassword(value){
 if(Buffer.byteLength(value,'utf8')>72||value.length<12||!/[a-z]/.test(value)||!/[A-Z]/.test(value)||!/[0-9]/.test(value)||!/[^A-Za-z0-9]/.test(value))throw new Error('Password must be 12–72 bytes and contain uppercase, lowercase, number, and symbol characters');
}

async function main(){
 const url=new URL(process.env.DATABASE_URL);const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!local&&!process.env.ALLOW_REMOTE_SYSTEM_ADMIN_BOOTSTRAP)throw new Error('Remote bootstrap is disabled. Run this on the database host or explicitly configure the protected deployment process.');
 const rl=readline.createInterface({input:stdin,output:stdout});
 try{
  const fullName=(process.env.BOOTSTRAP_SYSTEM_ADMIN_NAME||await rl.question('System Admin full name: ')).trim();
  const email=(process.env.BOOTSTRAP_SYSTEM_ADMIN_EMAIL||await rl.question('System Admin email: ')).trim().toLowerCase();
  rl.close();
  const password=process.env.BOOTSTRAP_SYSTEM_ADMIN_PASSWORD||await hiddenQuestion('Temporary password (hidden): ');
  if(fullName.length<2)throw new Error('Full name is required');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('A valid email is required');validatePassword(password);
  if(!process.env.BOOTSTRAP_SYSTEM_ADMIN_PASSWORD){const confirmation=await hiddenQuestion('Confirm password (hidden): ');if(password!==confirmation)throw new Error('Passwords do not match');}
  const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
  try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('wms:first-system-admin'))");const existing=await client.query("SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='system_admin' LIMIT 1");if(existing.rowCount)throw new Error('A System Admin already exists. Use authenticated platform account management instead.');const duplicate=await client.query('SELECT 1 FROM users WHERE lower(email)=lower($1)',[email]);if(duplicate.rowCount)throw new Error('That email already belongs to an account');const hash=await bcrypt.hash(password,12);const user=await client.query("INSERT INTO users(organization_id,full_name,email,password_hash,status) VALUES(NULL,$1,$2,$3,'active') RETURNING id,email",[fullName,email,hash]);const role=await client.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='system_admin' RETURNING user_id",[user.rows[0].id]);if(!role.rowCount)throw new Error('System Admin role is missing; apply database migrations first');await client.query('COMMIT');console.log(`System Admin created for ${user.rows[0].email}. The password was hashed and was not printed.`);}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
 }finally{rl.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
