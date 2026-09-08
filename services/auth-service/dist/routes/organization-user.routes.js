"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const organization_permission_middleware_1 = require("../middlewares/organization-permission.middleware");
const express_1 = require("express");
const organization_user_controller_1 = require("../controllers/organization-user.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const attendance_controller_1 = require("../controllers/attendance.controller");
const payroll_controller_1 = require("../controllers/payroll.controller");
const router = (0, express_1.Router)();
const run = (handler) => async (req, res, next) => {
    try {
        await handler(req, res);
    }
    catch (error) {
        next(error);
    }
};
router.use(auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRoles)("company_admin", "supervisor", "driver", "iot_operator"));
router.get("/organization-users", (0, organization_permission_middleware_1.requireOrganizationPermission)("staff.read"), run(organization_user_controller_1.getOrganizationUsersHandler));
router.post("/organization-users", (0, organization_permission_middleware_1.requireOrganizationPermission)("staff.manage"), run(organization_user_controller_1.createOrganizationUserHandler));
router.post("/organization-customers", (0, auth_middleware_1.requireRoles)("company_admin"), (0, organization_permission_middleware_1.requireOrganizationPermission)("customer.manage"), run(organization_user_controller_1.createOrganizationCustomerHandler));
router.patch("/organization-users/:userId/status", (0, organization_permission_middleware_1.requireOrganizationPermission)("staff.manage"), run(organization_user_controller_1.updateOrganizationUserStatusHandler));
router.put("/organization-users/supervisors/:supervisorUserId/drivers", (0, organization_permission_middleware_1.requireOrganizationPermission)("staff.manage"), run(organization_user_controller_1.assignSupervisorDriversHandler));
router.get("/organization-attendance", (0, organization_permission_middleware_1.requireOrganizationPermission)("attendance.read"), run(attendance_controller_1.getAttendance));
router.put("/organization-attendance", (0, organization_permission_middleware_1.requireOrganizationPermission)("attendance.manage"), run(attendance_controller_1.putAttendance));
router.get("/organization-payroll", (0, auth_middleware_1.requireRoles)("company_admin"), (0, organization_permission_middleware_1.requireOrganizationPermission)("payroll.read"), run(payroll_controller_1.getPayroll));
router.post("/organization-payroll/periods", (0, auth_middleware_1.requireRoles)("company_admin"), (0, organization_permission_middleware_1.requireOrganizationPermission)("payroll.manage"), run(payroll_controller_1.postPeriod));
router.put("/organization-payroll/periods/:periodId/lines", (0, auth_middleware_1.requireRoles)("company_admin"), (0, organization_permission_middleware_1.requireOrganizationPermission)("payroll.manage"), run(payroll_controller_1.putLine));
router.patch("/organization-payroll/periods/:periodId/status", (0, auth_middleware_1.requireRoles)("company_admin"), (0, organization_permission_middleware_1.requireOrganizationPermission)("payroll.manage"), run(payroll_controller_1.patchPeriod));
exports.default = router;
