import { Router, Request, Response, NextFunction } from "express";
import { changePassword, login, logout, me, refresh, register, registerApplicant } from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { AttemptLimiter } from "../utils/attempt-limiter";

const router = Router();
router.post("/refresh",async(req,res,next)=>{try{await refresh(req,res)}catch(error){next(error)}});
// Public on purpose: it identifies the session from the tokens it is given and never reveals whether one existed.
router.post("/logout",async(req,res,next)=>{try{await logout(req,res)}catch(error){next(error)}});
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

// Brute-force protection: per account+address, and a looser per-address ceiling.
const loginAccountAttempts = new AttemptLimiter(10, 15 * 60_000);
const loginAddressAttempts = new AttemptLimiter(100, 15 * 60_000);
router.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const address = req.ip || "unknown";
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const accountKey = `${address}|${email}`;
      const wait = Math.max(loginAddressAttempts.hit(address), loginAccountAttempts.hit(accountKey));
      if (wait) {
        res.setHeader("Retry-After", String(wait));
        return res.status(429).json({
          success: false,
          message: `Too many sign-in attempts. Wait ${Math.ceil(wait / 60)} minute(s) and try again.`,
        });
      }
      res.on("finish", () => {
        if (res.statusCode === 200) loginAccountAttempts.reset(accountKey);
      });
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
router.patch("/password",requireAuth,async(req,res,next)=>{try{await changePassword(req,res)}catch(error){next(error)}});

export default router;
