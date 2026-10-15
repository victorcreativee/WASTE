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
export default r;
