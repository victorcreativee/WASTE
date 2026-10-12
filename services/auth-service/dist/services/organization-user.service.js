"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listOrganizationUsers = listOrganizationUsers;
exports.createOrganizationUser = createOrganizationUser;
exports.createOrganizationCustomer = createOrganizationCustomer;
exports.changeOrganizationUserStatus = changeOrganizationUserStatus;
exports.assignDriversToSupervisor = assignDriversToSupervisor;
const bcrypt_1 = __importDefault(require("bcrypt"));
const database_1 = require("../config/database");
const staff_authorization_1 = require("../repositories/staff-authorization");
const organization_user_repository_1 = require("../repositories/organization-user.repository");
async function listOrganizationUsers(organizationId) {
    return (0, organization_user_repository_1.findOrganizationUsers)(organizationId);
}
async function createOrganizationUser(organizationId, input, actorId) {
    const passwordHash = await bcrypt_1.default.hash(input.password, 12);
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        const actor = await (0, staff_authorization_1.authorizeStaffWrite)(client, organizationId, actorId);
        if (!actor.isAdministrator)
            (0, staff_authorization_1.protectedStaff)("Only the company administrator can create staff accounts");
        const allowedRoles = actor.organizationType === 'recycling_company' ? ["recycling_collector", "recycling_sales"] : ["supervisor", "driver"];
        if (!allowedRoles.includes(input.role))
            (0, staff_authorization_1.protectedStaff)(actor.organizationType === 'recycling_company' ? "Choose a recycling collection worker or industrial sales worker role" : "Choose a supervisor or driver role");
        const result = await (0, organization_user_repository_1.createOrganizationStaffRecord)(client, {
            organizationId,
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            passwordHash,
            role: input.role,
            licenseNumber: input.licenseNumber,
        });
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505") {
            const conflict = new Error("This email address is already registered");
            conflict.statusCode = 409;
            throw conflict;
        }
        throw error;
    }
    finally {
        client.release();
    }
}
async function createOrganizationCustomer(organizationId, input, actorId) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('wms.actor_id',$1,true)", [actorId]);
        const result = await (0, organization_user_repository_1.createOrganizationCustomerRecord)(client, {
            organizationId, ...input, passwordHash: await bcrypt_1.default.hash(input.password, 12),
        });
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505") {
            const conflict = new Error("This email address is already registered");
            conflict.statusCode = 409;
            throw conflict;
        }
        throw error;
    }
    finally {
        client.release();
    }
}
async function changeOrganizationUserStatus(userId, organizationId, status, actorId) {
    return (0, organization_user_repository_1.updateOrganizationUserStatus)(userId, organizationId, status, actorId);
}
async function assignDriversToSupervisor(supervisorUserId, driverIds, organizationId, actorId) {
    return (0, organization_user_repository_1.replaceSupervisorDrivers)(supervisorUserId, driverIds, organizationId, actorId);
}
