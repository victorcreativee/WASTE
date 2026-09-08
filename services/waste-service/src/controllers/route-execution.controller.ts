import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import {
  arriveAtRouteStop,
  cancelCollectionRoute,
  completeRouteStop,
  dispatchCollectionRoute,
  findDriverRouteDetails,
  findDriverRoutes,
  startDriverRoute,
} from "../repositories/route-execution.repository";
import { cancelCollectionRouteSchema, completeRouteStopSchema } from "../validators/route-execution.validator";

function identity(req: Request) { return (req as AuthenticatedRequest).auth!; }
function scope(req: Request) {
  const auth = identity(req);
  return auth.roles.some((role) => ["company_admin", "supervisor"].includes(role)) ? auth.organizationId : null;
}
function driverUserId(req: Request) { return identity(req).roles.includes("driver") ? identity(req).userId : null; }

export async function dispatchCollectionRouteHandler(req: Request, res: Response) {
  const organizationId = identity(req).organizationId!;
  const route = await dispatchCollectionRoute(req.params.routeId as string, organizationId);
  return res.status(200).json({ success: true, message: "Route dispatched to the assigned driver", data: route });
}

export async function cancelCollectionRouteHandler(req: Request, res: Response) {
  const auth = identity(req);
  const input = cancelCollectionRouteSchema.parse(req.body);
  const route = await cancelCollectionRoute(req.params.routeId as string, auth.organizationId!, auth.userId, input);
  return res.status(200).json({
    success: true,
    message: `${route.returned_job_count} unfinished jobs returned to dispatch`,
    data: route,
  });
}

export async function getDriverRoutesHandler(req: Request, res: Response) {
  const routes = await findDriverRoutes((req.params.driverId as string | undefined) ?? "", scope(req), driverUserId(req));
  return res.status(200).json({ success: true, message: "Driver routes fetched", data: routes });
}

export async function getDriverRouteDetailsHandler(req: Request, res: Response) {
  const route = await findDriverRouteDetails(req.params.routeId as string, scope(req), driverUserId(req));
  if (!route) return res.status(404).json({ success: false, message: "Route not found in your scope" });
  return res.status(200).json({ success: true, message: "Driver route fetched", data: route });
}

export async function startDriverRouteHandler(req: Request, res: Response) {
  const route = await startDriverRoute(req.params.routeId as string, identity(req).userId);
  if (!route) return res.status(400).json({ success: false, message: "This assigned route cannot be started" });
  return res.status(200).json({ success: true, message: "Route started", data: route });
}

export async function arriveAtRouteStopHandler(req: Request, res: Response) {
  const stop = await arriveAtRouteStop(req.params.stopId as string, identity(req).userId);
  if (!stop) return res.status(400).json({ success: false, message: "Complete the previous stop before arriving here" });
  return res.status(200).json({ success: true, message: "Arrival recorded", data: stop });
}

export async function completeRouteStopHandler(req: Request, res: Response) {
  const input = completeRouteStopSchema.parse(req.body);
  const stop = await completeRouteStop(req.params.stopId as string, identity(req).userId, input);
  if (!stop) return res.status(400).json({ success: false, message: "Record arrival before completing this stop" });
  return res.status(200).json({ success: true, message: stop.route_completed ? "Stop and route completed" : "Stop completed", data: stop });
}
