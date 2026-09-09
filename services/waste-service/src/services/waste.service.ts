import {
  assignCollectionJob,
  createCollectionJob,
  createDriver,
  createPickupSchedule,
  createTruck,
  createZone,
  findCollectionJobs,
  findDrivers,
  findPickupSchedules,
  findTrucks,
  findZones,
  generateCollectionJobsFromSchedule,
  updateCollectionJobStatus,
  completeDriverCollectionJob,
  findJobsByDriverId,
  startDriverCollectionJob,
  createCollectionRoute,
  findCollectionRouteById,
  findCollectionRoutes,
  updateCollectionRouteRoutingData,
  resourcesBelongToOrganization,
  assignZoneServiceArea,
  updateZoneForOrganization,
} from "../repositories/waste.repository";
import { generateCustomerStops } from "../repositories/customer-stop.repository";
import {
  AssignCollectionJobInput,
  CreateCollectionJobInput,
  CreateDriverInput,
  CreatePickupScheduleInput,
  CreateTruckInput,
  CreateZoneInput,
  GenerateCollectionJobsInput,
  UpdateCollectionJobStatusInput,
  CreateCollectionRouteInput,
  AssignZoneServiceAreaInput,
} from "../validators/waste.validator";
import { calculateRoadRoute } from "./routing.service";

interface CollectionRouteStop {
  id: string;
  zone_id: string | null;
  zone_name: string | null;
  latitude: number | string | null | undefined;
  longitude: number | string | null | undefined;
  stop_order: number;
}

async function requireOwnedResources(
  organizationId: string | undefined,
  checks: Array<{
    resource:
      | "users"
      | "waste_zones"
      | "waste_trucks"
      | "drivers"
      | "pickup_schedules"
      | "collection_jobs";
    ids: Array<string | undefined>;
    label: string;
  }>
) {
  if (!organizationId) return;

  for (const check of checks) {
    const ids = check.ids.filter((id): id is string => Boolean(id));
    if (!(await resourcesBelongToOrganization(check.resource, ids, organizationId))) {
      const error = new Error(
        `${check.label} must belong to the authenticated organization`
      ) as Error & { statusCode?: number };
      error.statusCode = 400;
      throw error;
    }
  }
}

export async function listZones(organizationId: string | null) {
  return findZones(organizationId);
}

export async function addZone(input: CreateZoneInput) {
  if(input.organizationId&&!input.divisionId){
    const error=Object.assign(new Error("Choose one of the divisions KCCA assigned to your organization"),{statusCode:400});
    throw error;
  }
  return createZone(input);
}
export async function editZone(zoneId:string,organizationId:string,input:any){return updateZoneForOrganization(zoneId,organizationId,input);}

export async function assignServiceArea(
  zoneId: string,
  input: AssignZoneServiceAreaInput
) {
  return assignZoneServiceArea(zoneId, input);
}

export async function listTrucks(organizationId: string | null) {
  return findTrucks(organizationId);
}

export async function addTruck(input: CreateTruckInput) {
  return createTruck(input);
}

export async function listDrivers(organizationId: string | null) {
  return findDrivers(organizationId);
}

export async function addDriver(input: CreateDriverInput) {
  await requireOwnedResources(input.organizationId, [
    { resource: "users", ids: [input.userId], label: "Driver user" },
  ]);
  return createDriver(input);
}
export async function listPickupSchedules(organizationId: string | null) {
  return findPickupSchedules(organizationId);
}

export async function addPickupSchedule(input: CreatePickupScheduleInput) {
  await requireOwnedResources(input.organizationId, [
    { resource: "waste_zones", ids: [input.zoneId], label: "Zone" },
  ]);
  return createPickupSchedule(input);
}

export async function listCollectionJobs(organizationId: string | null) {
  return findCollectionJobs(organizationId);
}

export async function addCollectionJob(input: CreateCollectionJobInput) {
  await requireOwnedResources(input.organizationId, [
    { resource: "waste_zones", ids: [input.zoneId], label: "Zone" },
    { resource: "waste_trucks", ids: [input.truckId], label: "Truck" },
    { resource: "drivers", ids: [input.driverId], label: "Driver" },
    { resource: "pickup_schedules", ids: [input.scheduleId], label: "Schedule" },
  ]);
  return createCollectionJob(input);
}

