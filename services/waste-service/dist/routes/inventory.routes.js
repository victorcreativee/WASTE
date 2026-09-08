"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const inventory_controller_1 = require("../controllers/inventory.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
const view = (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor', 'kcca_admin', 'system_admin'), manage = (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor'), approve = (0, auth_middleware_1.requireRoles)('company_admin');
r.get('/inventory', view, run(inventory_controller_1.getInventory));
r.post('/inventory/items', manage, run(inventory_controller_1.postItem));
r.post('/inventory/items/:itemId/movements', manage, run(inventory_controller_1.postMovement));
r.post('/inventory/purchase-requests', manage, run(inventory_controller_1.postRequest));
r.patch('/inventory/purchase-requests/:id/status', approve, run(inventory_controller_1.patchRequest));
exports.default = r;
