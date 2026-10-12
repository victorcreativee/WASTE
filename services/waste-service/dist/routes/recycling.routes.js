"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const organization_permission_middleware_1 = require("../middlewares/organization-permission.middleware");
const recycling_controller_1 = require("../controllers/recycling.controller");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
const permission = (code) => (0, organization_permission_middleware_1.requireOrganizationPermission)(code);
r.get('/recycling', permission('recycling.read'), run(recycling_controller_1.getRecycling));
r.post('/recycling/lots', permission('recycling.purchase.create'), run(recycling_controller_1.postLot));
r.post('/recycling/sales', (0, organization_permission_middleware_1.requireAnyOrganizationPermission)('recycling.local_sale.create', 'recycling.industrial_sale.manage'), run(recycling_controller_1.postSale));
r.post('/recycling/manager-float', permission('recycling.finance.manage'), run(recycling_controller_1.postManagerFloat));
r.post('/recycling/sorting', permission('recycling.inventory.manage'), run(recycling_controller_1.postSorting));
r.post('/recycling/stock-adjustments', permission('recycling.inventory.manage'), run(recycling_controller_1.postStockAdjustment));
r.post('/recycling/partners', permission('recycling.industrial_sale.manage'), run(recycling_controller_1.postPartner));
r.patch('/recycling/partners/:id/status', permission('recycling.industrial_sale.manage'), run(recycling_controller_1.patchPartnerState));
r.post('/recycling/materials', permission('recycling.inventory.manage'), run(recycling_controller_1.postMaterial));
r.patch('/recycling/materials/:id/status', permission('recycling.inventory.manage'), run(recycling_controller_1.patchMaterialState));
r.patch('/recycling/lots/:id/paid', permission('recycling.finance.manage'), run(recycling_controller_1.payPurchase));
r.patch('/recycling/sales/:id/paid', permission('recycling.industrial_sale.manage'), run(recycling_controller_1.paySale));
r.patch('/recycling/lots/:id/due-date', permission('recycling.finance.manage'), run(recycling_controller_1.patchPurchaseDueDate));
r.patch('/recycling/sales/:id/due-date', permission('recycling.industrial_sale.manage'), run(recycling_controller_1.patchSaleDueDate));
r.post('/recycling/sales/:id/follow-ups', permission('recycling.industrial_sale.manage'), run(recycling_controller_1.postPaymentFollowUp));
r.post('/recycling/daily-closures', permission('recycling.daily_close.manage'), run(recycling_controller_1.postDailyClose));
r.patch('/recycling/daily-closures/:id/reopen', (0, auth_middleware_1.requireRoles)('company_admin'), permission('recycling.daily_close.manage'), run(recycling_controller_1.patchDailyReopen));
exports.default = r;
