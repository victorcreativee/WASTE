"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZones = getZones;
exports.createZoneHandler = createZoneHandler;
exports.updateZoneHandler = updateZoneHandler;
exports.assignZoneServiceAreaHandler = assignZoneServiceAreaHandler;
exports.getTrucks = getTrucks;
exports.createTruckHandler = createTruckHandler;
exports.getDrivers = getDrivers;
exports.createDriverHandler = createDriverHandler;
exports.getPickupSchedules = getPickupSchedules;
exports.createPickupScheduleHandler = createPickupScheduleHandler;
exports.getCollectionJobs = getCollectionJobs;
exports.createCollectionJobHandler = createCollectionJobHandler;
exports.updateCollectionJobStatusHandler = updateCollectionJobStatusHandler;
exports.generateCollectionJobsHandler = generateCollectionJobsHandler;
exports.assignCollectionJobHandler = assignCollectionJobHandler;
exports.getDriverJobsHandler = getDriverJobsHandler;
exports.startDriverJobHandler = startDriverJobHandler;
exports.completeDriverJobHandler = completeDriverJobHandler;
exports.getCollectionRoutes = getCollectionRoutes;
exports.createCollectionRouteHandler = createCollectionRouteHandler;
exports.getCollectionRouteDetailsHandler = getCollectionRouteDetailsHandler;
exports.generateCollectionRouteRoadRouteHandler = generateCollectionRouteRoadRouteHandler;
const organization_scope_1 = require("../middlewares/organization-scope");
const waste_validator_1 = require("../validators/waste.validator");
const waste_service_1 = require("../services/waste.service");
const organizationScope = organization_scope_1.operationalOrganizationScope;
function driverUserScope(req) {
    const auth = req.auth;
    return auth?.roles.includes("driver") ? auth.userId : null;
}
function enforceOrganization(req, input) {
    const organizationId = organizationScope(req);
    return organizationId ? { ...input, organizationId } : input;
}
async function getZones(req, res) {
    const zones = await (0, waste_service_1.listZones)(organizationScope(req));
    return res.status(200).json({
        success: true,
        message: "Waste zones fetched successfully",
        data: zones,
    });
}
async function createZoneHandler(req, res) {
    const input = waste_validator_1.createZoneSchema.parse(req.body);
    const zone = await (0, waste_service_1.addZone)(enforceOrganization(req, input));
    return res.status(201).json({
        success: true,
        message: "Waste zone created successfully",
        data: zone,
    });
}
async function updateZoneHandler(req, res) {
    const organizationId = organizationScope(req);
    if (!organizationId)
        return res.status(403).json({ success: false, message: "Only the responsible company can edit its zone" });
    const input = waste_validator_1.updateZoneSchema.parse(req.body), zone = await (0, waste_service_1.editZone)(req.params.id, organizationId, input);
    if (!zone)
        return res.status(404).json({ success: false, message: "Zone not found" });
    return res.json({ success: true, message: "Zone updated", data: zone });
}
async function assignZoneServiceAreaHandler(req, res) {
    const input = waste_validator_1.assignZoneServiceAreaSchema.parse(req.body);
    const zone = await (0, waste_service_1.assignServiceArea)(req.params.id, input);
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
async function getTrucks(req, res) {
    const trucks = await (0, waste_service_1.listTrucks)(organizationScope(req));
    return res.status(200).json({
        success: true,
        message: "Waste trucks fetched successfully",
        data: trucks,
    });
}
async function createTruckHandler(req, res) {
    const input = waste_validator_1.createTruckSchema.parse(req.body);
    const truck = await (0, waste_service_1.addTruck)(enforceOrganization(req, input));
    return res.status(201).json({
        success: true,
        message: "Waste truck created successfully",
        data: truck,
    });
}
async function getDrivers(req, res) {
    const drivers = await (0, waste_service_1.listDrivers)(organizationScope(req));
    return res.status(200).json({
        success: true,
        message: "Drivers fetched successfully",
        data: drivers,
    });
}
async function createDriverHandler(req, res) {
    const input = waste_validator_1.createDriverSchema.parse(req.body);
    const driver = await (0, waste_service_1.addDriver)(enforceOrganization(req, input));
    return res.status(201).json({
        success: true,
        message: "Driver created successfully",
        data: driver,
    });
}
async function getPickupSchedules(req, res) {
    const schedules = await (0, waste_service_1.listPickupSchedules)(organizationScope(req));
    return res.status(200).json({
        success: true,
        message: "Pickup schedules fetched successfully",
        data: schedules,
    });
}
async function createPickupScheduleHandler(req, res) {
    const input = waste_validator_1.createPickupScheduleSchema.parse(req.body);
    const schedule = await (0, waste_service_1.addPickupSchedule)(enforceOrganization(req, input));
    return res.status(201).json({
        success: true,
        message: "Pickup schedule created successfully",
        data: schedule,
    });
}
async function getCollectionJobs(req, res) {
    const jobs = await (0, waste_service_1.listCollectionJobs)(organizationScope(req));
    return res.status(200).json({
        success: true,
        message: "Collection jobs fetched successfully",
        data: jobs,
    });
}
async function createCollectionJobHandler(req, res) {
    const input = waste_validator_1.createCollectionJobSchema.parse(req.body);
    const job = await (0, waste_service_1.addCollectionJob)(enforceOrganization(req, input));
    return res.status(201).json({
        success: true,
        message: "Collection job created successfully",
        data: job,
    });
}
async function updateCollectionJobStatusHandler(req, res) {
    const input = waste_validator_1.updateCollectionJobStatusSchema.parse(req.body);
    const job = await (0, waste_service_1.changeCollectionJobStatus)(req.params.id, input, organizationScope(req));
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
async function generateCollectionJobsHandler(req, res) {
    const input = waste_validator_1.generateCollectionJobsSchema.parse(req.body);
    const scheduleId = req.params.id;
    const result = await (0, waste_service_1.generateJobsForPickupSchedule)(scheduleId, input, organizationScope(req));
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
async function assignCollectionJobHandler(req, res) {
    const input = waste_validator_1.assignCollectionJobSchema.parse(req.body);
    const jobId = req.params.id;
    const job = await (0, waste_service_1.assignTruckAndDriverToJob)(jobId, input, organizationScope(req));
    if (!job) {
        return res.status(400).json({
            success: false,
            message: "Collection job cannot be assigned. Check that the job is still open, the driver is active, and the vehicle is available with no expired compliance document.",
        });
    }
    return res.status(200).json({
        success: true,
        message: "Collection job assigned successfully",
        data: job,
    });
}
async function getDriverJobsHandler(req, res) {
    const driverId = req.params.driverId ?? "";
    const jobs = await (0, waste_service_1.listDriverJobs)(driverId, organizationScope(req), driverUserScope(req));
    return res.status(200).json({
        success: true,
        message: "Driver jobs fetched successfully",
        data: jobs,
    });
}
async function startDriverJobHandler(req, res) {
    const jobId = req.params.jobId;
    const job = await (0, waste_service_1.startDriverJob)(jobId, organizationScope(req), driverUserScope(req));
    if (!job) {
        return res.status(400).json({
            success: false,
            message: "Driver job cannot be started. It may not exist, may not be assigned, or may not have a truck and driver.",
        });
    }
    return res.status(200).json({
        success: true,
        message: "Driver job started successfully",
        data: job,
    });
}
async function completeDriverJobHandler(req, res) {
    const jobId = req.params.jobId;
    const collectedWeightKg = typeof req.body.collectedWeightKg === "number"
        ? req.body.collectedWeightKg
        : undefined;
    const job = await (0, waste_service_1.completeDriverJob)(jobId, collectedWeightKg, organizationScope(req), driverUserScope(req));
    if (!job) {
        return res.status(400).json({
            success: false,
            message: "Driver job cannot be completed. It may not exist or may not be in progress.",
        });
    }
    return res.status(200).json({
        success: true,
        message: "Driver job completed successfully",
        data: job,
    });
}
async function getCollectionRoutes(req, res) {
    const routes = await (0, waste_service_1.listCollectionRoutes)(organizationScope(req));
    return res.status(200).json({
        success: true,
        message: "Collection routes fetched successfully",
        data: routes,
    });
}
async function createCollectionRouteHandler(req, res) {
    const input = waste_validator_1.createCollectionRouteSchema.parse(req.body);
    const route = await (0, waste_service_1.addCollectionRoute)(enforceOrganization(req, input));
    return res.status(201).json({
        success: true,
        message: "Collection route created successfully",
        data: route,
    });
}
async function getCollectionRouteDetailsHandler(req, res) {
    const routeId = req.params.id;
    const route = await (0, waste_service_1.getCollectionRouteDetails)(routeId, organizationScope(req));
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
async function generateCollectionRouteRoadRouteHandler(req, res) {
    const routeId = req.params.id;
    const result = await (0, waste_service_1.generateRoadRouteForCollectionRoute)(routeId, organizationScope(req));
    if (result.status === "not_found") {
        return res.status(404).json({
            success: false,
            message: "Collection route not found",
        });
    }
    if (result.status === "insufficient_stops") {
        return res.status(400).json({
            success: false,
            message: "At least two ordered collection stops are required to generate a road route",
            data: result.route,
        });
    }
    if (result.status === "invalid_coordinates") {
        return res.status(400).json({
            success: false,
            message: "Every collection stop must have valid zone coordinates before road routing can be generated",
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
