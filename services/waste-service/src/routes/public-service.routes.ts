import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { dbPool } from "../config/database";
import { collectorsFor } from "../repositories/provider-request.repository";

// Public lookups for customers signing up: the divisions and areas of Kampala, and the collection companies that serve
// a place. Company names and phone numbers are public business details; nothing about customers is returned.
const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { await handler(req, res); } catch (error) { next(error); }
  };

router.get("/areas", run(async (_req, res) => {
  const rows = (await dbPool.query(
    `SELECT d.id, d.name, COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.name)
              FILTER (WHERE a.id IS NOT NULL), '[]') AS areas
       FROM kampala_divisions d LEFT JOIN kampala_division_areas a ON a.division_id = d.id AND a.is_active
      WHERE d.is_active GROUP BY d.id, d.name ORDER BY d.name`
  )).rows;
  res.set("Cache-Control", "public, max-age=3600");
  return res.json({ success: true, message: "Divisions and areas", data: rows });
}));

const placeSchema = z.object({
  divisionId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
  latitude: z.coerce.number().min(-1).max(1.5).optional(),
  longitude: z.coerce.number().min(31).max(34).optional(),
  customerType: z.enum(["residential", "commercial", "office_business", "industrial"]).optional(),
});
router.get("/collectors", run(async (req, res) => {
  const place = placeSchema.parse(req.query);
  if (!place.divisionId && !place.areaId && place.latitude === undefined) return res.status(400).json({ success: false, message: "Choose your division and area" });
  return res.json({ success: true, message: "Collection companies serving this place", data: await collectorsFor(place) });
}));

export default router;
