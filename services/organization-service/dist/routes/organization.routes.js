"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const organization_controller_1 = require("../controllers/organization.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
const canReadOrganizations = (0, auth_middleware_1.requireRoles)("system_admin", "kcca_admin", "company_admin", "supervisor", "weighbridge_operator");
const canCreateOrganizations = (0, auth_middleware_1.requireRoles)("system_admin");
router.get("/", canReadOrganizations, async (req, res, next) => {
    try {
        await (0, organization_controller_1.getOrganizations)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.get("/:id", canReadOrganizations, async (req, res, next) => {
    try {
        await (0, organization_controller_1.getOrganizationById)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.post("/", canCreateOrganizations, async (req, res, next) => {
    try {
        await (0, organization_controller_1.createOrganizationHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
