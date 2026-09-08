"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const report_controller_1 = require("../controllers/report.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const r = (0, express_1.Router)();
r.get('/reports/organization', (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor', 'kcca_admin', 'system_admin'), async (q, s, n) => { try {
    await (0, report_controller_1.getOrganizationReport)(q, s);
}
catch (e) {
    n(e);
} });
exports.default = r;