export async function changeCollectionJobStatus(
  jobId: string,
  input: UpdateCollectionJobStatusInput,
  organizationId: string | null
) {
  return updateCollectionJobStatus(jobId, input, organizationId);
}
export async function generateJobsForPickupSchedule(
  scheduleId: string,
  input: GenerateCollectionJobsInput,
  organizationId: string | null
) {
  if (organizationId) {
    await requireOwnedResources(organizationId, [
      { resource: "waste_trucks", ids: [input.truckId], label: "Truck" },
      { resource: "drivers", ids: [input.driverId], label: "Driver" },
    ]);
  }
  const result=await generateCollectionJobsFromSchedule(scheduleId, input, organizationId);
  let customerStopsCreated=0;
  if(organizationId){
    for(const job of result.jobs){
      const planned=await generateCustomerStops(job.id,organizationId);
      customerStopsCreated+=planned?.created??0;
    }
  }
  return {...result,customerStopsCreated};
}
export async function assignTruckAndDriverToJob(
  jobId: string,
  input: AssignCollectionJobInput,
  organizationId: string | null
) {
  const job=await assignCollectionJob(jobId, input, organizationId);
  if(!job||!organizationId)return job;
  const planned=await generateCustomerStops(job.id,organizationId);
  return {...job,customer_stops_created:planned?.created??0,customer_stop_count:planned?.total??0};
}
export async function listDriverJobs(
  driverId: string,
  organizationId: string | null,
  userId: string | null
) {
  return findJobsByDriverId(driverId, organizationId, userId);
}

export async function startDriverJob(
  jobId: string,
  organizationId: string | null,
  userId: string | null
) {
  return startDriverCollectionJob(jobId, organizationId, userId);
}

export async function completeDriverJob(
  jobId: string,
  collectedWeightKg: number | undefined,
  organizationId: string | null,
  userId: string | null
) {
  return completeDriverCollectionJob(
    jobId,
    collectedWeightKg,
    organizationId,
    userId
  );
}
export async function listCollectionRoutes(organizationId: string | null) {
  return findCollectionRoutes(organizationId);
}

export async function addCollectionRoute(input: CreateCollectionRouteInput) {
  await requireOwnedResources(input.organizationId, [
    { resource: "waste_trucks", ids: [input.truckId], label: "Truck" },
    { resource: "drivers", ids: [input.driverId], label: "Driver" },
    { resource: "collection_jobs", ids: input.jobIds, label: "Route jobs" },
  ]);
  return createCollectionRoute(input);
}

export async function getCollectionRouteDetails(routeId: string, organizationId: string | null) {
  return findCollectionRouteById(routeId, organizationId);
}
export async function generateRoadRouteForCollectionRoute(routeId: string, organizationId: string | null) {
  const route = await findCollectionRouteById(routeId, organizationId);

  if (!route) {
    return {
      status: "not_found" as const,
    };
  }

  const jobs: CollectionRouteStop[] = Array.isArray(route.jobs)
    ? route.jobs
    : [];

  if (jobs.length < 2) {
    return {
      status: "insufficient_stops" as const,
      route,
    };
  }

  const invalidCoordinateStops = jobs
    .filter((job) => {
      if (
        job.latitude === null ||
        job.latitude === undefined ||
        job.longitude === null ||
        job.longitude === undefined
      ) {
        return true;
      }

      const latitude = Number(job.latitude);
      const longitude = Number(job.longitude);

      return (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      );
    })
    .map((job) => ({
      jobId: job.id,
      zoneId: job.zone_id,
      zoneName: job.zone_name,
      stopOrder: job.stop_order,
    }));

  if (invalidCoordinateStops.length > 0) {
    return {
      status: "invalid_coordinates" as const,
      route,
      invalidCoordinateStops,
    };
  }

  const coordinates = jobs.map((job) => ({
    latitude: Number(job.latitude),
    longitude: Number(job.longitude),
  }));

  const routingResult = await calculateRoadRoute(coordinates);

  const totalDistanceKm = Number(
    (routingResult.distanceMeters / 1000).toFixed(2)
  );

  const estimatedDurationMinutes = Math.ceil(
    routingResult.durationSeconds / 60
  );

  const persistedRoute = await updateCollectionRouteRoutingData(
    routeId,
    JSON.stringify(routingResult.geometry),
    totalDistanceKm,
    estimatedDurationMinutes,
    organizationId
  );

  if (!persistedRoute) {
    return {
      status: "not_found" as const,
    };
  }

  const updatedRoute = await findCollectionRouteById(routeId, organizationId);

  return {
    status: "generated" as const,
    route: updatedRoute,
  };
}
