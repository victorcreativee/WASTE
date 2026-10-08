"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const weighbridge_controller_1 = require("../controllers/weighbridge.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
r.get("/weighbridge/transactions", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor", "kcca_admin", "system_admin", "weighbridge_operator"), run(weighbridge_controller_1.getWeighbridge));
r.get("/weighbridge/vehicles", (0, auth_middleware_1.requireRoles)("weighbridge_operator"), run(weighbridge_controller_1.getWeighbridgeVehicles));
r.post("/weighbridge/transactions", (0, auth_middleware_1.requireRoles)("weighbridge_operator"), run(weighbridge_controller_1.postWeighbridge));
r.patch("/weighbridge/transactions/:id/complete", (0, auth_middleware_1.requireRoles)("weighbridge_operator"), run(weighbridge_controller_1.patchWeighbridgeComplete));
r.patch("/weighbridge/transactions/:id/link-trip", (0, auth_middleware_1.requireRoles)("kcca_admin", "weighbridge_operator"), run(weighbridge_controller_1.patchWeighbridgeLinkTrip));
r.patch("/weighbridge/transactions/:id/void", (0, auth_middleware_1.requireRoles)("weighbridge_operator"), run(weighbridge_controller_1.patchWeighbridgeVoid));
exports.default = r;
