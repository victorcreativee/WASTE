"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listZones = listZones;
exports.addZone = addZone;
exports.editZone = editZone;
exports.assignServiceArea = assignServiceArea;
exports.listTrucks = listTrucks;
exports.addTruck = addTruck;
exports.listDrivers = listDrivers;
exports.addDriver = addDriver;
exports.listPickupSchedules = listPickupSchedules;
exports.addPickupSchedule = addPickupSchedule;
exports.listCollectionJobs = listCollectionJobs;
exports.addCollectionJob = addCollectionJob;
exports.changeCollectionJobStatus = changeCollectionJobStatus;
exports.generateJobsForPickupSchedule = generateJobsForPickupSchedule;
exports.assignTruckAndDriverToJob = assignTruckAndDriverToJob;
exports.listDriverJobs = listDriverJobs;
exports.startDriverJob = startDriverJob;
exports.completeDriverJob = completeDriverJob;
exports.listCollectionRoutes = listCollectionRoutes;
exports.addCollectionRoute = addCollectionRoute;
exports.getCollectionRouteDetails = getCollectionRouteDetails;
exports.generateRoadRouteForCollectionRoute = generateRoadRouteForCollectionRoute;
const waste_repository_1 = require("../repositories/waste.repository");
const customer_stop_repository_1 = require("../repositories/customer-stop.repository");
const routing_service_1 = require("./routing.service");
async function requireOwnedResources(organizationId, checks) {
    if (!organizationId)
        return;
    for (const check of checks) {
        const ids = check.ids.filter((id) => Boolean(id));
        if (!(await (0, waste_repository_1.resourcesBelongToOrganization)(check.resource, ids, organizationId))) {
            const error = new Error(`${check.label} must belong to the authenticated organization`);
            error.statusCode = 400;
            throw error;
        }
    }
}
async function listZones(organizationId) {
    return (0, waste_repository_1.findZones)(organizationId);
}
async function addZone(input) {
    if (input.organizationId && !input.divisionId) {
        const error = Object.assign(new Error("Choose one of the divisions KCCA assigned to your organization"), { statusCode: 400 });
        throw error;
    }
    return (0, waste_repository_1.createZone)(input);
}
async function editZone(zoneId, organizationId, input) { return (0, waste_repository_1.updateZoneForOrganization)(zoneId, organizationId, input); }
async function assignServiceArea(zoneId, input) {
    return (0, waste_repository_1.assignZoneServiceArea)(zoneId, input);
}
async function listTrucks(organizationId) {
    return (0, waste_repository_1.findTrucks)(organizationId);
}
async function addTruck(input) {
    return (0, waste_repository_1.createTruck)(input);
}
async function listDrivers(organizationId) {
    return (0, waste_repository_1.findDrivers)(organizationId);
}
async function addDriver(input) {
    await requireOwnedResources(input.organizationId, [
        { resource: "users", ids: [input.userId], label: "Driver user" },
    ]);
    return (0, waste_repository_1.createDriver)(input);
}
async function listPickupSchedules(organizationId) {
    return (0, waste_repository_1.findPickupSchedules)(organizationId);
}
async function addPickupSchedule(input) {
    await requireOwnedResources(input.organizationId, [
        { resource: "waste_zones", ids: [input.zoneId], label: "Zone" },
    ]);
    return (0, waste_repository_1.createPickupSchedule)(input);
}
async function listCollectionJobs(organizationId) {
    return (0, waste_repository_1.findCollectionJobs)(organizationId);
}
async function addCollectionJob(input) {
    await requireOwnedResources(input.organizationId, [
        { resource: "waste_zones", ids: [input.zoneId], label: "Zone" },
        { resource: "waste_trucks", ids: [input.truckId], label: "Truck" },
        { resource: "drivers", ids: [input.driverId], label: "Driver" },
        { resource: "pickup_schedules", ids: [input.scheduleId], label: "Schedule" },
    ]);
    return (0, waste_repository_1.createCollectionJob)(input);
}
async function changeCollectionJobStatus(jobId, input, organizationId) {
    return (0, waste_repository_1.updateCollectionJobStatus)(jobId, input, organizationId);
}
async function generateJobsForPickupSchedule(scheduleId, input, organizationId) {
    if (organizationId) {
        await requireOwnedResources(organizationId, [
            { resource: "waste_trucks", ids: [input.truckId], label: "Truck" },
            { resource: "drivers", ids: [input.driverId], label: "Driver" },
        ]);
    }
    const result = await (0, waste_repository_1.generateCollectionJobsFromSchedule)(scheduleId, input, organizationId);
    let customerStopsCreated = 0;
    if (organizationId) {
        for (const job of result.jobs) {
            const planned = await (0, customer_stop_repository_1.generateCustomerStops)(job.id, organizationId);
            customerStopsCreated += planned?.created ?? 0;
        }
    }
    return { ...result, customerStopsCreated };
}
async function assignTruckAndDriverToJob(jobId, input, organizationId) {
    const job = await (0, waste_repository_1.assignCollectionJob)(jobId, input, organizationId);
    if (!job || !organizationId)
        return job;
    const planned = await (0, customer_stop_repository_1.generateCustomerStops)(job.id, organizationId);
    return { ...job, customer_stops_created: planned?.created ?? 0, customer_stop_count: planned?.total ?? 0 };
}
async function listDriverJobs(driverId, organizationId, userId) {
    return (0, waste_repository_1.findJobsByDriverId)(driverId, organizationId, userId);
}
async function startDriverJob(jobId, organizationId, userId) {
    return (0, waste_repository_1.startDriverCollectionJob)(jobId, organizationId, userId);
}
async function completeDriverJob(jobId, collectedWeightKg, organizationId, userId) {
    return (0, waste_repository_1.completeDriverCollectionJob)(jobId, collectedWeightKg, organizationId, userId);
}
async function listCollectionRoutes(organizationId) {
    return (0, waste_repository_1.findCollectionRoutes)(organizationId);
}
async function addCollectionRoute(input) {
    await requireOwnedResources(input.organizationId, [
        { resource: "waste_trucks", ids: [input.truckId], label: "Truck" },
        { resource: "drivers", ids: [input.driverId], label: "Driver" },
        { resource: "collection_jobs", ids: input.jobIds, label: "Route jobs" },
    ]);
    return (0, waste_repository_1.createCollectionRoute)(input);
}
async function getCollectionRouteDetails(routeId, organizationId) {
    return (0, waste_repository_1.findCollectionRouteById)(routeId, organizationId);
}
async function generateRoadRouteForCollectionRoute(routeId, organizationId) {
    const route = await (0, waste_repository_1.findCollectionRouteById)(routeId, organizationId);
    if (!route) {
        return {
            status: "not_found",
        };
    }
    const jobs = Array.isArray(route.jobs)
        ? route.jobs
        : [];
    if (jobs.length < 2) {
        return {
            status: "insufficient_stops",
            route,
        };
    }
    const invalidCoordinateStops = jobs
        .filter((job) => {
        if (job.latitude === null ||
            job.latitude === undefined ||
            job.longitude === null ||
            job.longitude === undefined) {
            return true;
        }
        const latitude = Number(job.latitude);
        const longitude = Number(job.longitude);
        return (!Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180);
    })
        .map((job) => ({
        jobId: job.id,
        zoneId: job.zone_id,
        zoneName: job.zone_name,
        stopOrder: job.stop_order,
    }));
    if (invalidCoordinateStops.length > 0) {
        return {
            status: "invalid_coordinates",
            route,
            invalidCoordinateStops,
        };
    }
    const coordinates = jobs.map((job) => ({
        latitude: Number(job.latitude),
        longitude: Number(job.longitude),
    }));
    const routingResult = await (0, routing_service_1.calculateRoadRoute)(coordinates);
    const totalDistanceKm = Number((routingResult.distanceMeters / 1000).toFixed(2));
    const estimatedDurationMinutes = Math.ceil(routingResult.durationSeconds / 60);
    const persistedRoute = await (0, waste_repository_1.updateCollectionRouteRoutingData)(routeId, JSON.stringify(routingResult.geometry), totalDistanceKm, estimatedDurationMinutes, organizationId);
    if (!persistedRoute) {
        return {
            status: "not_found",
        };
    }
    const updatedRoute = await (0, waste_repository_1.findCollectionRouteById)(routeId, organizationId);
    return {
        status: "generated",
        route: updatedRoute,
    };
}
