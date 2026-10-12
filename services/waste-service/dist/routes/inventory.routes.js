"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const inventory_controller_1 = require("../controllers/inventory.controller");
const organization_permission_middleware_1 = require("../middlewares/organization-permission.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} }, permission = (code) => (0, organization_permission_middleware_1.requireOrganizationPermission)(code);
r.get('/inventory', permission('inventory.read'), run(inventory_controller_1.getInventory));
r.post('/inventory/items', permission('inventory.manage'), run(inventory_controller_1.postItem));
r.post('/inventory/items/:itemId/movements', permission('inventory.manage'), run(inventory_controller_1.postMovement));
r.post('/inventory/purchase-requests', permission('procurement.request.create'), run(inventory_controller_1.postRequest));
r.patch('/inventory/purchase-requests/:id/status', permission('procurement.request.approve'), run(inventory_controller_1.patchRequest));
exports.default = r;
