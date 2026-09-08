import { Router } from 'express';
import { z } from 'zod';
import { dbPool } from '../config/database';
import { AuthenticatedRequest, requireRoles } from '../middlewares/auth.middleware';

const router=Router();
const contact=z.object({email:z.union([z.string().trim().email().max(254),z.literal('')]),phone:z.string().trim().max(50),address:z.string().trim().max(500)}).strict();
const profileSelect='SELECT id,name,type,is_active,email,phone,address FROM organizations WHERE id=$1::uuid';
router.use('/workspace',requireRoles('company_admin'));
router.get('/workspace',async(req:AuthenticatedRequest,res)=>{
 try{
  const org=req.auth!.organizationId!;
  const profile=(await dbPool.query(profileSelect,[org])).rows[0];
  const counts=(await dbPool.query(`SELECT
    (SELECT count(*)::int FROM organization_memberships m JOIN users u ON u.id=m.user_id AND u.organization_id=m.organization_id WHERE m.organization_id=$1::uuid AND m.status='active' AND u.status='active' AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name IN ('driver','supervisor'))) staff,
    (SELECT count(*)::int FROM service_plans WHERE organization_id=$1::uuid AND is_active) packages,
    (SELECT count(*)::int FROM customer_service_locations WHERE organization_id=$1::uuid) locations,
    (SELECT count(*)::int FROM waste_trucks WHERE organization_id=$1::uuid) vehicles`,[org])).rows[0];
  res.json({success:true,data:{profile,counts}});
 }catch{res.status(500).json({success:false,message:'Could not load company setup. Try again.'});}
});
router.patch('/workspace',async(req:AuthenticatedRequest,res)=>{
 const parsed=contact.extend({expected:contact}).strict().safeParse(req.body);
 if(!parsed.success)return res.status(400).json({success:false,message:'Enter a valid email, phone (up to 50 characters) and address (up to 500 characters). Only contact details can be changed.'});
 const client=await dbPool.connect();
 try{
  await client.query('BEGIN');
  const org=req.auth!.organizationId!,actor=req.auth!.userId;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`access:${org}`]);
  const allowed=await client.query(`SELECT 1 FROM users u JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=u.organization_id
   JOIN organizations o ON o.id=m.organization_id WHERE u.id=$1::uuid AND u.organization_id=$2::uuid AND u.status='active' AND m.status='active' AND o.is_active
   AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='company_admin')`,[actor,org]);
  if(!allowed.rowCount)throw Object.assign(new Error('Active company-administrator access is required'),{status:403});
  const previous=(await client.query(profileSelect+' FOR UPDATE',[org])).rows[0];
  const before={email:previous.email||'',phone:previous.phone||'',address:previous.address||''};
  if(Object.keys(before).some(k=>before[k as keyof typeof before]!==parsed.data.expected[k as keyof typeof before]))throw Object.assign(new Error('Contact details changed since you opened this page. Reload before saving.'),{status:409});
  const {email,phone,address}=parsed.data;
  await client.query('UPDATE organizations SET email=$2,phone=$3,address=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid',[org,email||null,phone||null,address||null]);
  if(before.email!==email||before.phone!==phone||before.address!==address)await client.query(`INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,previous_value,new_value)
   VALUES($1::uuid,$2::uuid,'contact_updated','organization',$1::uuid,$3::jsonb,$4::jsonb)`,[org,actor,JSON.stringify(before),JSON.stringify({email,phone,address})]);
  await client.query('COMMIT');return res.json({success:true,message:'Company contact details saved.'});
 }catch(error){await client.query('ROLLBACK');const e=error as Error&{status?:number};return res.status(e.status||500).json({success:false,message:e.status?e.message:'Could not save company details. Try again.'});}finally{client.release();}
});
export default router;
