"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertMyCustomerServiceHandler = upsertMyCustomerServiceHandler;
exports.getMyCustomerServiceHandler = getMyCustomerServiceHandler;
exports.getCustomersHandler = getCustomersHandler;
exports.updateCustomerServiceStatusHandler = updateCustomerServiceStatusHandler;
const organization_scope_1 = require("../middlewares/organization-scope");
const customer_service_repository_1 = require("../repositories/customer-service.repository");
const customer_service_validator_1 = require("../validators/customer-service.validator");
function identity(req) { return req.auth; }
async function upsertMyCustomerServiceHandler(req, res) {
    const result = await (0, customer_service_repository_1.upsertCustomerService)(identity(req).userId, customer_service_validator_1.upsertCustomerServiceSchema.parse(req.body));
    return res.status(200).json({ success: true, message: "Customer service location saved", data: result });
}
async function getMyCustomerServiceHandler(req, res) {
    const overview = await (0, customer_service_repository_1.findCustomerServiceOverview)(identity(req).userId);
    return res.status(200).json({ success: true, message: "Customer service overview fetched", data: overview });
}
async function getCustomersHandler(req, res) {
    const organizationId = (0, organization_scope_1.requireOrganizationScope)(req);
    const customers = await (0, customer_service_repository_1.findCustomers)(organizationId);
    return res.status(200).json({ success: true, message: "Customers fetched", data: customers });
}
async function updateCustomerServiceStatusHandler(req, res) {
    const auth = identity(req);
    if (!auth.organizationId)
        return res.status(403).json({ success: false, message: "Your account is not linked to an organization" });
    const input = customer_service_validator_1.updateCustomerServiceStatusSchema.parse(req.body);
    const customer = await (0, customer_service_repository_1.updateCustomerServiceStatus)(req.params.customerId, auth.organizationId, input.status, auth.userId);
    if (!customer)
        return res.status(404).json({ success: false, message: "Customer was not found in your organization" });
    return res.status(200).json({ success: true, message: `Customer service ${input.status}`, data: customer });
}
