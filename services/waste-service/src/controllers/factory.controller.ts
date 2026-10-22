import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/factory.repository";
import { parsePage, sendList } from "../utils/pagination";
import { batchSchema, dispatchSchema, intakeSchema, voidIntakeSchema } from "../validators/factory.validator";

const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
/** Resolves the caller's factory, or fails with 403 for any other kind of organization. */
async function factoryOf(req: Request) {
  return (await repo.requireFactory(auth(req).organizationId)).id as string;
}

export async function getOrganizationContext(req: Request, res: Response) {
  const organizationId = auth(req).organizationId;
  if (!organizationId) return res.json({ success: true, message: "No organization", data: null });
  return res.json({ success: true, message: "Organization fetched", data: await repo.organizationContext(organizationId) });
}

export async function getFactoryDirectory(_req: Request, res: Response) {
  return res.json({ success: true, message: "Licensed factories fetched", data: await repo.factoryDirectory() });
}

export async function getOverview(req: Request, res: Response) {
  return res.json({ success: true, message: "Factory overview fetched", data: await repo.overview(await factoryOf(req)) });
}

export async function getExpectedDeliveries(req: Request, res: Response) {
  return res.json({ success: true, message: "Expected deliveries fetched", data: await repo.expectedDeliveries(await factoryOf(req)) });
}

export async function getIntakes(req: Request, res: Response) {
  const page = parsePage(req.query);
  return sendList(res, "Intakes fetched", await repo.listIntakes(await factoryOf(req), page), page);
}

export async function postIntake(req: Request, res: Response) {
  const data = await repo.createIntake(await factoryOf(req), auth(req).userId, intakeSchema.parse(req.body));
  return res.status(201).json({ success: true, message: data.custody_state === "shortfall" ? "Intake recorded; less was received than the supplier declared" : "Intake recorded", data });
}

export async function patchVoidIntake(req: Request, res: Response) {
  const data = await repo.voidIntake(await factoryOf(req), String(req.params.id), voidIntakeSchema.parse(req.body).reason);
  return res.json({ success: true, message: "Intake voided", data });
}

export async function getBatches(req: Request, res: Response) {
  const page = parsePage(req.query);
  return sendList(res, "Batches fetched", await repo.listBatches(await factoryOf(req), page), page);
}

export async function postBatch(req: Request, res: Response) {
  const data = await repo.createBatch(await factoryOf(req), auth(req).userId, batchSchema.parse(req.body));
  return res.status(201).json({ success: true, message: "Processing batch recorded", data });
}

export async function getDispatches(req: Request, res: Response) {
  const page = parsePage(req.query);
  return sendList(res, "Dispatches fetched", await repo.listDispatches(await factoryOf(req), page), page);
}

export async function postDispatch(req: Request, res: Response) {
  const data = await repo.createDispatch(await factoryOf(req), auth(req).userId, dispatchSchema.parse(req.body));
  return res.status(201).json({ success: true, message: "Dispatch recorded", data });
}
