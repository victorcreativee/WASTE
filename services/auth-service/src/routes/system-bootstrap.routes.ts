import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";

import {
  createFirstSystemAdmin,
  systemBootstrapStatus,
} from "../repositories/system-bootstrap.repository";

const router = Router();

const attempts = new Map<
  string,
  { count: number; until: number }
>();

const schema = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(254),
  password: z.string()
    .min(12)
    .max(72)
    .refine(
      password =>
        Buffer.byteLength(password, "utf8") <= 72 &&
        /[a-z]/.test(password) &&
        /[A-Z]/.test(password) &&
        /[0-9]/.test(password) &&
        /[^A-Za-z0-9]/.test(password),
      "Password must contain uppercase, lowercase, number and symbol"
    ),
  setupToken: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

router.get(
  "/system-bootstrap/status",
  async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");

      res.json({
        success: true,
        data: await systemBootstrapStatus(),
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/system-bootstrap",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Cache-Control", "no-store");

      const key = req.ip || "unknown";
      const now = Date.now();

      const entry = attempts.get(key) || {
        count: 0,
        until: now + 60_000,
      };

      if (entry.until < now) {
        entry.count = 0;
        entry.until = now + 60_000;
      }

      entry.count++;
      attempts.set(key, entry);

      if (entry.count > 5) {
        return res.status(429).json({
          success: false,
          message: "Too many setup attempts",
        });
      }

      const input = schema.parse(req.body);

      const user = await createFirstSystemAdmin(input);

      return res.status(201).json({
        success: true,
        message: "System Administrator created successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
