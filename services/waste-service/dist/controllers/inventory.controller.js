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
exports.getInventory = getInventory;
exports.postItem = postItem;
exports.postMovement = postMovement;
exports.postRequest = postRequest;
exports.patchRequest = patchRequest;
const organization_scope_1 = require("../middlewares/organization-scope");
const repo = __importStar(require("../repositories/inventory.repository"));
const inventory_validator_1 = require("../validators/inventory.validator");
const auth = (q) => q.auth;
const scope = organization_scope_1.requireOrganizationScope;
const org = (q) => { const id = auth(q).organizationId; if (!id) {
    const e = new Error('Account is not linked to an organization');
    e.statusCode = 403;
    throw e;
} return id; };
async function getInventory(q, s) { return s.json({ success: true, message: 'Inventory fetched', data: await repo.findInventory(scope(q)) }); }
async function postItem(q, s) { return s.status(201).json({ success: true, message: 'Inventory item created', data: await repo.createItem(org(q), inventory_validator_1.itemSchema.parse(q.body)) }); }
async function postMovement(q, s) { const data = await repo.recordMovement(org(q), auth(q).userId, q.params.itemId, inventory_validator_1.movementSchema.parse(q.body)); return data ? s.status(201).json({ success: true, message: 'Stock updated', data }) : s.status(409).json({ success: false, message: 'Item not found or insufficient stock' }); }
async function postRequest(q, s) { return s.status(201).json({ success: true, message: 'Purchase request created', data: await repo.createRequest(org(q), auth(q).userId, inventory_validator_1.purchaseRequestSchema.parse(q.body)) }); }
async function patchRequest(q, s) { const data = await repo.changeRequest(org(q), auth(q).userId, q.params.id, inventory_validator_1.purchaseStatusSchema.parse(q.body).status); return data ? s.json({ success: true, message: 'Purchase request updated', data }) : s.status(409).json({ success: false, message: 'Request cannot move to that status' }); }
