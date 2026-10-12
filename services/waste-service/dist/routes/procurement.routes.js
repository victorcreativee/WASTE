"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const procurement_controller_1 = require("../controllers/procurement.controller");
const organization_permission_middleware_1 = require("../middlewares/organization-permission.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} }, permission = (code) => (0, organization_permission_middleware_1.requireOrganizationPermission)(code);
r.get('/procurement', permission('procurement.read'), run(procurement_controller_1.getProcurement));
r.post('/procurement/suppliers', permission('procurement.manage'), run(procurement_controller_1.postSupplier));
r.post('/procurement/orders', permission('procurement.manage'), run(procurement_controller_1.postOrder));
r.patch('/procurement/orders/:id/status', permission('procurement.manage'), run(procurement_controller_1.patchOrder));
exports.default = r;
