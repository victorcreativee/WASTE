"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const service_route_controller_1 = require("../controllers/service-route.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
const run = (handler) => async (req, res, next) => { try {
    await handler(req, res);
}
catch (error) {
    next(error);
} };
const view = (0, auth_middleware_1.requireRoles)("company_admin", "supervisor");
router.get("/service-areas/divisions", view, run(service_route_controller_1.getAuthorizedDivisions));
router.get("/service-areas/catalog", view, run(service_route_controller_1.getDivisionAreaCatalog));
router.get("/service-routes", view, run(service_route_controller_1.getServiceRoutes));
router.post("/service-routes", (0, auth_middleware_1.requireRoles)("company_admin"), run(service_route_controller_1.postServiceRoute));
router.patch("/service-routes/:id", (0, auth_middleware_1.requireRoles)("company_admin"), run(service_route_controller_1.patchServiceRoute));
router.get("/service-routes/:id/customers", view, run(service_route_controller_1.getServiceRouteCustomers));
router.put("/service-routes/:id/customers", (0, auth_middleware_1.requireRoles)("company_admin"), run(service_route_controller_1.putServiceRouteCustomers));
exports.default = router;
