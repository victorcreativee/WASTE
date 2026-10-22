import { NextFunction, Request, Response, Router } from "express";
import {
  downloadApplicantCertificate,
  downloadOrganizationCertificate,
  getAccountApplications,
  getAllPlatformPackages,
  getOrganizationPackageAccess,
  getApplicantPermits,
  getDivisionAuthorizations,
  getDivisions,
  getOrganizationCertificate,
  getPermits,
  patchAccountApplication,
  patchPermit,
  patchPlatformPackage,
  postPlatformPackage,
  postApplicantPermit,
  postAuthorizations,
} from "../controllers/regulatory.controller";
import {
  getActivityTypes,
  getLifecycleOverview,
  getOrganizationPermit,
  getPermitHistory,
  getRenewalEvidence,
  getRenewalRequests,
  patchRenewalRequest,
  patchWithdrawRenewal,
  postAcknowledgeNotice,
  postLifecycleRun,
  postOrganizationPermit,
  postRenewalRequest,
} from "../controllers/permit-lifecycle.controller";
import {
  getOrganizationReturn,
  getOrganizationReturns,
  getPortal,
  getRegister,
  getRegisterCsv,
  getRegisterReturn,
  getReturnPrefill,
  patchRegisterReturn,
  postReturn,
  putReturn,
} from "../controllers/regulatory-returns.controller";
import { requireRoles } from "../middlewares/auth.middleware";
const r = Router(),
  run =
    (h: (q: Request, s: Response) => Promise<unknown>) =>
    async (q: Request, s: Response, n: NextFunction) => {
      try {
        await h(q, s);
      } catch (e) {
        n(e);
      }
    };
r.get(
  "/applicant/permits",
  requireRoles("organization_applicant"),
  run(getApplicantPermits),
);
r.post(
  "/applicant/permits",
  requireRoles("organization_applicant"),
  run(postApplicantPermit),
);
r.get(
  "/applicant/permits/:id/certificate",
  requireRoles("organization_applicant"),
  run(downloadApplicantCertificate),
);
r.get(
  "/platform-packages",
  requireRoles("system_admin"),
  run(getAllPlatformPackages),
);
r.get(
  "/organization-package",
  requireRoles(
    "company_admin",
    "supervisor",
    "driver",
    "recycling_collector",
    "recycling_sales",
    "recycling_field_manager",
  ),
  run(getOrganizationPackageAccess),
);
r.post(
  "/platform-packages",
  requireRoles("system_admin"),
  run(postPlatformPackage),
);
r.patch(
  "/platform-packages/:id",
  requireRoles("system_admin"),
  run(patchPlatformPackage),
);
r.get(
  "/organization-certificate",
  requireRoles("company_admin", "supervisor"),
  run(getOrganizationCertificate),
);
r.get(
  "/organization-certificate/pdf",
  requireRoles("company_admin", "supervisor"),
  run(downloadOrganizationCertificate),
);
r.get(
  "/account-applications",
  requireRoles("system_admin"),
  run(getAccountApplications),
);
r.patch(
  "/account-applications/:id",
  requireRoles("system_admin"),
  run(patchAccountApplication),
);
r.get(
  "/divisions",
  requireRoles("system_admin", "kcca_admin", "company_admin", "supervisor"),
  run(getDivisions),
);
r.get(
  "/division-authorizations",
  requireRoles("kcca_admin"),
  run(getDivisionAuthorizations),
);
r.get(
  "/permit-applications",
  requireRoles("system_admin", "kcca_admin"),
  run(getPermits),
);
r.patch(
  "/permit-applications/:id",
  requireRoles("kcca_admin"),
  run(patchPermit),
);
r.post(
  "/division-authorizations",
  requireRoles("kcca_admin"),
  run(postAuthorizations),
);
// Permit lifecycle (Module 1)
const kcca = requireRoles("kcca_admin", "system_admin");
const licensedCompany = requireRoles("company_admin", "supervisor");
r.get("/permit-activity-types", requireRoles("kcca_admin", "system_admin", "company_admin", "supervisor"), run(getActivityTypes));
r.get("/permit-applications/:id/history", kcca, run(getPermitHistory));
r.get("/permit-lifecycle/overview", kcca, run(getLifecycleOverview));
r.post("/permit-lifecycle/run", requireRoles("kcca_admin"), run(postLifecycleRun));
r.get("/permit-renewals", kcca, run(getRenewalRequests));
r.get("/permit-renewals/:id/evidence", kcca, run(getRenewalEvidence));
r.patch("/permit-renewals/:id", requireRoles("kcca_admin"), run(patchRenewalRequest));
r.post("/organizations/:id/permits", requireRoles("kcca_admin"), run(postOrganizationPermit));
r.get("/organization-permit", licensedCompany, run(getOrganizationPermit));
r.post("/organization-permit/renewals", requireRoles("company_admin"), run(postRenewalRequest));
r.patch("/organization-permit/renewals/:id/withdraw", requireRoles("company_admin"), run(patchWithdrawRenewal));
r.post("/organization-permit/notices/:id/acknowledge", licensedCompany, run(postAcknowledgeNotice));
// Company regulatory portal and statutory returns (Module 3) — available to every licensed company, whatever its package.
const companyStaff = requireRoles("company_admin", "supervisor");
r.get("/portal", companyStaff, run(getPortal));
r.get("/returns", companyStaff, run(getOrganizationReturns));
r.get("/returns/prefill", companyStaff, run(getReturnPrefill));
r.get("/returns/:id", companyStaff, run(getOrganizationReturn));
r.post("/returns", requireRoles("company_admin"), run(postReturn));
r.put("/returns/:id", requireRoles("company_admin"), run(putReturn));
r.get("/returns-register", kcca, run(getRegister));
r.get("/returns-register/export.csv", kcca, run(getRegisterCsv));
r.get("/returns-register/:id", kcca, run(getRegisterReturn));
r.patch("/returns-register/:id", requireRoles("kcca_admin"), run(patchRegisterReturn));
export default r;
