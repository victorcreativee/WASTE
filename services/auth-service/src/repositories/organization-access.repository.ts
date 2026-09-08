import { dbPool } from "../config/database";
import type { PoolClient } from "pg";

export async function accessOverview(org:string,user:string) {
  const roles=await dbPool.query(`SELECT r.id,r.name,r.legacy_role_name,
    COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER(WHERE rp.permission_code IS NOT NULL),'{}') permissions
    FROM organization_roles r LEFT JOIN organization_role_permissions rp ON rp.role_id=r.id AND rp.organization_id=r.organization_id
    WHERE r.organization_id=$1::uuid GROUP BY r.id ORDER BY r.name`,[org]);
  const catalog=await dbPool.query("SELECT * FROM organization_permission_catalog ORDER BY module,code");
  const effective=await dbPool.query("SELECT code FROM organization_effective_permissions($1::uuid,$2::uuid) ORDER BY code",[user,org]);
  return {roles:roles.rows,catalog:catalog.rows,effectivePermissions:effective.rows.map(r=>r.code),currentUserId:user};
}
export async function listMemberships(org:string,page:number,pageSize:number,search:string) {
  const params=[org,`%${search}%`];
  const condition="m.organization_id=$1::uuid AND (u.full_name ILIKE $2 OR u.email ILIKE $2)";
  const total=Number((await dbPool.query(`SELECT count(*) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE ${condition}`,params)).rows[0].count);
  const actualPage=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
  const result=await dbPool.query(`SELECT m.id,m.user_id,m.status,u.status account_status,u.full_name,u.email,
    COALESCE(array_agg(DISTINCT r.name) FILTER(WHERE r.name IS NOT NULL),'{}') roles,
    COALESCE(array_agg(DISTINCT r.id) FILTER(WHERE r.id IS NOT NULL AND r.legacy_role_name IS NULL),'{}') custom_role_ids,
    COALESCE(bool_or(r.legacy_role_name='company_admin'),false) protected
    FROM organization_memberships m JOIN users u ON u.id=m.user_id
    LEFT JOIN organization_membership_roles mr ON mr.membership_id=m.id AND mr.organization_id=m.organization_id
    LEFT JOIN organization_roles r ON r.id=mr.role_id AND r.organization_id=mr.organization_id
    WHERE ${condition} GROUP BY m.id,u.id ORDER BY u.full_name,m.id LIMIT $3 OFFSET $4`,[...params,pageSize,(actualPage-1)*pageSize]);
  return {items:result.rows,total,page:actualPage,pageSize};
}

