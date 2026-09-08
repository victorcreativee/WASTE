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
exports.getPayroll = getPayroll;
exports.postPeriod = postPeriod;
exports.putLine = putLine;
exports.patchPeriod = patchPeriod;
const repo = __importStar(require("../repositories/payroll.repository"));
const payroll_validator_1 = require("../validators/payroll.validator");
const org = (q) => { const id = q.user?.organizationId; if (!id) {
    const e = new Error('Account is not linked to an organization');
    e.statusCode = 403;
    throw e;
} return id; };
async function getPayroll(q, s) { return s.json({ success: true, message: 'Payroll fetched', data: await repo.findPayroll(org(q)) }); }
async function postPeriod(q, s) { const data = await repo.createPeriod(org(q), q.user.userId, payroll_validator_1.createPayrollPeriodSchema.parse(q.body)); return data ? s.status(201).json({ success: true, message: 'Payroll period created', data }) : s.status(409).json({ success: false, message: 'This payroll period overlaps an existing active period' }); }
async function putLine(q, s) { const data = await repo.saveLine(org(q), q.params.periodId, payroll_validator_1.payrollLineSchema.parse(q.body)); return data ? s.json({ success: true, message: 'Pay line saved', data }) : s.status(409).json({ success: false, message: 'Draft period or staff member is unavailable' }); }
async function patchPeriod(q, s) { const status = payroll_validator_1.payrollStatusSchema.parse(q.body).status; const data = await repo.changePeriodStatus(org(q), q.user.userId, q.params.periodId, status); const message = status === 'approved' ? 'Payroll cannot be approved: net payroll exceeds funds available to commit, contains no pay lines, or its status changed.' : status === 'paid' ? 'Payroll cannot be paid: net payroll exceeds the current cash balance or its status changed.' : 'Payroll cannot move to that status.'; return data ? s.json({ success: true, message: 'Payroll status updated', data }) : s.status(409).json({ success: false, message }); }
