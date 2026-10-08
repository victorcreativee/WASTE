"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const recycling_controller_1 = require("../controllers/recycling.controller");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
const manage = (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor'), view = (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor', 'recycling_collector', 'recycling_sales'), collect = (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor', 'recycling_collector'), sell = (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor', 'recycling_collector', 'recycling_sales'), industrial = (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor', 'recycling_sales');
r.get('/recycling', view, run(recycling_controller_1.getRecycling));
r.post('/recycling/lots', collect, run(recycling_controller_1.postLot));
r.post('/recycling/sales', sell, run(recycling_controller_1.postSale));
r.post('/recycling/manager-float', manage, run(recycling_controller_1.postManagerFloat));
r.post('/recycling/sorting', manage, run(recycling_controller_1.postSorting));
r.post('/recycling/stock-adjustments', manage, run(recycling_controller_1.postStockAdjustment));
r.post('/recycling/partners', industrial, run(recycling_controller_1.postPartner));
r.patch('/recycling/partners/:id/status', industrial, run(recycling_controller_1.patchPartnerState));
r.post('/recycling/materials', manage, run(recycling_controller_1.postMaterial));
r.patch('/recycling/materials/:id/status', manage, run(recycling_controller_1.patchMaterialState));
r.patch('/recycling/lots/:id/paid', manage, run(recycling_controller_1.payPurchase));
r.patch('/recycling/sales/:id/paid', industrial, run(recycling_controller_1.paySale));
r.patch('/recycling/lots/:id/due-date', manage, run(recycling_controller_1.patchPurchaseDueDate));
r.patch('/recycling/sales/:id/due-date', industrial, run(recycling_controller_1.patchSaleDueDate));
r.post('/recycling/sales/:id/follow-ups', industrial, run(recycling_controller_1.postPaymentFollowUp));
exports.default = r;
