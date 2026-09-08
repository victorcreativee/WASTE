"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const customer_service_controller_1 = require("../controllers/customer-service.controller");
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
router.get("/customer-service/me", (0, auth_middleware_1.requireRoles)("citizen"), run(customer_service_controller_1.getMyCustomerServiceHandler));
router.put("/customer-service/me", (0, auth_middleware_1.requireRoles)("citizen"), run(customer_service_controller_1.upsertMyCustomerServiceHandler));
router.get("/customers", (0, auth_middleware_1.requireRoles)("company_admin", "supervisor", "kcca_admin", "system_admin"), run(customer_service_controller_1.getCustomersHandler));
router.patch("/customers/:customerId/status", (0, auth_middleware_1.requireRoles)("company_admin"), run(customer_service_controller_1.updateCustomerServiceStatusHandler));
exports.default = router;
