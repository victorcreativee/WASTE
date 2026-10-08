"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCityCompliance = getCityCompliance;
exports.getOrganizationCompliance = getOrganizationCompliance;
exports.postCompliance = postCompliance;
exports.patchComplianceResponse = patchComplianceResponse;
exports.patchComplianceReview = patchComplianceReview;
const organization_scope_1 = require("../middlewares/organization-scope");
const compliance_repository_1 = require("../repositories/compliance.repository");
const compliance_validator_1 = require("../validators/compliance.validator");
const auth = (q) => q.auth;
async function getCityCompliance(q, s) { return s.json({ success: true, message: 'Compliance cases fetched', data: await (0, compliance_repository_1.complianceCases)(null) }); }
async function getOrganizationCompliance(q, s) { return s.json({ success: true, message: 'Organization compliance cases fetched', data: await (0, compliance_repository_1.complianceCases)((0, organization_scope_1.requireOrganizationScope)(q)) }); }
async function postCompliance(q, s) { return s.status(201).json({ success: true, message: 'Compliance notice issued', data: await (0, compliance_repository_1.createComplianceCase)(auth(q).userId, compliance_validator_1.createComplianceSchema.parse(q.body)) }); }
async function patchComplianceResponse(q, s) { const input = compliance_validator_1.respondComplianceSchema.parse(q.body); return s.json({ success: true, message: 'Remediation submitted to KCCA', data: await (0, compliance_repository_1.respondComplianceCase)(q.params.id, (0, organization_scope_1.requireOrganizationScope)(q), auth(q).userId, input.response) }); }
async function patchComplianceReview(q, s) { const input = compliance_validator_1.reviewComplianceSchema.parse(q.body); return s.json({ success: true, message: input.action === 'close' ? 'Compliance case closed' : 'Compliance case reopened', data: await (0, compliance_repository_1.reviewComplianceCase)(q.params.id, auth(q).userId, input.action, input.notes) }); }
