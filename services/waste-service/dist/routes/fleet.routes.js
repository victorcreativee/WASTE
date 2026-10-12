"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fleet_controller_1 = require("../controllers/fleet.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const organization_permission_middleware_1 = require("../middlewares/organization-permission.middleware");
const router = (0, express_1.Router)();
const run = (h) => async (r, s, n) => { try {
    await h(r, s);
}
catch (e) {
    n(e);
} };
const view = (0, organization_permission_middleware_1.requireOrganizationPermission)('fleet.read');
const manage = (0, organization_permission_middleware_1.requireOrganizationPermission)('fleet.manage');
const cityOrFleetView = (0, organization_permission_middleware_1.requireRoleOrOrganizationPermission)(['kcca_admin', 'system_admin'], 'fleet.read');
router.get('/fleet/live', cityOrFleetView, run(fleet_controller_1.getLiveFleet));
router.get('/fleet/live/:truckId/history', cityOrFleetView, run(fleet_controller_1.getVehicleLocationHistory));
router.get('/fleet/live/:truckId/alerts', cityOrFleetView, run(fleet_controller_1.getLiveAlertHistory));
router.post('/fleet/live/:truckId/alerts', (0, organization_permission_middleware_1.requireOrganizationPermission)('fleet.alert.review'), run(fleet_controller_1.reviewLiveAlert));
router.post('/fleet/live/location', (0, auth_middleware_1.requireRoles)('driver'), run(fleet_controller_1.postDriverLocation));
router.get('/fleet/overview', view, run(fleet_controller_1.getFleetOverview));
router.get('/fleet/trucks/:truckId', view, run(fleet_controller_1.getFleetTruck));
router.patch('/fleet/trucks/:truckId/status', manage, run(fleet_controller_1.patchTruck));
router.post('/fleet/trucks/:truckId/maintenance', manage, run(fleet_controller_1.createMaintenance));
router.patch('/fleet/maintenance/:id/status', manage, run(fleet_controller_1.patchMaintenance));
router.post('/fleet/trucks/:truckId/documents', manage, run(fleet_controller_1.createDocument));
router.post('/fleet/trucks/:truckId/fuel', manage, run(fleet_controller_1.createFuel));
exports.default = router;
