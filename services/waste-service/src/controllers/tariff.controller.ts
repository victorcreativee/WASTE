import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/tariff.repository";
import { tariffBandSchema, tariffBandUpdateSchema, tariffRateSchema } from "../validators/tariff.validator";

const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const isKcca = (req: Request) => auth(req).roles.some(role => role === "kcca_admin" || role === "system_admin");

export async function getTariffs(req: Request, res: Response) {
  return res.json({ success: true, message: "KCCA tariffs fetched", data: await repo.listTariffBands(isKcca(req)) });
}
export async function getPublicTariffs(_req: Request, res: Response) {
  const bands = await repo.listTariffBands(false);
  return res.json({ success: true, message: "KCCA tariffs fetched", data: bands.map(({ active_plans, operators, ...band }) => band) });
}
export async function getTariffRates(req: Request, res: Response) {
  return res.json({ success: true, message: "Tariff rates fetched", data: await repo.listTariffRates(req.params.id as string) });
}
export async function postTariffBand(req: Request, res: Response) {
  return res.status(201).json({ success: true, message: "Tariff band created", data: await repo.createTariffBand(tariffBandSchema.parse(req.body), auth(req).userId) });
}
export async function putTariffBand(req: Request, res: Response) {
  const data = await repo.updateTariffBand(req.params.id as string, tariffBandUpdateSchema.parse(req.body));
  if (!data) return res.status(404).json({ success: false, message: "Tariff band not found" });
  return res.json({ success: true, message: "Tariff band saved", data });
}
export async function postTariffRate(req: Request, res: Response) {
  const data = await repo.publishTariffRate(req.params.id as string, tariffRateSchema.parse(req.body), auth(req).userId);
  return res.status(201).json({ success: true, message: `Rate published from ${data.effective_from}`, data });
}
export async function deleteTariffRate(req: Request, res: Response) {
  const data = await repo.withdrawTariffRate(req.params.id as string, req.params.rateId as string);
  if (!data) return res.status(404).json({ success: false, message: "Rate not found" });
  return res.json({ success: true, message: "Scheduled rate withdrawn", data });
}
