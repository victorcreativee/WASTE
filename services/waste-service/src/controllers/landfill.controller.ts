import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/landfill.repository";
import { renderLoadCertificate } from "../services/load-certificate.pdf";
import { baselineRangeSchema, certificateCodeSchema, compositionSchema, factorSetSchema, loadListSchema, ticketIdSchema } from "../validators/landfill.validator";

const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
/** KCCA, system administrators and weighbridge operators see every operator; companies see their own. */
const cityWide = (roles: string[]) => roles.some(role => ["kcca_admin", "system_admin", "weighbridge_operator"].includes(role));
const scope = (req: Request) => cityWide(auth(req).roles) ? null : auth(req).organizationId;
/** Spreadsheet programs run cells starting with these as formulas. */
const cell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function getStreams(_req: Request, res: Response) {
  return res.json({ success: true, message: "Waste streams and methane factors", data: await repo.streamsAndFactors() });
}

export async function getOverview(req: Request, res: Response) {
  const { from, to } = baselineRangeSchema.parse(req.query);
  return res.json({ success: true, message: "Landfill and carbon baseline", data: await repo.landfillOverview(scope(req), from, to) });
}

export async function getLoads(req: Request, res: Response) {
  return res.json({ success: true, message: "Weighbridge loads", data: await repo.listLoads(scope(req), loadListSchema.parse(req.query)) });
}

export async function putComposition(req: Request, res: Response) {
  const data = await repo.recordComposition(ticketIdSchema.parse(req.params.ticketId), compositionSchema.parse(req.body), auth(req).userId);
  return res.json({ success: true, message: "Composition recorded. The carbon baseline includes it after the next refresh.", data });
}

export async function getCertificatePdf(req: Request, res: Response) {
  const id = ticketIdSchema.safeParse(req.params.id);
  const certificate = id.success ? await repo.certificateById(id.data, scope(req)) : null;
  if (!certificate) return res.status(404).json({ success: false, message: "Certificate not found" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${certificate.certificate_number}.pdf"`);
  return res.send(renderLoadCertificate(certificate));
}

export async function getPublicCertificate(req: Request, res: Response) {
  const code = certificateCodeSchema.safeParse(req.params.code);
  const data = code.success ? await repo.publicCertificate(code.data) : null;
  if (!data) return res.status(404).json({ success: false, message: "No load certificate has this code" });
  return res.json({ success: true, message: "Load certificate found", data });
}

export async function postFactors(req: Request, res: Response) {
  const data = await repo.publishFactors(factorSetSchema.parse(req.body), auth(req).userId);
  return res.status(201).json({ success: true, message: `Methane factors version ${data.version} published and the baseline recalculated`, data });
}

export async function postRefresh(_req: Request, res: Response) {
  const data = await repo.refreshBaseline("kcca");
  return res.json({ success: true, message: "Carbon baseline recalculated", data });
}

export async function exportBaseline(req: Request, res: Response) {
  const { from, to } = baselineRangeSchema.parse(req.query);
  const rows = await repo.baselineRows(scope(req), from, to);
  const header = ["month", "operator", "destination", "stream", "loads", "tonnes", "measured_tonnes", "ch4_tonnes", "co2e_tonnes", "factor_version"];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kwms-carbon-baseline-${from}-to-${to}.csv"`);
  return res.send([header.join(","), ...rows.map(row => header.map(key => cell(row[key])).join(","))].join("\n"));
}
