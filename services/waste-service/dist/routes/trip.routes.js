"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const trip_controller_1 = require("../controllers/trip.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
r.get("/trips", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor", "kcca_admin", "system_admin", "weighbridge_operator"), run(trip_controller_1.getTrips));
r.get("/operations/supervisors", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor"), run(trip_controller_1.getOperationalSupervisors));
r.post("/trips", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor"), run(trip_controller_1.postTrip));
r.patch("/trips/:tripId/weighbridge", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor"), run(trip_controller_1.patchTripWeight));
exports.default = r;
