import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import * as repo from "../repositories/notification.repository";
import { parsePage, sendList } from "../utils/pagination";

const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
const userOf = (req: Request) => (req as AuthenticatedRequest).auth!.userId;

const readSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).strict(),
]);
const preferencesSchema = z.object({
  categories: z.array(z.object({ category: z.enum(repo.CATEGORIES), email: z.boolean(), sms: z.boolean() }).strict()).min(1).max(repo.CATEGORIES.length),
}).strict();

// Every signed-in user has notifications; each request only ever touches the caller's own.
r.get("/notifications", run(async (req, res) => {
  const page = parsePage(req.query) ?? { limit: 20, offset: 0 };
  return sendList(res, "Notifications fetched", await repo.listForUser(userOf(req), page, req.query.unread === "1"), page);
}));
r.get("/notifications/unread-count", run(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, message: "Unread notifications counted", data: { unread: await repo.unreadCount(userOf(req)) } });
}));
r.post("/notifications/read", run(async (req, res) => {
  const input = readSchema.parse(req.body);
  const updated = await repo.markRead(userOf(req), "all" in input ? "all" : input.ids);
  return res.json({ success: true, message: `${updated} marked as read`, data: { updated } });
}));
r.get("/notifications/preferences", run(async (req, res) =>
  res.json({ success: true, message: "Notification preferences fetched", data: await repo.preferences(userOf(req)) })));
r.put("/notifications/preferences", run(async (req, res) =>
  res.json({ success: true, message: "Notification preferences saved", data: await repo.savePreferences(userOf(req), preferencesSchema.parse(req.body).categories) })));
r.get("/notifications/deliveries", requireRoles("system_admin"), run(async (_req, res) =>
  res.json({ success: true, message: "Delivery summary fetched", data: await repo.deliverySummary() })));

r.post("/notifications/run-checks", requireRoles("system_admin"), run(async (_req, res) =>
  res.json({ success: true, message: "Notification checks run", data: await repo.runNotificationChecks() })));
r.post("/notifications/process-deliveries", requireRoles("system_admin"), run(async (_req, res) =>
  res.json({ success: true, message: "Due deliveries processed", data: await repo.processDueDeliveries(100) })));

export default r;
