import { operationalOrganizationScope } from "../middlewares/organization-scope";
import { Request, Response } from "express";
import {
  assignCollectionJobSchema,
  createCollectionJobSchema,
  createDriverSchema,
  createPickupScheduleSchema,
  createTruckSchema,
  createZoneSchema,
  generateCollectionJobsSchema,
  updateCollectionJobStatusSchema,
  createCollectionRouteSchema,
  assignZoneServiceAreaSchema,
  updateZoneSchema,
} from "../validators/waste.validator";
import {
  addCollectionJob,
  addDriver,
  addPickupSchedule,
  addTruck,
  addZone,
  assignTruckAndDriverToJob,
  changeCollectionJobStatus,
  generateJobsForPickupSchedule,
  listCollectionJobs,
  listDrivers,
  listPickupSchedules,
  listTrucks,
  listZones,
  completeDriverJob,
  listDriverJobs,
  startDriverJob,
  addCollectionRoute,
  getCollectionRouteDetails,
  listCollectionRoutes,
  generateRoadRouteForCollectionRoute,
  assignServiceArea,
  editZone,
} from "../services/waste.service";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

const organizationScope = operationalOrganizationScope;

function driverUserScope(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  return auth?.roles.includes("driver") ? auth.userId : null;
}

function enforceOrganization<T extends { organizationId?: string }>(
  req: Request,
  input: T
): T {
  const organizationId = organizationScope(req);
  return organizationId ? { ...input, organizationId } : input;
}

export async function getZones(req: Request, res: Response) {
  const zones = await listZones(organizationScope(req));

  return res.status(200).json({
    success: true,
    message: "Waste zones fetched successfully",
    data: zones,
  });
}

export async function createZoneHandler(req: Request, res: Response) {
  const input = createZoneSchema.parse(req.body);
  const zone = await addZone(enforceOrganization(req, input));

  return res.status(201).json({
    success: true,
    message: "Waste zone created successfully",
    data: zone,
  });
}
export async function updateZoneHandler(req:Request,res:Response){
  const organizationId=organizationScope(req);
  if(!organizationId)return res.status(403).json({success:false,message:"Only the responsible company can edit its zone"});
  const input=updateZoneSchema.parse(req.body),zone=await editZone(req.params.id as string,organizationId,input);
  if(!zone)return res.status(404).json({success:false,message:"Zone not found"});
  return res.json({success:true,message:"Zone updated",data:zone});
}

export async function assignZoneServiceAreaHandler(req: Request, res: Response) {
  const input = assignZoneServiceAreaSchema.parse(req.body);
  const zone = await assignServiceArea(req.params.id as string, input);
  if (!zone) {
    return res.status(404).json({
      success: false,
      message: "Zone or active waste collection company not found",
    });
  }
  return res.status(200).json({
    success: true,
    message: "Service area assigned successfully",
    data: zone,
  });
}

export async function getTrucks(req: Request, res: Response) {
  const trucks = await listTrucks(organizationScope(req));

  return res.status(200).json({
    success: true,
    message: "Waste trucks fetched successfully",
    data: trucks,
  });
}

export async function createTruckHandler(req: Request, res: Response) {
  const input = createTruckSchema.parse(req.body);
  const truck = await addTruck(enforceOrganization(req, input));

  return res.status(201).json({
    success: true,
    message: "Waste truck created successfully",
    data: truck,
  });
}

export async function getDrivers(req: Request, res: Response) {
  const drivers = await listDrivers(organizationScope(req));

  return res.status(200).json({
    success: true,
    message: "Drivers fetched successfully",
    data: drivers,
  });
}

export async function createDriverHandler(req: Request, res: Response) {
  const input = createDriverSchema.parse(req.body);
  const driver = await addDriver(enforceOrganization(req, input));

  return res.status(201).json({
    success: true,
    message: "Driver created successfully",
    data: driver,
  });
}

export async function getPickupSchedules(req: Request, res: Response) {
  const schedules = await listPickupSchedules(organizationScope(req));

  return res.status(200).json({
    success: true,
    message: "Pickup schedules fetched successfully",
    data: schedules,
  });
}

export async function createPickupScheduleHandler(req: Request, res: Response) {
  const input = createPickupScheduleSchema.parse(req.body);
  const schedule = await addPickupSchedule(enforceOrganization(req, input));

  return res.status(201).json({
    success: true,
    message: "Pickup schedule created successfully",
    data: schedule,
  });
}

export async function getCollectionJobs(req: Request, res: Response) {
  const jobs = await listCollectionJobs(organizationScope(req));

  return res.status(200).json({
    success: true,
    message: "Collection jobs fetched successfully",
    data: jobs,
  });
}

export async function createCollectionJobHandler(req: Request, res: Response) {
  const input = createCollectionJobSchema.parse(req.body);
  const job = await addCollectionJob(enforceOrganization(req, input));

  return res.status(201).json({
    success: true,
    message: "Collection job created successfully",
    data: job,
  });
}

