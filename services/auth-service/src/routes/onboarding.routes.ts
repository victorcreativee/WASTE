import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRoles, AuthenticatedRequest } from '../middlewares/auth.middleware';
import { issueAdminInvitation, revokeAdminInvitation, onboardingStatus, acceptAdminInvitation } from '../repositories/onboarding.repository';
const router=Router();
// Disabled until migration 025 and acceptance checks have been completed for this environment.
router.use('/organization-onboarding',(_req,res,next)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(process.env.WMS_ONBOARDING_ENABLED!=='true')return res.status(503).json({success:false,message:'Company onboarding is not enabled. Apply migration 025 and complete setup checks first.'});
 next();
});
const run=(fn:(req:AuthenticatedRequest,res:Response)=>Promise<unknown>)=>async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{try{await fn(req,res);}catch(error){next(error);}};
const email=z.string().trim().email().max(254);
// Conservative process-local throttle. Multi-instance production requires a shared rate limiter.
const attempts=new Map<string,{count:number;until:number}>();
router.post('/organization-onboarding/accept',(req,res,next)=>{
 const now=Date.now(),key=req.ip||'unknown';
 for(const [ip,entry] of attempts)if(entry.until<=now)attempts.delete(ip);
 const entry=attempts.get(key)||{count:0,until:now+60000};entry.count++;attempts.set(key,entry);
 if(entry.count>5||attempts.size>10000)return res.status(429).json({success:false,message:'Too many setup attempts. Wait one minute and try again.'});next();
},run(async(req,res)=>{
 const body=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),email,fullName:z.string().trim().min(2).max(150),password:z.string().min(12).max(72).refine(p=>Buffer.byteLength(p,'utf8')<=72,'Password must be at most 72 bytes')}).strict().parse(req.body);
 res.status(201).json({success:true,...await acceptAdminInvitation(body.token,body.email,body.fullName,body.password)});
}));
router.use('/organization-onboarding',requireAuth,requireRoles('system_admin'));
router.get('/organization-onboarding/:organizationId',run(async(req,res)=>res.json({success:true,data:await onboardingStatus(z.string().uuid().parse(req.params.organizationId))})));
router.post('/organization-onboarding/:organizationId/invitations',run(async(req,res)=>{
 const id=z.string().uuid().parse(req.params.organizationId),body=z.object({email}).strict().parse(req.body);
 res.status(201).json({success:true,data:await issueAdminInvitation(id,req.user!.userId,body.email)});
}));
router.delete('/organization-onboarding/:organizationId/invitations/:invitationId',run(async(req,res)=>res.json({success:true,data:await revokeAdminInvitation(z.string().uuid().parse(req.params.organizationId),req.user!.userId,z.string().uuid().parse(req.params.invitationId))})));
export default router;
