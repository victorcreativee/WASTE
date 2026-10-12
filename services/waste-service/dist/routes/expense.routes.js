"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const expense_controller_1 = require("../controllers/expense.controller");
const organization_permission_middleware_1 = require("../middlewares/organization-permission.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} }, permission = (code) => (0, organization_permission_middleware_1.requireOrganizationPermission)(code);
r.get('/finance/expenses', permission('finance.read'), run(expense_controller_1.getExpenses));
r.get('/finance/position', permission('finance.read'), run(expense_controller_1.getFinancialPosition));
r.put('/finance/position/opening-balance', permission('finance.settings.manage'), run(expense_controller_1.putOpeningBalance));
r.post('/finance/expenses', permission('finance.expense.create'), run(expense_controller_1.postExpense));
r.patch('/finance/expenses/:id/status', permission('finance.expense.approve'), run(expense_controller_1.patchExpense));
exports.default = r;
