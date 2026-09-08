import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../middlewares/auth.middleware";
import { requireOrganizationPermission } from "../middlewares/organization-permission.middleware";
import { accessOverview, listMemberships, listAccessAudit, changeMembershipStatus, saveReviewRole, assignReviewRole } from "../repositories/organization-access.repository";
import { dbPool } from "../config/database";

const router=Router();
const query=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(10),search:z.string().trim().max(150).default("")});
const run=(fn:(req:AuthenticatedRequest,res:Response)=>Promise<unknown>)=>async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{try{await fn(req,res);}catch(e){next(e);}};
router.use("/organization-access",requireAuth,requireRoles("company_admin","supervisor","driver","iot_operator"));
router.get("/organization-access/me",run(async(req,res)=>{
  const result=await dbPool.query("SELECT code FROM organization_effective_permissions($1::uuid,$2::uuid)",[req.user!.userId,req.user!.organizationId]);
  const admin=await dbPool.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1::uuid AND r.name='company_admin'",[req.user!.userId]);
  res.json({success:true,data:{permissions:result.rows.map(r=>r.code),currentUserId:req.user!.userId,isAdministrator:!!admin.rowCount}});
}));
router.get("/organization-access",requireOrganizationPermission("access.read"),run(async(req,res)=>{
  res.json({success:true,data:await accessOverview(req.user!.organizationId!,req.user!.userId)});
}));
router.get("/organization-access/memberships",requireOrganizationPermission("access.read"),run(async(req,res)=>{
  const q=query.parse(req.query);res.json({success:true,data:await listMemberships(req.user!.organizationId!,q.page,q.pageSize,q.search)});
}));
router.get("/organization-access/audit",requireOrganizationPermission("audit.read"),run(async(req,res)=>{
  const q=query.parse(req.query);res.json({success:true,data:await listAccessAudit(req.user!.organizationId!,q.page,q.pageSize)});
}));
router.patch("/organization-access/memberships/:membershipId/status",requireRoles("company_admin"),requireOrganizationPermission("access.manage"),run(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.membershipId),{status}=z.object({status:z.enum(["active","suspended","inactive"])}).parse(req.body);
  const data=await changeMembershipStatus(req.user!.organizationId!,req.user!.userId,id,status);
  if(!data)return res.status(404).json({success:false,message:"Membership was not found in your organization"});
  return res.json({success:true,message:status==="active"?"Membership restored. The user account must also be active.":"Membership access stopped.",data});
}));
const reviewRole=z.object({name:z.string().trim().min(2).max(80),permissions:z.array(z.enum(["access.read","audit.read","staff.read","staff.manage","attendance.read","attendance.manage"])).min(1).max(6).refine(p=>p.includes("access.read")&&new Set(p).size===p.length,"Select access.read and unique supported permissions")}).strict();
router.post("/organization-access/roles",requireRoles("company_admin"),requireOrganizationPermission("access.manage"),run(async(req,res)=>{
  const body=reviewRole.parse(req.body);
  res.status(201).json({success:true,message:"Custom role created. Assign it to staff from Memberships.",data:await saveReviewRole(req.user!.organizationId!,req.user!.userId,null,body.name,body.permissions)});
}));
router.put("/organization-access/roles/:roleId",requireRoles("company_admin"),requireOrganizationPermission("access.manage"),run(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.roleId);
  const body=reviewRole.extend({expected:reviewRole}).parse(req.body);
  res.json({success:true,message:"Role updated. Changes apply to all assigned members on their next request.",data:await saveReviewRole(req.user!.organizationId!,req.user!.userId,id,body.name,body.permissions,body.expected)});
}));
router.put("/organization-access/memberships/:membershipId/roles/:roleId",requireRoles("company_admin"),requireOrganizationPermission("access.manage"),run(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.membershipId),roleId=z.string().uuid().parse(req.params.roleId);
  const {assigned}=z.object({assigned:z.boolean()}).strict().parse(req.body);
  res.json({success:true,message:assigned?"Custom role assigned. Only its selected permissions were granted.":"Custom role removed. Other role assignments remain unchanged.",data:await assignReviewRole(req.user!.organizationId!,req.user!.userId,id,roleId,assigned)});
}));
export default router;
