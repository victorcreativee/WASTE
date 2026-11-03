import {NextFunction,Request,Response,Router} from 'express';
import {z} from 'zod';
import {AttemptLimiter} from '../utils/attempt-limiter';
import {confirmEmailVerification,requestEmailVerification} from '../services/email-verification.service';

const router=Router();
const requestLimit=new AttemptLimiter(3,15*60_000),addressLimit=new AttemptLimiter(20,15*60_000),confirmLimit=new AttemptLimiter(20,15*60_000);
const emailSchema=z.object({email:z.string().trim().toLowerCase().email().max(254)}).strict();
const tokenSchema=z.object({token:z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/,'Use the complete verification link')}).strict();
const run=(handler:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response,next:NextFunction)=>{try{await handler(req,res)}catch(error){next(error)}};
const limited=(res:Response,wait:number)=>{res.setHeader('Retry-After',String(wait));return res.status(429).json({success:false,message:`Too many attempts. Wait ${Math.ceil(wait/60)} minute(s) and try again.`});};

router.post('/email-verification/request',run(async(req,res)=>{
 const input=emailSchema.parse(req.body),address=req.ip||'unknown';
 const wait=Math.max(requestLimit.hit(`${address}|${input.email}`),addressLimit.hit(address));
 if(wait)return limited(res,wait);
 await requestEmailVerification(input.email);
 return res.json({success:true,message:'If this account needs verification, a new email is on its way.'});
}));

router.post('/email-verification/confirm',run(async(req,res)=>{
 const wait=confirmLimit.hit(req.ip||'unknown');if(wait)return limited(res,wait);
 const data=await confirmEmailVerification(tokenSchema.parse(req.body).token);
 return res.json({success:true,message:'Email verified. You can now sign in.',data});
}));

export default router;
