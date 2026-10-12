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
exports.getContracts = getContracts;
exports.postContract = postContract;
exports.patchContract = patchContract;
const organization_scope_1 = require("../middlewares/organization-scope");
const repo = __importStar(require("../repositories/contract.repository"));
const contract_validator_1 = require("../validators/contract.validator");
const auth = (q) => q.auth;
const scope = organization_scope_1.requireOrganizationScope;
const org = (q) => { const id = auth(q).organizationId; if (!id) {
    const e = new Error('Account is not linked to an organization');
    e.statusCode = 403;
    throw e;
} return id; };
async function getContracts(q, s) { return s.json({ success: true, message: 'Contracts fetched', data: await repo.findContracts(scope(q)) }); }
async function postContract(q, s) { const data = await repo.createContract(org(q), auth(q).userId, contract_validator_1.contractSchema.parse(q.body)); return data ? s.status(201).json({ success: true, message: 'Contract created', data }) : s.status(409).json({ success: false, message: 'The customer or package is unavailable, or another contract overlaps these dates' }); }
async function patchContract(q, s) { const data = await repo.changeContract(org(q), q.params.id, contract_validator_1.contractStatusSchema.parse(q.body).status, auth(q).userId); return data ? s.json({ success: true, message: 'Contract updated', data }) : s.status(409).json({ success: false, message: 'Contract cannot move to that status' }); }
