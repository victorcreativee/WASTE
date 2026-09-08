"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrganizations = getOrganizations;
exports.getOrganizationById = getOrganizationById;
exports.createOrganizationHandler = createOrganizationHandler;
const organization_validator_1 = require("../validators/organization.validator");
const organization_service_1 = require("../services/organization.service");
function organizationScope(req) {
    const auth = req.auth;
    return auth?.roles.some((role) => ["company_admin", "supervisor"].includes(role))
        ? auth.organizationId
        : null;
}
async function getOrganizations(req, res) {
    try {
        const organizations = await (0, organization_service_1.listOrganizations)(organizationScope(req));
        return res.status(200).json({
            success: true,
            message: "Organizations fetched successfully",
            data: organizations,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: error instanceof Error
                ? error.message
                : "Failed to fetch organizations",
        });
    }
}
async function getOrganizationById(req, res) {
    try {
        const { id } = req.params;
        if (!id || Array.isArray(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid organization id",
            });
        }
        const organization = await (0, organization_service_1.getOrganization)(id, organizationScope(req));
        return res.status(200).json({
            success: true,
            message: "Organization fetched successfully",
            data: organization,
        });
    }
    catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : "Failed to fetch organization",
        });
    }
}
async function createOrganizationHandler(req, res) {
    try {
        const input = organization_validator_1.createOrganizationSchema.parse(req.body);
        const organization = await (0, organization_service_1.addOrganization)(input);
        return res.status(201).json({
            success: true,
            message: "Organization created successfully",
            data: organization,
        });
    }
    catch (error) {
        return res.status(400).json({
            success: false,
            message: error instanceof Error
                ? error.message
                : "Failed to create organization",
        });
    }
}
