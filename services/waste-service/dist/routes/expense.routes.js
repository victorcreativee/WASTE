"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const expense_controller_1 = require("../controllers/expense.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
r.get('/finance/expenses', (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor', 'kcca_admin', 'system_admin'), run(expense_controller_1.getExpenses));
r.get('/finance/position', (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor'), run(expense_controller_1.getFinancialPosition));
r.put('/finance/position/opening-balance', (0, auth_middleware_1.requireRoles)('company_admin'), run(expense_controller_1.putOpeningBalance));
r.post('/finance/expenses', (0, auth_middleware_1.requireRoles)('company_admin', 'supervisor'), run(expense_controller_1.postExpense));
r.patch('/finance/expenses/:id/status', (0, auth_middleware_1.requireRoles)('company_admin'), run(expense_controller_1.patchExpense));
exports.default = r;
