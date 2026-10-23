import { requireOrganizationPermission } from "../middlewares/organization-permission.middleware";
import { NextFunction, Request, Response, Router } from "express";
import {
  createOrganizationUserHandler,
  getOrganizationUsersHandler,
  updateOrganizationUserStatusHandler,
  assignSupervisorDriversHandler,
  createOrganizationCustomerHandler,
} from "../controllers/organization-user.controller";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../middlewares/auth.middleware";
import { getAttendance,putAttendance } from "../controllers/attendance.controller";
import { createHouseholdLink } from "../services/household.service";
import {getPayroll,patchPeriod,postPeriod,putLine} from "../controllers/payroll.controller";

const router = Router();
const run = (handler: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { await handler(req as AuthenticatedRequest, res); } catch (error) { next(error); }
  };

router.use(
  requireAuth,
  requireRoles(
    "company_admin",
    "supervisor",
    "driver",
    "iot_operator",
    "recycling_collector",
    "recycling_sales",
    "recycling_field_manager",
  ),
);
router.get("/organization-users", requireOrganizationPermission("staff.read"),run(getOrganizationUsersHandler));
router.post("/organization-users", requireOrganizationPermission("staff.manage"),run(createOrganizationUserHandler));
router.post("/organization-customers", requireRoles("company_admin"),requireOrganizationPermission("customer.manage"),run(createOrganizationCustomerHandler));
// Creates (or replaces) a household's private sign-in link. The secret is returned once for staff to share.
router.post("/organization-customers/:customerId/access-link", requireOrganizationPermission("customer.manage"), run(async (req: Request, res: Response) => {
  const auth = (req as AuthenticatedRequest).user!;
  if (!auth.organizationId) return res.status(403).json({ success: false, message: "An organization account is required" });
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.customerId))) return res.status(404).json({ success: false, message: "Household not found" });
  try {
    const link = await createHouseholdLink(auth.organizationId, String(req.params.customerId), auth.userId);
    return res.status(201).json({ success: true, message: "Household link created", data: link });
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (!statusCode) throw error;
    return res.status(statusCode).json({ success: false, message: (error as Error).message });
  }
}));
router.patch("/organization-users/:userId/status", requireOrganizationPermission("staff.manage"),run(updateOrganizationUserStatusHandler));
router.put("/organization-users/supervisors/:supervisorUserId/drivers", requireOrganizationPermission("staff.manage"),run(assignSupervisorDriversHandler));
router.get("/organization-attendance",requireOrganizationPermission("attendance.read"),run(getAttendance));
router.put("/organization-attendance",requireOrganizationPermission("attendance.manage"),run(putAttendance));
router.get("/organization-payroll",requireRoles("company_admin"),requireOrganizationPermission("payroll.read"),run(getPayroll));
router.post("/organization-payroll/periods",requireRoles("company_admin"),requireOrganizationPermission("payroll.manage"),run(postPeriod));
router.put("/organization-payroll/periods/:periodId/lines",requireRoles("company_admin"),requireOrganizationPermission("payroll.manage"),run(putLine));
router.patch("/organization-payroll/periods/:periodId/status",requireRoles("company_admin"),requireOrganizationPermission("payroll.manage"),run(patchPeriod));

export default router;
