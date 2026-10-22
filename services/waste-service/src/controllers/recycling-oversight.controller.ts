import { Request, Response } from "express";
import * as repo from "../repositories/recycling-oversight.repository";
import { resolvePeriod, toCsv } from "../services/recycling-oversight.rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function periodOf(req: Request) {
  return resolvePeriod(req.query, await repo.today());
}

export async function getCityOverview(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, message: "Recycling oversight fetched", data: await repo.cityOverview(await periodOf(req)) });
}

export async function getRecyclerDetail(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!UUID.test(id)) return res.status(400).json({ success: false, message: "Invalid recycler id" });
  const data = await repo.recyclerDetail(id, await periodOf(req));
  if (!data) return res.status(404).json({ success: false, message: "Recycling company not found" });
  return res.json({ success: true, message: "Recycler detail fetched", data });
}

export async function getOverviewCsv(req: Request, res: Response) {
  const overview = await repo.cityOverview(await periodOf(req));
  const csv = toCsv(
    ["Recycling company", "KCCA permit", "Standing", "Collected kg", "Sorted kg", "Sorting residue kg", "Sold kg", "Stock held kg",
      "Stock over 90 days kg", "Working days", "Days closed", "Last activity", "Flags"],
    overview.recyclers.map(row => [
      row.name, row.permit_number, row.standing, row.collected_kg, row.sorted_kg, row.residue_kg, row.sold_kg, row.stock_kg,
      row.aged_stock_kg, row.active_days, row.closed_days, row.last_activity, row.flags.map(flag => flag.message).join("; "),
    ]));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kcca-recycling-${overview.period.from}-to-${overview.period.to}.csv"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(`﻿${csv}`);
}
