"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const report_controller_1 = require("../controllers/report.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const r = (0, express_1.Router)(), run = (handler) => async (q, s, n) => { try {
    await handler(q, s);
}
catch (e) {
    n(e);
} };
r.get('/reports/organization', (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor'), run(report_controller_1.getOrganizationReport));
r.get('/reports/city-collectors', (0, auth_middleware_1.requireRoles)('kcca_admin', 'system_admin'), run(report_controller_1.getCityCollectorReport));
exports.default = r;
