import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import * as repo from "../repositories/registry.repository";

// Waste point registry (migration 119). Companies keep their own points; KCCA and system administrators read the city.
const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const scope = (req: Request) => auth(req).roles.some(role => role === "kcca_admin" || role === "system_admin") ? null : auth(req).organizationId;
const readers = requireRoles("company_admin", "supervisor", "kcca_admin", "system_admin"), keepers = requireRoles("company_admin", "supervisor");

export const CATEGORIES = ["household", "shop", "market_stall", "market", "restaurant", "hotel", "office", "school", "health_facility",
  "place_of_worship", "government", "factory", "construction", "other"] as const;
export const listSchema = z.object({
  status: z.enum(Object.keys(repo.STATUSES) as [repo.RegistryStatus, ...repo.RegistryStatus[]]).default("all"),
  category: z.enum([...CATEGORIES, "none"]).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const profileSchema = z.object({
  pointCategory: z.enum(CATEGORIES).optional(),
  estimatedKgWeek: z.number().min(0).max(1000000).nullable().optional(),
}).refine(v => v.pointCategory !== undefined || v.estimatedKgWeek !== undefined, "Give a category or an estimate");
const b = repo.KAMPALA_BOUNDS;
export const verifySchema = z.object({
  latitude: z.number().min(b.south, "This position is outside Kampala").max(b.north, "This position is outside Kampala"),
  longitude: z.number().min(b.west, "This position is outside Kampala").max(b.east, "This position is outside Kampala"),
  accuracyM: z.number().positive().max(repo.MAX_ACCURACY_M, `The GPS fix must be accurate to ${repo.MAX_ACCURACY_M} m; wait for a better signal outdoors`),
  note: z.string().trim().max(500).optional(),
});

r.get("/registry/summary", readers, run(async (req, res) =>
  res.json({ success: true, message: "Waste point registry", data: await repo.registrySummary(scope(req)) })));
r.get("/registry/points", readers, run(async (req, res) =>
  res.json({ success: true, message: "Collection points", data: await repo.listPoints(scope(req), listSchema.parse(req.query)) })));
r.get("/registry/points/:id", readers, run(async (req, res) =>
  res.json({ success: true, message: "Collection point", data: await repo.pointDetail(scope(req), z.guid().parse(req.params.id)) })));
r.patch("/registry/points/:id", keepers, run(async (req, res) =>
  res.json({ success: true, message: "Point updated", data: await repo.updateProfile(scope(req), z.guid().parse(req.params.id), profileSchema.parse(req.body)) })));
r.post("/registry/points/:id/verify", keepers, run(async (req, res) => {
  const data = await repo.verifyPoint(scope(req), z.guid().parse(req.params.id), verifySchema.parse(req.body), auth(req).userId);
  const moved = data.verification_moved_m === null ? "" : Number(data.verification_moved_m) > 20 ? ` The position moved ${Math.round(Number(data.verification_moved_m))} m.` : "";
  return res.json({ success: true, message: `${data.point_number} verified on site.${moved}`, data });
}));

export default r;
