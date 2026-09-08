import { Request, Response } from "express";
import { getRoutingProviderStatus } from "../services/routing.service";

export async function getRoutingStatusHandler(req: Request, res: Response) {
  const status = await getRoutingProviderStatus();

  return res.status(status.reachable ? 200 : 503).json({
    success: status.reachable,
    message: status.message,
    data: status,
  });
}
