import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../middlewares/auth.middleware";
import { AttemptLimiter } from "../utils/attempt-limiter";
import { confirmPasswordReset, requestPasswordReset, sendPasswordResetByAdministrator } from "../services/password-reset.service";

const router = Router();
// Per address and email, and per address overall, so one person cannot flood an inbox or probe many accounts.
const requestLimit = new AttemptLimiter(3, 15 * 60_000), addressLimit = new AttemptLimiter(20, 15 * 60_000), confirmLimit = new AttemptLimiter(20, 15 * 60_000);
const run = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => { try { await handler(req, res); } catch (error) { next(error); } };
const limited = (res: Response, wait: number) => { res.setHeader("Retry-After", String(wait)); return res.status(429).json({ success: false, message: `Too many attempts. Wait ${Math.ceil(wait / 60)} minute(s) and try again.` }); };

// The same rules as choosing a password when changing it while signed in.
export const newPassword = z.string().min(12, "Use at least 12 characters").max(72, "Use at most 72 characters")
  .refine(value => Buffer.byteLength(value, "utf8") <= 72 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value), "Use uppercase, lowercase and a number");
export const requestSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254) }).strict();
export const confirmSchema = z.object({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/, "Use the complete reset link"), password: newPassword }).strict();

router.post("/password-reset/request", run(async (req, res) => {
  const input = requestSchema.parse(req.body), address = req.ip || "unknown";
  const wait = Math.max(requestLimit.hit(`${address}|${input.email}`), addressLimit.hit(address));
  if (wait) return limited(res, wait);
  await requestPasswordReset(input.email);
  return res.json({ success: true, message: "If an active account uses this email, a reset link is on its way. Check your inbox and spam folder." });
}));

router.post("/password-reset/confirm", run(async (req, res) => {
  const wait = confirmLimit.hit(req.ip || "unknown"); if (wait) return limited(res, wait);
  const input = confirmSchema.parse(req.body);
  const data = await confirmPasswordReset(input.token, input.password);
  return res.json({ success: true, message: "Your password has been changed. Sign in with the new password.", data });
}));

// Administrators: the link is emailed and also returned, so it can be passed on when the inbox does not receive mail.
router.post("/users/:userId/password-reset", requireAuth, requireRoles("system_admin", "company_admin"), run(async (req, res) => {
  const userId = z.guid().parse(req.params.userId);
  const data = await sendPasswordResetByAdministrator((req as AuthenticatedRequest).user!.userId, userId);
  return res.status(201).json({ success: true, message: data.emailed ? `Reset link emailed to ${data.email}. You can also copy it below.` : `The email could not be sent. Copy the link below and give it to ${data.fullName} directly.`, data });
}));

export default router;
