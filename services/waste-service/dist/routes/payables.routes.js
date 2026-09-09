"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const payables_controller_1 = require("../controllers/payables.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
r.get('/finance/payables', (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor'), run(payables_controller_1.getPayables));
r.post('/finance/payables/bills', (0, auth_middleware_1.requireRoles)('company_admin'), run(payables_controller_1.postBill));
r.post('/finance/payables/bills/:billId/payments', (0, auth_middleware_1.requireRoles)('company_admin'), run(payables_controller_1.postPayment));
exports.default = r;
