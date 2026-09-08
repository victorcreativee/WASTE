"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fleet_controller_1 = require("../controllers/fleet.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
const run = (h) => async (r, s, n) => { try {
    await h(r, s);
}
catch (e) {
    n(e);
} };
const view = (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor', 'kcca_admin', 'system_admin');
const manage = (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor');
router.get('/fleet/overview', view, run(fleet_controller_1.getFleetOverview));
router.get('/fleet/trucks/:truckId', view, run(fleet_controller_1.getFleetTruck));
router.patch('/fleet/trucks/:truckId/status', manage, run(fleet_controller_1.patchTruck));
router.post('/fleet/trucks/:truckId/maintenance', manage, run(fleet_controller_1.createMaintenance));
router.patch('/fleet/maintenance/:id/status', manage, run(fleet_controller_1.patchMaintenance));
router.post('/fleet/trucks/:truckId/documents', manage, run(fleet_controller_1.createDocument));
router.post('/fleet/trucks/:truckId/fuel', manage, run(fleet_controller_1.createFuel));
exports.default = router;
