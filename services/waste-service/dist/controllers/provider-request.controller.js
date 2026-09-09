"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProviderOptions = getProviderOptions;
exports.getMyProviderRequests = getMyProviderRequests;
exports.postProviderRequest = postProviderRequest;
exports.deleteProviderRequest = deleteProviderRequest;
exports.getOrganizationProviderRequests = getOrganizationProviderRequests;
exports.patchProviderRequest = patchProviderRequest;
const provider_request_validator_1 = require("../validators/provider-request.validator");
const provider_request_repository_1 = require("../repositories/provider-request.repository");
const auth = (req) => req.auth;
async function getProviderOptions(req, res) { return res.json({ success: true, message: 'Covered providers fetched', data: await (0, provider_request_repository_1.providerOptions)(auth(req).userId) }); }
async function getMyProviderRequests(req, res) { return res.json({ success: true, message: 'Provider requests fetched', data: await (0, provider_request_repository_1.customerProviderRequests)(auth(req).userId) }); }
async function postProviderRequest(req, res) { const input = provider_request_validator_1.createProviderRequestSchema.parse(req.body); const data = await (0, provider_request_repository_1.createProviderRequest)(auth(req).userId, input.organizationId, input.note); return res.status(201).json({ success: true, message: 'Provider request submitted for review', data }); }
async function deleteProviderRequest(req, res) { const data = await (0, provider_request_repository_1.cancelProviderRequest)(auth(req).userId, req.params.id); if (!data)
    return res.status(404).json({ success: false, message: 'Open provider request not found' }); return res.json({ success: true, message: 'Provider request cancelled', data }); }
async function getOrganizationProviderRequests(req, res) { const org = auth(req).organizationId; return res.json({ success: true, message: 'Provider review queue fetched', data: await (0, provider_request_repository_1.organizationProviderRequests)(org) }); }
async function patchProviderRequest(req, res) { const identity = auth(req), input = provider_request_validator_1.reviewProviderRequestSchema.parse(req.body); const data = await (0, provider_request_repository_1.reviewProviderRequest)(identity.userId, identity.organizationId, req.params.id, input); if (!data)
    return res.status(404).json({ success: false, message: 'This request is not awaiting your organization’s review' }); return res.json({ success: true, message: input.action === 'reject' ? 'Provider request rejected' : data.status === 'pending_new_provider' ? 'Release approved; awaiting the new provider' : 'Provider relationship approved', data }); }
