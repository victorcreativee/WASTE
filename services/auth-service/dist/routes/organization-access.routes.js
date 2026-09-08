"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const organization_permission_middleware_1 = require("../middlewares/organization-permission.middleware");
const organization_access_repository_1 = require("../repositories/organization-access.repository");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
const query = zod_1.z.object({ page: zod_1.z.coerce.number().int().min(1).max(100000).default(1), pageSize: zod_1.z.coerce.number().int().min(1).max(50).default(10), search: zod_1.z.string().trim().max(150).default("") });
const run = (fn) => async (req, res, next) => { try {
    await fn(req, res);
}
catch (e) {
    next(e);
} };
router.use("/organization-access", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRoles)("company_admin", "supervisor", "driver", "iot_operator"));
router.get("/organization-access/me", run(async (req, res) => {
    const result = await database_1.dbPool.query("SELECT code FROM organization_effective_permissions($1::uuid,$2::uuid)", [req.user.userId, req.user.organizationId]);
    const admin = await database_1.dbPool.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1::uuid AND r.name='company_admin'", [req.user.userId]);
    res.json({ success: true, data: { permissions: result.rows.map(r => r.code), currentUserId: req.user.userId, isAdministrator: !!admin.rowCount } });
}));
router.get("/organization-access", (0, organization_permission_middleware_1.requireOrganizationPermission)("access.read"), run(async (req, res) => {
    res.json({ success: true, data: await (0, organization_access_repository_1.accessOverview)(req.user.organizationId, req.user.userId) });
}));
router.get("/organization-access/memberships", (0, organization_permission_middleware_1.requireOrganizationPermission)("access.read"), run(async (req, res) => {
    const q = query.parse(req.query);
    res.json({ success: true, data: await (0, organization_access_repository_1.listMemberships)(req.user.organizationId, q.page, q.pageSize, q.search) });
}));
router.get("/organization-access/audit", (0, organization_permission_middleware_1.requireOrganizationPermission)("audit.read"), run(async (req, res) => {
    const q = query.parse(req.query);
    res.json({ success: true, data: await (0, organization_access_repository_1.listAccessAudit)(req.user.organizationId, q.page, q.pageSize) });
}));
router.patch("/organization-access/memberships/:membershipId/status", (0, auth_middleware_1.requireRoles)("company_admin"), (0, organization_permission_middleware_1.requireOrganizationPermission)("access.manage"), run(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.membershipId), { status } = zod_1.z.object({ status: zod_1.z.enum(["active", "suspended", "inactive"]) }).parse(req.body);
    const data = await (0, organization_access_repository_1.changeMembershipStatus)(req.user.organizationId, req.user.userId, id, status);
    if (!data)
        return res.status(404).json({ success: false, message: "Membership was not found in your organization" });
    return res.json({ success: true, message: status === "active" ? "Membership restored. The user account must also be active." : "Membership access stopped.", data });
}));
const reviewRole = zod_1.z.object({ name: zod_1.z.string().trim().min(2).max(80), permissions: zod_1.z.array(zod_1.z.enum(["access.read", "audit.read", "staff.read", "staff.manage", "attendance.read", "attendance.manage"])).min(1).max(6).refine(p => p.includes("access.read") && new Set(p).size === p.length, "Select access.read and unique supported permissions") }).strict();
router.post("/organization-access/roles", (0, auth_middleware_1.requireRoles)("company_admin"), (0, organization_permission_middleware_1.requireOrganizationPermission)("access.manage"), run(async (req, res) => {
    const body = reviewRole.parse(req.body);
    res.status(201).json({ success: true, message: "Custom role created. Assign it to staff from Memberships.", data: await (0, organization_access_repository_1.saveReviewRole)(req.user.organizationId, req.user.userId, null, body.name, body.permissions) });
}));
router.put("/organization-access/roles/:roleId", (0, auth_middleware_1.requireRoles)("company_admin"), (0, organization_permission_middleware_1.requireOrganizationPermission)("access.manage"), run(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.roleId);
    const body = reviewRole.extend({ expected: reviewRole }).parse(req.body);
    res.json({ success: true, message: "Role updated. Changes apply to all assigned members on their next request.", data: await (0, organization_access_repository_1.saveReviewRole)(req.user.organizationId, req.user.userId, id, body.name, body.permissions, body.expected) });
}));
router.put("/organization-access/memberships/:membershipId/roles/:roleId", (0, auth_middleware_1.requireRoles)("company_admin"), (0, organization_permission_middleware_1.requireOrganizationPermission)("access.manage"), run(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.membershipId), roleId = zod_1.z.string().uuid().parse(req.params.roleId);
    const { assigned } = zod_1.z.object({ assigned: zod_1.z.boolean() }).strict().parse(req.body);
    res.json({ success: true, message: assigned ? "Custom role assigned. Only its selected permissions were granted." : "Custom role removed. Other role assignments remain unchanged.", data: await (0, organization_access_repository_1.assignReviewRole)(req.user.organizationId, req.user.userId, id, roleId, assigned) });
}));
exports.default = router;
