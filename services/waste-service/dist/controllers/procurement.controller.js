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
exports.getProcurement = getProcurement;
exports.postSupplier = postSupplier;
exports.postOrder = postOrder;
exports.patchOrder = patchOrder;
const repo = __importStar(require("../repositories/procurement.repository"));
const procurement_validator_1 = require("../validators/procurement.validator");
const auth = (q) => q.auth;
const scope = (q) => auth(q).roles.some(r => ['company_admin', 'supervisor'].includes(r)) ? auth(q).organizationId : null;
const org = (q) => { const id = auth(q).organizationId; if (!id) {
    const e = new Error('Account is not linked to an organization');
    e.statusCode = 403;
    throw e;
} return id; };
async function getProcurement(q, s) { return s.json({ success: true, message: 'Procurement fetched', data: await repo.findProcurement(scope(q)) }); }
async function postSupplier(q, s) { return s.status(201).json({ success: true, message: 'Supplier added', data: await repo.createSupplier(org(q), procurement_validator_1.supplierSchema.parse(q.body)) }); }
async function postOrder(q, s) { const data = await repo.createOrder(org(q), auth(q).userId, procurement_validator_1.orderSchema.parse(q.body)); return data ? s.status(201).json({ success: true, message: 'Purchase order created', data }) : s.status(409).json({ success: false, message: 'Supplier or approved request is unavailable' }); }
async function patchOrder(q, s) { const status = procurement_validator_1.orderStatusSchema.parse(q.body).status; const data = await repo.changeOrder(org(q), auth(q).userId, q.params.id, status); const message = status === 'received' ? (data?.inventory_item_id ? 'Order received and inventory updated' : 'Standalone order received; record any stock movement from Inventory') : 'Purchase order updated'; return data ? s.json({ success: true, message, data }) : s.status(409).json({ success: false, message: 'Order cannot move to that status' }); }
