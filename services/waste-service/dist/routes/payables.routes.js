"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const payables_controller_1 = require("../controllers/payables.controller");
const organization_permission_middleware_1 = require("../middlewares/organization-permission.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} }, permission = (code) => (0, organization_permission_middleware_1.requireOrganizationPermission)(code);
r.get('/finance/payables', permission('payables.read'), run(payables_controller_1.getPayables));
r.post('/finance/payables/bills', permission('payables.bill.manage'), run(payables_controller_1.postBill));
r.post('/finance/payables/bills/:billId/payments', permission('payables.payment.create'), run(payables_controller_1.postPayment));
exports.default = r;
