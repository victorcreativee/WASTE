"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const waste_controller_1 = require("../controllers/waste.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
const canUseDriverOperations = (0, auth_middleware_1.requireRoles)("system_admin", "kcca_admin", "company_admin", "supervisor", "driver");
router.get("/drivers/:driverId/jobs", canUseDriverOperations, run(waste_controller_1.getDriverJobsHandler));
router.get("/driver/jobs", canUseDriverOperations, run(waste_controller_1.getDriverJobsHandler));
router.patch("/driver-jobs/:jobId/start", canUseDriverOperations, run(waste_controller_1.startDriverJobHandler));
router.patch("/driver-jobs/:jobId/complete", canUseDriverOperations, run(waste_controller_1.completeDriverJobHandler));
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
