"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const waste_controller_1 = require("../controllers/waste.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
router.get("/zones", async (req, res, next) => {
    try {
        await (0, waste_controller_1.getZones)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.post("/zones", (0, auth_middleware_1.requireRoles)("system_admin", "kcca_admin"), async (req, res, next) => {
    try {
        await (0, waste_controller_1.createZoneHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.patch("/zones/:id/service-assignment", (0, auth_middleware_1.requireRoles)("system_admin", "kcca_admin"), async (req, res, next) => {
    try {
        await (0, waste_controller_1.assignZoneServiceAreaHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.get("/trucks", async (req, res, next) => {
    try {
        await (0, waste_controller_1.getTrucks)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.post("/trucks", async (req, res, next) => {
    try {
        await (0, waste_controller_1.createTruckHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.get("/drivers", async (req, res, next) => {
    try {
        await (0, waste_controller_1.getDrivers)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.post("/drivers", async (req, res, next) => {
    try {
        await (0, waste_controller_1.createDriverHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.get("/pickup-schedules", async (req, res, next) => {
    try {
        await (0, waste_controller_1.getPickupSchedules)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.post("/pickup-schedules", async (req, res, next) => {
    try {
        await (0, waste_controller_1.createPickupScheduleHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.get("/collection-jobs", async (req, res, next) => {
    try {
        await (0, waste_controller_1.getCollectionJobs)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.post("/collection-jobs", async (req, res, next) => {
    try {
        await (0, waste_controller_1.createCollectionJobHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.patch("/collection-jobs/:id/status", async (req, res, next) => {
    try {
        await (0, waste_controller_1.updateCollectionJobStatusHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.patch("/collection-jobs/:id/assign", async (req, res, next) => {
    try {
        await (0, waste_controller_1.assignCollectionJobHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.post("/pickup-schedules/:id/generate-jobs", async (req, res, next) => {
    try {
        await (0, waste_controller_1.generateCollectionJobsHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.get("/collection-routes", async (req, res, next) => {
    try {
        await (0, waste_controller_1.getCollectionRoutes)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.post("/collection-routes", async (req, res, next) => {
    try {
        await (0, waste_controller_1.createCollectionRouteHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.get("/collection-routes/:id", async (req, res, next) => {
    try {
        await (0, waste_controller_1.getCollectionRouteDetailsHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.post("/collection-routes/:id/generate-road-route", async (req, res, next) => {
    try {
        await (0, waste_controller_1.generateCollectionRouteRoadRouteHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
