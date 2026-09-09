"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const regulatory_controller_1 = require("../controllers/regulatory.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)(), run = (handler) => async (req, res, next) => { try {
    await handler(req, res);
}
catch (error) {
    next(error);
} };
const applicantOnly = (0, auth_middleware_1.requireRoles)('organization_applicant');
router.post('/applicant/permit-information', applicantOnly, run(regulatory_controller_1.postApplicantInformation));
router.get('/applicant/account-applications', applicantOnly, run(regulatory_controller_1.getApplicantAccountApplications));
router.post('/applicant/account-applications', applicantOnly, run(regulatory_controller_1.postApplicantAccountApplication));
exports.default = router;
