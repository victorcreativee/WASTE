"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listOrganizations = listOrganizations;
exports.getOrganization = getOrganization;
exports.addOrganization = addOrganization;
const organization_repository_1 = require("../repositories/organization.repository");
async function listOrganizations(organizationId) {
    return (0, organization_repository_1.findOrganizations)(organizationId);
}
async function getOrganization(id, organizationId) {
    const organization = await (0, organization_repository_1.findOrganizationById)(id, organizationId);
    if (!organization) {
        const error = new Error("Organization not found");
        error.statusCode = 404;
        throw error;
    }
    return organization;
}
async function addOrganization(input) {
    return (0, organization_repository_1.createOrganization)(input);
}
