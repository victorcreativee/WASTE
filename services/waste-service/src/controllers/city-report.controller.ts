import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/city-report.repository";
import { toCsv } from "../services/recycling-oversight.rules";
import { cityReportIssueSchema } from "../validators/regulatory.validator";

const UUID = /^[0-9a-f-]{36}$/i;

/** Defaults to last month, the most recent complete month. */
async function periodOf(req: Request) {
  if (typeof req.query.period === "string" && req.query.period) return req.query.period;
  const [y, m] = (await repo.today()).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

type Report = Awaited<ReturnType<typeof repo.buildCityReport>>;

function collectorsCsv(report: Report) {
  return toCsv(
    ["Collector", "KCCA permit", "Scheduled collections", "Completed", "Missed", "Completion %", "Trips completed", "Verified %", "Disposed kg",
      "Resident issues", "Issues beyond standard", "Open compliance cases", "Service score", "Band"],
    report.collectors.map(c => [c.name, c.permit_number, c.jobs, c.completed_jobs, c.missed_jobs, c.completion_rate, c.completed_trips, c.verification_rate,
      c.disposed_kg, c.open_issues, c.overdue_issues, c.open_compliance_cases, c.service_score, c.band]));
}

function sendCsv(res: Response, name: string, csv: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(`﻿${csv}`);
}

export async function getLiveReport(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, message: "City report prepared", data: await repo.buildCityReport(await periodOf(req)) });
}

export async function getLiveReportCsv(req: Request, res: Response) {
  const report = await repo.buildCityReport(await periodOf(req));
  return sendCsv(res, `kcca-collectors-${report.period.key}-draft.csv`, collectorsCsv(report));
}

export async function postCityReport(req: Request, res: Response) {
  const input = cityReportIssueSchema.parse(req.body);
  const data = await repo.issueCityReport(input.period, (req as AuthenticatedRequest).auth!.userId, input.commentary, input.replaceReason);
  return res.status(201).json({ success: true, message: `${data.report_number} issued`, data });
}

export async function getCityReports(_req: Request, res: Response) {
  return res.json({ success: true, message: "Issued reports fetched", data: await repo.listCityReports() });
}

export async function getCityReportById(req: Request, res: Response) {
  if (!UUID.test(String(req.params.id))) return res.status(400).json({ success: false, message: "Invalid report id" });
  const data = await repo.getCityReport(String(req.params.id));
  return data ? res.json({ success: true, message: "Issued report fetched", data }) : res.status(404).json({ success: false, message: "Report not found" });
}

export async function getCityReportCsv(req: Request, res: Response) {
  if (!UUID.test(String(req.params.id))) return res.status(400).json({ success: false, message: "Invalid report id" });
  const row = await repo.getCityReport(String(req.params.id));
  if (!row) return res.status(404).json({ success: false, message: "Report not found" });
  return sendCsv(res, `${row.report_number}-collectors.csv`, collectorsCsv(row.data as Report));
}
