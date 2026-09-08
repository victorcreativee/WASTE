"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignSupervisorDriversHandler = assignSupervisorDriversHandler;
exports.getOrganizationUsersHandler = getOrganizationUsersHandler;
exports.createOrganizationUserHandler = createOrganizationUserHandler;
exports.createOrganizationCustomerHandler = createOrganizationCustomerHandler;
exports.updateOrganizationUserStatusHandler = updateOrganizationUserStatusHandler;
const organization_user_service_1 = require("../services/organization-user.service");
const auth_validator_1 = require("../validators/auth.validator");
function organizationId(req) {
    const id = req.user?.organizationId;
    if (!id) {
        const error = new Error("Your account is not linked to an organization");
        error.statusCode = 403;
        throw error;
    }
    return id;
}
async function assignSupervisorDriversHandler(req, res) {
    const input = auth_validator_1.assignSupervisorDriversSchema.parse(req.body);
    const assignment = await (0, organization_user_service_1.assignDriversToSupervisor)(req.params.supervisorUserId, input.driverIds, organizationId(req), req.user.userId);
    if (!assignment)
        return res.status(400).json({ success: false, message: "Select a valid active supervisor and drivers from your organization" });
    return res.status(200).json({ success: true, message: "Supervisor team updated", data: assignment });
}
async function getOrganizationUsersHandler(req, res) {
    const users = await (0, organization_user_service_1.listOrganizationUsers)(organizationId(req));
    return res.status(200).json({ success: true, message: "Organization staff fetched", data: users });
}
async function createOrganizationUserHandler(req, res) {
    const user = await (0, organization_user_service_1.createOrganizationUser)(organizationId(req), auth_validator_1.createOrganizationUserSchema.parse(req.body), req.user.userId);
    return res.status(201).json({ success: true, message: "Staff account created", data: user });
}
async function createOrganizationCustomerHandler(req, res) {
    const customer = await (0, organization_user_service_1.createOrganizationCustomer)(organizationId(req), auth_validator_1.createOrganizationCustomerSchema.parse(req.body), req.user.userId);
    return res.status(201).json({ success: true, message: "Customer account and service location created", data: customer });
}
async function updateOrganizationUserStatusHandler(req, res) {
    const input = auth_validator_1.updateOrganizationUserStatusSchema.parse(req.body);
    const user = await (0, organization_user_service_1.changeOrganizationUserStatus)(req.params.userId, organizationId(req), input.status, req.user.userId);
    if (!user)
        return res.status(404).json({ success: false, message: "Staff account not found or cannot be changed" });
    return res.status(200).json({ success: true, message: "Staff status updated", data: user });
}