// Delegation is bounded to directory, driver account/team management and attendance; no financial or access-management grants.
export const delegatedAccessPermissions = ["access.read", "audit.read", "staff.read", "staff.manage", "attendance.read", "attendance.manage"];
const accessError = (message:string,statusCode=409) => Object.assign(new Error(message),{statusCode});
async function accessTransaction<T>(org:string,actor:string,work:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`access:${org}`]);
    await client.query("SELECT set_config('wms.actor_id',$1,true)",[actor]);
    const allowed=await client.query(`SELECT 1 FROM organization_effective_permissions($1::uuid,$2::uuid) p
      WHERE p.code='access.manage' AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1::uuid AND r.name='company_admin')`,[actor,org]);
    if(!allowed.rowCount)throw accessError("Only an authorized company administrator can manage review roles",403);
    const result=await work(client);await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function saveReviewRole(org:string,actor:string,id:string|null,name:string,permissions:string[],expected?:{name:string;permissions:string[]}) {
  return accessTransaction(org,actor,async client=>{
    const reserved=await client.query("SELECT 1 FROM roles WHERE lower(name)=lower($1)",[name]);
    if(reserved.rowCount)throw accessError("This name is reserved for a built-in operational role",400);
    if(!permissions.includes("access.read")||permissions.some(p=>!delegatedAccessPermissions.includes(p)))throw accessError("Select only supported custom-role permissions, including access.read",400);
    if(permissions.includes("staff.manage")&&!permissions.includes("staff.read"))throw accessError("Staff management requires staff viewing",400);
    if((permissions.includes("attendance.read")&&!permissions.includes("staff.read"))||(permissions.includes("attendance.manage")&&!permissions.includes("attendance.read")))throw accessError("Attendance requires staff viewing; recording attendance also requires attendance viewing",400);
    const effective=await client.query("SELECT code FROM organization_effective_permissions($1::uuid,$2::uuid)",[actor,org]);
    if(permissions.some(p=>!effective.rows.some((r:any)=>r.code===p)))throw accessError("You cannot grant a permission you do not hold",403);
    if(id){
      const old=await client.query("SELECT * FROM organization_roles WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE",[id,org]);
      if(!old.rowCount)throw accessError("Role was not found in your organization",404);
      if(old.rows[0].legacy_role_name)throw accessError("Built-in operational roles cannot be edited here");
      const grants=await client.query("SELECT permission_code FROM organization_role_permissions WHERE role_id=$1::uuid",[id]);
      const previous=grants.rows.map((r:any)=>r.permission_code).sort();
      if(previous.some((p:string)=>!delegatedAccessPermissions.includes(p)))throw accessError("This role requires a broader permission-management workflow");
      if(!expected||expected.name!==old.rows[0].name||JSON.stringify([...expected.permissions].sort())!==JSON.stringify(previous))throw accessError("This role changed since you opened it. Refresh and review it again.");
    }
    const duplicate=await client.query("SELECT 1 FROM organization_roles WHERE organization_id=$1::uuid AND lower(name)=lower($2) AND ($3::uuid IS NULL OR id<>$3::uuid)",[org,name,id]);
    if(duplicate.rowCount)throw accessError("A role with this name already exists");
    const role=id?(await client.query("UPDATE organization_roles SET name=$3 WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *",[id,org,name])).rows[0]
      :(await client.query("INSERT INTO organization_roles(organization_id,name) VALUES($1::uuid,$2) RETURNING *",[org,name])).rows[0];
    await client.query("DELETE FROM organization_role_permissions WHERE role_id=$1::uuid AND NOT(permission_code=ANY($2::text[]))",[role.id,permissions]);
    for(const permission of permissions)await client.query("INSERT INTO organization_role_permissions(organization_id,role_id,permission_code) VALUES($1::uuid,$2::uuid,$3) ON CONFLICT DO NOTHING",[org,role.id,permission]);
    return {...role,permissions};
  });
}
export async function assignReviewRole(org:string,actor:string,membershipId:string,roleId:string,assigned:boolean) {
  return accessTransaction(org,actor,async client=>{
    const member=await client.query(`SELECT m.* FROM organization_memberships m JOIN users u ON u.id=m.user_id AND u.organization_id=m.organization_id
      WHERE m.id=$1::uuid AND m.organization_id=$2::uuid FOR UPDATE OF m`,[membershipId,org]);
    const role=await client.query("SELECT * FROM organization_roles WHERE id=$1::uuid AND organization_id=$2::uuid",[roleId,org]);
    if(!member.rowCount||!role.rowCount)throw accessError("Membership or role was not found in your organization",404);
    const admin=await client.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1::uuid AND r.name='company_admin'",[member.rows[0].user_id]);
    if(admin.rowCount||member.rows[0].user_id===actor)throw accessError("Administrator and own role assignments are protected");
    if(role.rows[0].legacy_role_name)throw accessError("Built-in operational role assignments cannot be changed here");
    const grants=await client.query("SELECT permission_code FROM organization_role_permissions WHERE role_id=$1::uuid",[roleId]);
    if(grants.rows.some((r:any)=>!delegatedAccessPermissions.includes(r.permission_code)))throw accessError("Only supported custom roles can be assigned here");
    if(assigned){
      const effective=await client.query("SELECT code FROM organization_effective_permissions($1::uuid,$2::uuid)",[actor,org]);
      if(grants.rows.some((r:any)=>!effective.rows.some((p:any)=>p.code===r.permission_code)))throw accessError("You cannot grant a permission you do not hold",403);
      await client.query("INSERT INTO organization_membership_roles(organization_id,membership_id,role_id) VALUES($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING",[org,membershipId,roleId]);
    }else await client.query("DELETE FROM organization_membership_roles WHERE organization_id=$1::uuid AND membership_id=$2::uuid AND role_id=$3::uuid",[org,membershipId,roleId]);
    return {membershipId,roleId,assigned};
  });
}
export async function listAccessAudit(org:string,page:number,pageSize:number) {
  const total=Number((await dbPool.query("SELECT count(*) FROM organization_audit_events WHERE organization_id=$1::uuid",[org])).rows[0].count);
  const actualPage=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
  const result=await dbPool.query(`SELECT e.id,e.action,e.entity_type,e.entity_id,e.previous_value,e.new_value,e.created_at,u.full_name actor_name
    FROM organization_audit_events e LEFT JOIN users u ON u.id=e.actor_id
    WHERE e.organization_id=$1::uuid ORDER BY e.created_at DESC,e.id DESC LIMIT $2 OFFSET $3`,[org,pageSize,(actualPage-1)*pageSize]);
  return {items:result.rows,total,page:actualPage,pageSize};
}
export async function changeMembershipStatus(org:string,actor:string,id:string,status:string) {
  const client=await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`access:${org}`]);
    await client.query("SELECT set_config('wms.actor_id',$1,true)",[actor]);
    const allowed=await client.query("SELECT 1 FROM organization_effective_permissions($1::uuid,$2::uuid) WHERE code='access.manage'",[actor,org]);
    if(!allowed.rowCount) throw Object.assign(new Error("Membership management permission is required"),{statusCode:403});
    const found=await client.query("SELECT * FROM organization_memberships WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE",[id,org]);
    const member=found.rows[0];
    if(!member){await client.query("ROLLBACK");return null;}
    const protectedRole=await client.query(`SELECT 1 FROM organization_membership_roles mr JOIN organization_roles r ON r.id=mr.role_id AND r.organization_id=mr.organization_id
      WHERE mr.membership_id=$1::uuid AND mr.organization_id=$2::uuid AND r.legacy_role_name='company_admin'`,[id,org]);
    if(member.user_id===actor||protectedRole.rowCount) throw Object.assign(new Error("Administrator and own memberships are protected. Use a reviewed administrator-transfer workflow."),{statusCode:409});
    if(member.status===status){await client.query("COMMIT");return member;}
    const result=await client.query("UPDATE organization_memberships SET status=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING id,user_id,status",[id,org,status]);
    await client.query("COMMIT");return result.rows[0];
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
