"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const customer_stop_controller_1 = require("../controllers/customer-stop.controller");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
r.get('/customer-collection-stops', (0, auth_middleware_1.requireRoles)('citizen', 'company_admin', 'supervisor'), run(customer_stop_controller_1.getCustomerStops));
r.post('/collection-jobs/:jobId/customer-stops', (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor'), run(customer_stop_controller_1.postCustomerStops));
r.patch('/customer-collection-stops/:id', (0, auth_middleware_1.requireRoles)('driver'), run(customer_stop_controller_1.patchCustomerStop));
exports.default = r;
r.patch('/customer-collection-stops/:id/exception', (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor'), run(customer_stop_controller_1.patchCustomerStopException));
