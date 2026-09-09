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
exports.getPayables = getPayables;
exports.postBill = postBill;
exports.postPayment = postPayment;
const organization_scope_1 = require("../middlewares/organization-scope");
const repo = __importStar(require("../repositories/payables.repository"));
const payables_validator_1 = require("../validators/payables.validator");
const auth = (q) => q.auth;
const scope = organization_scope_1.requireOrganizationScope;
const org = (q) => { const id = auth(q).organizationId; if (!id) {
    const e = new Error('Account is not linked to an organization');
    e.statusCode = 403;
    throw e;
} return id; };
async function getPayables(q, s) { return s.json({ success: true, message: 'Accounts payable fetched', data: await repo.findPayables(scope(q)) }); }
async function postBill(q, s) { const data = await repo.createBill(org(q), auth(q).userId, payables_validator_1.supplierBillSchema.parse(q.body)); return data ? s.status(201).json({ success: true, message: 'Supplier bill recorded', data }) : s.status(409).json({ success: false, message: 'Bill cannot be recorded: supplier or received order is unavailable, or the bill exceeds funds available to commit' }); }
async function postPayment(q, s) { const data = await repo.payBill(org(q), auth(q).userId, q.params.billId, payables_validator_1.supplierPaymentSchema.parse(q.body)); return data ? s.status(201).json({ success: true, message: 'Supplier payment recorded', data }) : s.status(409).json({ success: false, message: 'Payment cannot be recorded: the bill is unavailable, the amount exceeds the bill or cash balance, or the reference was already recorded' }); }
