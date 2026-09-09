"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomerStops = getCustomerStops;
exports.postCustomerStops = postCustomerStops;
exports.patchCustomerStop = patchCustomerStop;
exports.patchCustomerStopException = patchCustomerStopException;
const customer_stop_repository_1 = require("../repositories/customer-stop.repository");
const customer_stop_validator_1 = require("../validators/customer-stop.validator");
const auth = (req) => req.auth;
async function getCustomerStops(req, res) { const a = auth(req), citizen = a.roles.includes('citizen'); return res.json({ success: true, message: 'Customer collection stops fetched', data: await (0, customer_stop_repository_1.findCustomerStops)(citizen ? null : a.organizationId, citizen ? a.userId : null, req.query.jobId) }); }
async function postCustomerStops(req, res) { const a = auth(req), data = await (0, customer_stop_repository_1.generateCustomerStops)(req.params.jobId, a.organizationId); if (!data)
    return res.status(404).json({ success: false, message: 'A pending or assigned collection job was not found in your organization' }); return res.status(201).json({ success: true, message: data.created ? `${data.created} customer stops created` : 'No new eligible customer stops found', data }); }
async function patchCustomerStop(req, res) { const data = await (0, customer_stop_repository_1.updateCustomerStop)(req.params.id, auth(req).userId, customer_stop_validator_1.customerStopActionSchema.parse(req.body)); if (!data)
    return res.status(404).json({ success: false, message: 'Household stop is not assigned to this driver' }); return res.json({ success: true, message: `Household stop ${data.status}`, data }); }
async function patchCustomerStopException(req, res) { const a = auth(req), data = await (0, customer_stop_repository_1.reviewCustomerStopException)(req.params.id, a.organizationId, a.userId, customer_stop_validator_1.customerStopExceptionReviewSchema.parse(req.body)); if (!data)
    return res.status(404).json({ success: false, message: 'A pending collection exception was not found in your organization' }); return res.json({ success: true, message: data.replacement ? 'Pickup rescheduled' : 'Collection exception resolved', data }); }
