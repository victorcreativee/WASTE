"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const job_problem_controller_1 = require("../controllers/job-problem.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
const run = (handler) => async (req, res, next) => {
    try {
        await handler(req, res);
    }
    catch (error) {
        next(error);
    }
};
router.get("/driver-job-problems", (0, auth_middleware_1.requireRoles)("driver", "company_admin", "supervisor", "kcca_admin", "system_admin"), run(job_problem_controller_1.getJobProblemsHandler));
router.post("/driver-jobs/:jobId/problems", (0, auth_middleware_1.requireRoles)("driver"), run(job_problem_controller_1.createJobProblemHandler));
router.patch("/driver-job-problems/:problemId", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor", "kcca_admin", "system_admin"), run(job_problem_controller_1.updateJobProblemHandler));
exports.default = router;
