"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const billing_controller_1 = require("../controllers/billing.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
const run = (handler) => async (req, res, next) => { try {
    await handler(req, res);
}
catch (error) {
    next(error);
} };
const canView = (0, auth_middleware_1.requireRoles)("citizen", "company_admin", "supervisor", "kcca_admin", "system_admin");
router.get("/billing/plans", canView, run(billing_controller_1.getServicePlansHandler));
router.post("/billing/plans", (0, auth_middleware_1.requireRoles)("company_admin"), run(billing_controller_1.createServicePlanHandler));
router.put("/billing/plans/:planId", (0, auth_middleware_1.requireRoles)("company_admin"), run(billing_controller_1.updateServicePlanHandler));
router.patch("/billing/plans/:planId/status", (0, auth_middleware_1.requireRoles)("company_admin"), run(billing_controller_1.updateServicePlanStatusHandler));
router.post("/billing/subscriptions", (0, auth_middleware_1.requireRoles)("citizen"), run(billing_controller_1.subscribeServicePlanHandler));
router.get("/billing/overview", canView, run(billing_controller_1.getBillingOverviewHandler));
router.post("/billing/invoices/generate", (0, auth_middleware_1.requireRoles)("company_admin"), run(billing_controller_1.generateDueInvoicesHandler));
router.patch("/billing/subscriptions/:subscriptionId/status", (0, auth_middleware_1.requireRoles)("company_admin"), run(billing_controller_1.updateSubscriptionStatusHandler));
router.post("/billing/payments", (0, auth_middleware_1.requireRoles)("citizen"), run(billing_controller_1.initiatePaymentHandler));
router.post("/billing/payments/record", (0, auth_middleware_1.requireRoles)("company_admin"), run(billing_controller_1.recordOrganizationPaymentHandler));
router.patch("/billing/payments/:paymentId/confirm", (0, auth_middleware_1.requireRoles)("company_admin"), run(billing_controller_1.confirmPaymentHandler));
exports.default = router;
