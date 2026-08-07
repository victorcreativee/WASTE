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
} from "../services/waste.service";

export async function getZones(req: Request, res: Response) {
  const zones = await listZones();

  return res.status(200).json({
    success: true,
    message: "Waste zones fetched successfully",
    data: zones,
  });
}

export async function createZoneHandler(req: Request, res: Response) {
  const input = createZoneSchema.parse(req.body);
  const zone = await addZone(input);

  return res.status(201).json({
    success: true,
    message: "Waste zone created successfully",
    data: zone,
  });
}

export async function getTrucks(req: Request, res: Response) {
  const trucks = await listTrucks();

  return res.status(200).json({
    success: true,
    message: "Waste trucks fetched successfully",
    data: trucks,
  });
}

export async function createTruckHandler(req: Request, res: Response) {
  const input = createTruckSchema.parse(req.body);
  const truck = await addTruck(input);

  return res.status(201).json({
    success: true,
    message: "Waste truck created successfully",
    data: truck,
  });
}

export async function getDrivers(req: Request, res: Response) {
  const drivers = await listDrivers();

  return res.status(200).json({
    success: true,
    message: "Drivers fetched successfully",
    data: drivers,
  });
}

export async function createDriverHandler(req: Request, res: Response) {
  const input = createDriverSchema.parse(req.body);
  const driver = await addDriver(input);

  return res.status(201).json({
    success: true,
    message: "Driver created successfully",
    data: driver,
  });
}

export async function getPickupSchedules(req: Request, res: Response) {
  const schedules = await listPickupSchedules();

  return res.status(200).json({
    success: true,
    message: "Pickup schedules fetched successfully",
    data: schedules,
  });
}

export async function createPickupScheduleHandler(req: Request, res: Response) {
  const input = createPickupScheduleSchema.parse(req.body);
  const schedule = await addPickupSchedule(input);

  return res.status(201).json({
    success: true,
    message: "Pickup schedule created successfully",
    data: schedule,
  });
}

export async function getCollectionJobs(req: Request, res: Response) {
  const jobs = await listCollectionJobs();

  return res.status(200).json({
    success: true,
    message: "Collection jobs fetched successfully",
    data: jobs,
  });
}

export async function createCollectionJobHandler(req: Request, res: Response) {
  const input = createCollectionJobSchema.parse(req.body);
  const job = await addCollectionJob(input);

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
  const job = await changeCollectionJobStatus(req.params.id as string, input);

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
  const result = await generateJobsForPickupSchedule(scheduleId, input);

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
    },
  });
}
export async function assignCollectionJobHandler(req: Request, res: Response) {
  const input = assignCollectionJobSchema.parse(req.body);
  const jobId = req.params.id as string;

  const job = await assignTruckAndDriverToJob(jobId, input);

  if (!job) {
    return res.status(400).json({
      success: false,
      message:
        "Collection job cannot be assigned. It may not exist or may already be in progress, completed, or cancelled.",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Collection job assigned successfully",
    data: job,
  });
}
export async function getDriverJobsHandler(req: Request, res: Response) {
  const driverId = req.params.driverId as string;
  const jobs = await listDriverJobs(driverId);

  return res.status(200).json({
    success: true,
    message: "Driver jobs fetched successfully",
    data: jobs,
  });
}

export async function startDriverJobHandler(req: Request, res: Response) {
  const jobId = req.params.jobId as string;
  const job = await startDriverJob(jobId);

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

  const job = await completeDriverJob(jobId, collectedWeightKg);

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
  const routes = await listCollectionRoutes();

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
  const route = await addCollectionRoute(input);

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
  const route = await getCollectionRouteDetails(routeId);

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
