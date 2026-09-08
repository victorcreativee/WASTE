import { Router, Request, Response, NextFunction } from "express";
import { login, me, register, registerApplicant } from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();
const applicantAttempts=new Map<string,{count:number;until:number}>();
router.post("/organization-applicants/register",(req,res,next)=>{const now=Date.now(),key=req.ip||"unknown";for(const [ip,value] of applicantAttempts)if(value.until<=now)applicantAttempts.delete(ip);const value=applicantAttempts.get(key)||{count:0,until:now+60000};value.count++;applicantAttempts.set(key,value);if(value.count>5)return res.status(429).json({success:false,message:"Too many registration attempts. Wait one minute and try again."});next();},async(req,res,next)=>{try{await registerApplicant(req,res)}catch(error){next(error)}});

router.post(
  "/register",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await register(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await login(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/me",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await me(req, res);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
