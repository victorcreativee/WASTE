"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const citizen_issue_controller_1 = require("../controllers/citizen-issue.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
const canView = (0, auth_middleware_1.requireRoles)("system_admin", "kcca_admin", "company_admin", "supervisor", "citizen");
router.get("/citizen-issues", canView, run(citizen_issue_controller_1.getCitizenIssues));
router.post("/citizen-issues", (0, auth_middleware_1.requireRoles)("citizen"), run(citizen_issue_controller_1.createCitizenIssueHandler));
router.patch("/citizen-issues/:id/assign", (0, auth_middleware_1.requireRoles)("system_admin", "kcca_admin"), run(citizen_issue_controller_1.assignCitizenIssueHandler));
router.patch("/citizen-issues/:id/status", (0, auth_middleware_1.requireRoles)("system_admin", "kcca_admin", "company_admin", "supervisor"), run(citizen_issue_controller_1.updateCitizenIssueStatusHandler));
function run(handler) {
    return async (req, res, next) => {
        try {
            await handler(req, res);
        }
        catch (error) {
            next(error);
        }
    };
}
exports.default = router;
