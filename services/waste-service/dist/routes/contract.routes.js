"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const contract_controller_1 = require("../controllers/contract.controller");
const organization_permission_middleware_1 = require("../middlewares/organization-permission.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
r.get('/contracts', (0, organization_permission_middleware_1.requireOrganizationPermission)('contracts.read'), run(contract_controller_1.getContracts));
r.post('/contracts', (0, organization_permission_middleware_1.requireOrganizationPermission)('contracts.manage'), run(contract_controller_1.postContract));
r.patch('/contracts/:id/status', (0, organization_permission_middleware_1.requireOrganizationPermission)('contracts.manage'), run(contract_controller_1.patchContract));
exports.default = r;
