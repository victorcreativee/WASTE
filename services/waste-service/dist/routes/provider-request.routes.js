"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const provider_request_controller_1 = require("../controllers/provider-request.controller");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
r.get('/customer-service/provider-options', (0, auth_middleware_1.requireRoles)('citizen'), run(provider_request_controller_1.getProviderOptions));
r.get('/customer-service/provider-requests', (0, auth_middleware_1.requireRoles)('citizen'), run(provider_request_controller_1.getMyProviderRequests));
r.post('/customer-service/provider-requests', (0, auth_middleware_1.requireRoles)('citizen'), run(provider_request_controller_1.postProviderRequest));
r.delete('/customer-service/provider-requests/:id', (0, auth_middleware_1.requireRoles)('citizen'), run(provider_request_controller_1.deleteProviderRequest));
r.get('/customers/provider-requests', (0, auth_middleware_1.requireRoles)('company_admin'), run(provider_request_controller_1.getOrganizationProviderRequests));
r.patch('/customers/provider-requests/:id', (0, auth_middleware_1.requireRoles)('company_admin'), run(provider_request_controller_1.patchProviderRequest));
exports.default = r;
