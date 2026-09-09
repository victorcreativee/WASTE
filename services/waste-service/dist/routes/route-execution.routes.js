"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const route_execution_controller_1 = require("../controllers/route-execution.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
const run = (handler) => async (req, res, next) => {
    try {
        await handler(req, res);
    }
    catch (error) {
        next(error);
    }
};
const canMonitor = (0, auth_middleware_1.requireRoles)("driver", "company_admin", "supervisor", "kcca_admin", "system_admin");
router.get("/driver/routes", canMonitor, run(route_execution_controller_1.getDriverRoutesHandler));
router.get("/drivers/:driverId/routes", canMonitor, run(route_execution_controller_1.getDriverRoutesHandler));
router.get("/driver-routes/:routeId", canMonitor, run(route_execution_controller_1.getDriverRouteDetailsHandler));
router.patch("/collection-routes/:routeId/dispatch", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor"), run(route_execution_controller_1.dispatchCollectionRouteHandler));
router.patch("/collection-routes/:routeId/cancel", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor"), run(route_execution_controller_1.cancelCollectionRouteHandler));
router.patch("/driver-routes/:routeId/start", (0, auth_middleware_1.requireRoles)("driver"), run(route_execution_controller_1.startDriverRouteHandler));
router.patch("/driver-route-stops/:stopId/arrive", (0, auth_middleware_1.requireRoles)("driver"), run(route_execution_controller_1.arriveAtRouteStopHandler));
router.patch("/driver-route-stops/:stopId/complete", (0, auth_middleware_1.requireRoles)("driver"), run(route_execution_controller_1.completeRouteStopHandler));
exports.default = router;
