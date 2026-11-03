import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import {dbPool} from '../config/database';

const publicAppUrl=()=>String(process.env.PUBLIC_APP_URL||'http://localhost:3000').replace(/\/+$/,'');
const hash=(token:string)=>crypto.createHash('sha256').update(token).digest('hex');
let transport:ReturnType<typeof nodemailer.createTransport>|null=null;

async function deliver(to:string,fullName:string,token:string){
 const link=`${publicAppUrl()}/verify-email?token=${encodeURIComponent(token)}`;
 const subject='Verify your Kampala WMS email';
 const text=`Hello ${fullName},\n\nVerify this email address to activate your Kampala WMS sign-in:\n${link}\n\nThis link expires in 30 minutes and can be used once. If you did not create this account, you can ignore this email.`;
 const provider=String(process.env.AUTH_EMAIL_PROVIDER||process.env.NOTIFY_EMAIL_PROVIDER||(process.env.NODE_ENV==='production'?'off':'log')).toLowerCase();
 if(provider==='smtp'&&process.env.SMTP_URL){
  transport??=nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({from:process.env.NOTIFY_EMAIL_FROM||'Kampala WMS <no-reply@kampalawms.com>',to,subject,text});
  return true;
 }
 // Over HTTPS, because the droplet's outgoing SMTP ports are blocked.
 if(provider==='resend'&&process.env.RESEND_API_KEY){
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${process.env.RESEND_API_KEY}`},body:JSON.stringify({from:process.env.NOTIFY_EMAIL_FROM||'Kampala WMS <no-reply@kampalawms.com>',to:[to],subject,text}),signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(`Resend answered ${response.status}`);
  return true;
 }
 if(provider==='webhook'&&process.env.NOTIFY_WEBHOOK_URL){
  const response=await fetch(process.env.NOTIFY_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json',...(process.env.NOTIFY_WEBHOOK_SECRET?{'authorization':`Bearer ${process.env.NOTIFY_WEBHOOK_SECRET}`}:{})},body:JSON.stringify({channel:'email',to,subject,text})});
  if(!response.ok)throw new Error(`Email webhook returned ${response.status}`);
  return true;
 }
 if(provider==='log'&&process.env.NODE_ENV!=='production'){
  console.info(`[auth-email] verification link for ${to}: ${link}`);
  return true;
 }
 return false;
}

/** Rotates the one-time token, stores only its hash, and sends the raw token only by email. */
export async function issueEmailVerification(userId:string){
 const client=await dbPool.connect();
 let user:{email:string;full_name:string}|undefined,token='';
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`email-verification:${userId}`]);
  user=(await client.query(`SELECT email,full_name FROM users WHERE id=$1::uuid AND status='active' AND email_verification_required=true AND email_verified_at IS NULL FOR UPDATE`,[userId])).rows[0];
  if(!user){await client.query('ROLLBACK');return{required:false,sent:false};}
  token=crypto.randomBytes(32).toString('base64url');
  await client.query('DELETE FROM email_verification_tokens WHERE user_id=$1::uuid AND consumed_at IS NULL',[userId]);
  await client.query(`INSERT INTO email_verification_tokens(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 minutes')`,[userId,hash(token)]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 try{return{required:true,sent:await deliver(user.email,user.full_name,token)};}
 catch(error){console.error('Email verification delivery failed',error instanceof Error?error.message:'unknown error');return{required:true,sent:false};}
}

/** Generic resend response prevents discovering whether an email address is registered. */
export async function requestEmailVerification(email:string){
 const user=(await dbPool.query(`SELECT id FROM users WHERE lower(email)=lower($1) AND status='active' AND email_verification_required=true AND email_verified_at IS NULL`,[email])).rows[0];
 if(user)await issueEmailVerification(user.id);
 return{accepted:true};
}

export async function confirmEmailVerification(token:string){
 const client=await dbPool.connect();
 try{
  await client.query('BEGIN');
  const record=(await client.query(`SELECT t.id,t.user_id,u.email FROM email_verification_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.consumed_at IS NULL AND t.expires_at>NOW() FOR UPDATE OF t,u`,[hash(token)])).rows[0];
  if(!record)throw Object.assign(new Error('This verification link is invalid or has expired. Request a new email.'),{statusCode:400});
  await client.query(`UPDATE users SET email_verified_at=NOW(),email_verification_required=false,updated_at=NOW() WHERE id=$1::uuid`,[record.user_id]);
  await client.query(`UPDATE email_verification_tokens SET consumed_at=NOW() WHERE user_id=$1::uuid AND consumed_at IS NULL`,[record.user_id]);
  await client.query('COMMIT');return{email:record.email,verified:true};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
