import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { dbPool } from "../config/database";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import { requireOrganizationScope } from "../middlewares/organization-scope";
import * as repo from "../repositories/recycling-settings.repository";

const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => { try { await handler(req, res); } catch (error) { next(error); } };
const org = (req: Request) => requireOrganizationScope(req as AuthenticatedRequest);
const user = (req: Request) => (req as AuthenticatedRequest).auth!.userId;
const admin = requireRoles("company_admin");

// Every signed-in member of the company reads the settings, because forms use them; only the administrator changes them.
r.get("/recycling/settings", run(async (req, res) => { res.setHeader("Cache-Control", "no-store"); return res.json({ success: true, message: "Settings fetched", data: await repo.getSettings(dbPool, org(req)) }); }));
r.put("/recycling/settings", admin, run(async (req, res) => {
  const data = await repo.saveSettings(org(req), user(req), req.body);
  return res.json({ success: true, message: data.changed.length ? "Settings saved" : "Nothing changed", data });
}));
r.post("/recycling/materials/:id/rename", admin, run(async (req, res) => {
  const data = await repo.renameMaterial(org(req), user(req), z.guid().parse(req.params.id), req.body);
  return res.json({ success: true, message: data.merged ? `${data.from} merged into ${data.to}` : `${data.from} renamed to ${data.to}`, data });
}));
export default r;