export async function updateCollectionJobStatusHandler(
  req: Request,
  res: Response
) {
  const input = updateCollectionJobStatusSchema.parse(req.body);
  const job = await changeCollectionJobStatus(
    req.params.id as string,
    input,
    organizationScope(req)
  );

  if (!job) {
    return res.status(404).json({
      success: false,
      message: "Collection job not found",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Collection job status updated successfully",
    data: job,
  });
}
export async function generateCollectionJobsHandler(
  req: Request,
  res: Response
) {
  const input = generateCollectionJobsSchema.parse(req.body);

  const scheduleId = req.params.id as string;
  const result = await generateJobsForPickupSchedule(
    scheduleId,
    input,
    organizationScope(req)
  );

  if (!result.schedule) {
    return res.status(404).json({
      success: false,
      message: "Pickup schedule not found",
    });
  }

  if (!result.schedule.is_active) {
    return res.status(400).json({
      success: false,
      message: "Pickup schedule is inactive",
      data: result,
    });
  }

  return res.status(201).json({
    success: true,
    message: "Collection jobs generated successfully",
    data: {
      schedule: result.schedule,
      createdJobs: result.jobs,
      createdCount: result.jobs.length,
      skippedExistingJobs: result.skipped,
      customerStopsCreated: result.customerStopsCreated,
    },
  });
}
export async function assignCollectionJobHandler(req: Request, res: Response) {
  const input = assignCollectionJobSchema.parse(req.body);
  const jobId = req.params.id as string;

  const job = await assignTruckAndDriverToJob(
    jobId,
    input,
    organizationScope(req)
  );

  if (!job) {
    return res.status(400).json({
      success: false,
      message:
        "Collection job cannot be assigned. Check that the job is still open, the driver is active, and the vehicle is available with no expired compliance document.",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Collection job assigned successfully",
    data: job,
  });
}
export async function getDriverJobsHandler(req: Request, res: Response) {
  const driverId = (req.params.driverId as string | undefined) ?? "";
  const jobs = await listDriverJobs(
    driverId,
    organizationScope(req),
    driverUserScope(req)
  );

  return res.status(200).json({
    success: true,
    message: "Driver jobs fetched successfully",
    data: jobs,
  });
}

export async function startDriverJobHandler(req: Request, res: Response) {
  const jobId = req.params.jobId as string;
  const job = await startDriverJob(
    jobId,
    organizationScope(req),
    driverUserScope(req)
  );

  if (!job) {
    return res.status(400).json({
      success: false,
      message:
        "Driver job cannot be started. It may not exist, may not be assigned, or may not have a truck and driver.",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Driver job started successfully",
    data: job,
  });
}

export async function completeDriverJobHandler(req: Request, res: Response) {
  const jobId = req.params.jobId as string;
  const collectedWeightKg =
    typeof req.body.collectedWeightKg === "number"
      ? req.body.collectedWeightKg
      : undefined;

  const job = await completeDriverJob(
    jobId,
    collectedWeightKg,
    organizationScope(req),
    driverUserScope(req)
  );

  if (!job) {
    return res.status(400).json({
      success: false,
      message:
        "Driver job cannot be completed. It may not exist or may not be in progress.",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Driver job completed successfully",
    data: job,
  });
}
export async function getCollectionRoutes(req: Request, res: Response) {
  const routes = await listCollectionRoutes(organizationScope(req));

  return res.status(200).json({
    success: true,
    message: "Collection routes fetched successfully",
    data: routes,
  });
}

export async function createCollectionRouteHandler(
  req: Request,
  res: Response
) {
  const input = createCollectionRouteSchema.parse(req.body);
  const route = await addCollectionRoute(enforceOrganization(req, input));

  return res.status(201).json({
    success: true,
    message: "Collection route created successfully",
    data: route,
  });
}

export async function getCollectionRouteDetailsHandler(
  req: Request,
  res: Response
) {
  const routeId = req.params.id as string;
  const route = await getCollectionRouteDetails(routeId, organizationScope(req));

  if (!route) {
    return res.status(404).json({
      success: false,
      message: "Collection route not found",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Collection route details fetched successfully",
    data: route,
  });
}
export async function generateCollectionRouteRoadRouteHandler(
  req: Request,
  res: Response
) {
  const routeId = req.params.id as string;
  const result = await generateRoadRouteForCollectionRoute(
    routeId,
    organizationScope(req)
  );

  if (result.status === "not_found") {
    return res.status(404).json({
      success: false,
      message: "Collection route not found",
    });
  }

  if (result.status === "insufficient_stops") {
    return res.status(400).json({
      success: false,
      message:
        "At least two ordered collection stops are required to generate a road route",
      data: result.route,
    });
  }

  if (result.status === "invalid_coordinates") {
    return res.status(400).json({
      success: false,
      message:
        "Every collection stop must have valid zone coordinates before road routing can be generated",
      data: {
        invalidCoordinateStops: result.invalidCoordinateStops,
      },
    });
  }

  return res.status(200).json({
    success: true,
    message: "Road-following collection route generated successfully",
    data: result.route,
  });
}
