"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const regulatory_controller_1 = require("../controllers/regulatory.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => {
    try {
        await h(q, s);
    }
    catch (e) {
        n(e);
    }
};
r.get("/applicant/permits", (0, auth_middleware_1.requireRoles)("organization_applicant"), run(regulatory_controller_1.getApplicantPermits));
r.post("/applicant/permits", (0, auth_middleware_1.requireRoles)("organization_applicant"), run(regulatory_controller_1.postApplicantPermit));
r.get("/applicant/permits/:id/certificate", (0, auth_middleware_1.requireRoles)("organization_applicant"), run(regulatory_controller_1.downloadApplicantCertificate));
r.get("/platform-packages", (0, auth_middleware_1.requireRoles)("system_admin"), run(regulatory_controller_1.getAllPlatformPackages));
r.get("/organization-package", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor", "driver", "recycling_collector", "recycling_sales", "recycling_field_manager"), run(regulatory_controller_1.getOrganizationPackageAccess));
r.post("/platform-packages", (0, auth_middleware_1.requireRoles)("system_admin"), run(regulatory_controller_1.postPlatformPackage));
r.patch("/platform-packages/:id", (0, auth_middleware_1.requireRoles)("system_admin"), run(regulatory_controller_1.patchPlatformPackage));
r.get("/organization-certificate", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor"), run(regulatory_controller_1.getOrganizationCertificate));
r.get("/organization-certificate/pdf", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor"), run(regulatory_controller_1.downloadOrganizationCertificate));
r.get("/account-applications", (0, auth_middleware_1.requireRoles)("system_admin"), run(regulatory_controller_1.getAccountApplications));
r.patch("/account-applications/:id", (0, auth_middleware_1.requireRoles)("system_admin"), run(regulatory_controller_1.patchAccountApplication));
r.get("/divisions", (0, auth_middleware_1.requireRoles)("system_admin", "kcca_admin", "company_admin", "supervisor"), run(regulatory_controller_1.getDivisions));
r.get("/division-authorizations", (0, auth_middleware_1.requireRoles)("kcca_admin"), run(regulatory_controller_1.getDivisionAuthorizations));
r.get("/permit-applications", (0, auth_middleware_1.requireRoles)("system_admin", "kcca_admin"), run(regulatory_controller_1.getPermits));
r.patch("/permit-applications/:id", (0, auth_middleware_1.requireRoles)("kcca_admin"), run(regulatory_controller_1.patchPermit));
r.post("/division-authorizations", (0, auth_middleware_1.requireRoles)("kcca_admin"), run(regulatory_controller_1.postAuthorizations));
exports.default = r;
