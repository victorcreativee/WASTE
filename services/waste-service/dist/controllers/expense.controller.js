"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExpenses = getExpenses;
exports.postExpense = postExpense;
exports.patchExpense = patchExpense;
exports.getFinancialPosition = getFinancialPosition;
exports.putOpeningBalance = putOpeningBalance;
const organization_scope_1 = require("../middlewares/organization-scope");
const repo = __importStar(require("../repositories/expense.repository"));
const expense_validator_1 = require("../validators/expense.validator");
const auth = (r) => r.auth;
const scope = organization_scope_1.requireOrganizationScope;
const org = (r) => { const id = auth(r).organizationId; if (!id) {
    const e = new Error('Account is not linked to an organization');
    e.statusCode = 403;
    throw e;
} return id; };
async function getExpenses(req, res) { return res.json({ success: true, message: 'Expenses fetched', data: await repo.findExpenses(scope(req)) }); }
async function postExpense(req, res) { return res.status(201).json({ success: true, message: 'Expense submitted for approval', data: await repo.createExpense(org(req), auth(req).userId, expense_validator_1.createExpenseSchema.parse(req.body)) }); }
async function patchExpense(req, res) { const status = expense_validator_1.expenseStatusSchema.parse(req.body).status; const data = await repo.updateExpenseStatus(req.params.id, org(req), auth(req).userId, status); const failure = status === 'approved' ? 'Expense cannot be approved: its amount exceeds funds available to commit or its status changed.' : status === 'paid' ? 'Expense cannot be paid: its amount exceeds the current cash balance or its status changed.' : 'Expense cannot move to that status.'; return data ? res.json({ success: true, message: 'Expense status updated', data }) : res.status(409).json({ success: false, message: failure }); }
async function getFinancialPosition(req, res) { return res.json({ success: true, message: 'Financial position fetched', data: await repo.findFinancialPosition(org(req)) }); }
async function putOpeningBalance(req, res) { return res.json({ success: true, message: 'Opening balance updated', data: await repo.setOpeningBalance(org(req), auth(req).userId, expense_validator_1.openingBalanceSchema.parse(req.body)) }); }
