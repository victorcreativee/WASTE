import { Router, Request, Response, NextFunction } from "express";
import { changePassword, login, logout, me, refresh, register, registerApplicant } from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { AttemptLimiter } from "../utils/attempt-limiter";
import { requestSignInCode, signInWithCode, signInWithLink } from "../services/household.service";

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
// Household self-service: no email or password. A private link from the collection company, or (where SMS is
// configured) a phone number and one-time code. Each route has its own brute-force ceiling.
const householdLinkAttempts = new AttemptLimiter(30, 15 * 60_000);
const householdCodeRequests = new AttemptLimiter(3, 15 * 60_000);
const householdCodeAddress = new AttemptLimiter(20, 15 * 60_000);
const householdVerifyAttempts = new AttemptLimiter(30, 15 * 60_000);
const meta = (req: Request) => ({ userAgent: req.headers["user-agent"] ?? null, ipAddress: req.ip ?? null });
const tooMany = (res: Response, wait: number) => {
  res.setHeader("Retry-After", String(wait));
  return res.status(429).json({ success: false, message: `Too many attempts. Wait ${Math.ceil(wait / 60)} minute(s) and try again.` });
};
const answer = async (res: Response, work: () => Promise<unknown>, message: string) => {
  try {
    return res.status(200).json({ success: true, message, data: await work() });
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (!statusCode) throw error;
    return res.status(statusCode).json({ success: false, message: (error as Error).message });
  }
};
router.post("/households/link", async (req, res, next) => {
  try {
    const wait = householdLinkAttempts.hit(req.ip || "unknown");
    if (wait) return tooMany(res, wait);
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(401).json({ success: false, message: "This link no longer works. Ask your collection company for a new one." });
    await answer(res, () => signInWithLink(token, meta(req)), "Signed in");
  } catch (error) { next(error); }
});
router.post("/households/code", async (req, res, next) => {
  try {
    const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
    const wait = Math.max(householdCodeAddress.hit(req.ip || "unknown"), householdCodeRequests.hit(phone.replace(/\D/g, "").slice(-9)));
    if (wait) return tooMany(res, wait);
    await answer(res, () => requestSignInCode(phone), "If this number belongs to a household, a code is on its way");
  } catch (error) { next(error); }
});
router.post("/households/code/verify", async (req, res, next) => {
  try {
    const wait = householdVerifyAttempts.hit(req.ip || "unknown");
    if (wait) return tooMany(res, wait);
    const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    await answer(res, () => signInWithCode(phone, code, meta(req)), "Signed in");
  } catch (error) { next(error); }
});
router.patch("/password",requireAuth,async(req,res,next)=>{try{await changePassword(req,res)}catch(error){next(error)}});

export default router;
