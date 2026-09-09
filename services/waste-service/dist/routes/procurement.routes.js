"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const procurement_controller_1 = require("../controllers/procurement.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
const view = (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor'), manage = (0, auth_middleware_1.requireRoles)('company_admin');
r.get('/procurement', view, run(procurement_controller_1.getProcurement));
r.post('/procurement/suppliers', manage, run(procurement_controller_1.postSupplier));
r.post('/procurement/orders', manage, run(procurement_controller_1.postOrder));
r.patch('/procurement/orders/:id/status', manage, run(procurement_controller_1.patchOrder));
exports.default = r;
