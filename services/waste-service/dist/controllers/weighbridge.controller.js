"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeighbridge = getWeighbridge;
exports.postWeighbridge = postWeighbridge;
exports.patchWeighbridgeComplete = patchWeighbridgeComplete;
exports.getWeighbridgeVehicles = getWeighbridgeVehicles;
exports.patchWeighbridgeVoid = patchWeighbridgeVoid;
const zod_1 = require("zod");
const organization_scope_1 = require("../middlewares/organization-scope");
const weighbridge_validator_1 = require("../validators/weighbridge.validator");
const weighbridge_repository_1 = require("../repositories/weighbridge.repository");
const auth = (q) => q.auth;
async function getWeighbridge(q, s) { return s.json({ success: true, message: "Weighbridge records fetched", data: await (0, weighbridge_repository_1.findWeighbridgeTransactions)((0, organization_scope_1.operationalOrganizationScope)(q)) }); }
async function postWeighbridge(q, s) { const a = auth(q), data = await (0, weighbridge_repository_1.createWeighbridgeTransaction)(a.userId, weighbridge_validator_1.createWeighbridgeSchema.parse(q.body)); return s.status(201).json({ success: true, message: data.status === "open" ? "Gross weight saved; tare is pending" : "Weighbridge transaction completed", data }); }
async function patchWeighbridgeComplete(q, s) { const a = auth(q), record = (await (0, weighbridge_repository_1.findWeighbridgeTransactions)(null)).find(item => item.id === q.params.id); if (!record)
    return s.status(404).json({ success: false, message: "Weighbridge transaction not found" }); const data = await (0, weighbridge_repository_1.completeWeighbridgeTransaction)(q.params.id, record.organization_id, a.userId, weighbridge_validator_1.completeWeighbridgeSchema.parse(q.body)); return s.json({ success: true, message: "Tare recorded and transaction completed", data }); }
async function getWeighbridgeVehicles(q, s) { const organizationId = zod_1.z.string().uuid("Choose a responsible company").parse(q.query.organizationId); return s.json({ success: true, message: "Company vehicles fetched", data: await (0, weighbridge_repository_1.findWeighbridgeVehicles)(organizationId) }); }
async function patchWeighbridgeVoid(q, s) { const a = auth(q), input = weighbridge_validator_1.voidWeighbridgeSchema.parse(q.body), data = await (0, weighbridge_repository_1.voidWeighbridgeTransaction)(q.params.id, a.userId, input.reason); return s.json({ success: true, message: "Ticket voided; linked official tonnage was removed", data }); }
