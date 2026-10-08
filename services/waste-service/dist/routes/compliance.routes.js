"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const compliance_controller_1 = require("../controllers/compliance.controller");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
r.get('/compliance/city', (0, auth_middleware_1.requireRoles)('kcca_admin', 'system_admin'), run(compliance_controller_1.getCityCompliance));
r.post('/compliance/city', (0, auth_middleware_1.requireRoles)('kcca_admin'), run(compliance_controller_1.postCompliance));
r.patch('/compliance/city/:id/review', (0, auth_middleware_1.requireRoles)('kcca_admin'), run(compliance_controller_1.patchComplianceReview));
r.get('/compliance/organization', (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor'), run(compliance_controller_1.getOrganizationCompliance));
r.patch('/compliance/organization/:id/respond', (0, auth_middleware_1.requireRoles)('company_admin'), run(compliance_controller_1.patchComplianceResponse));
exports.default = r;
