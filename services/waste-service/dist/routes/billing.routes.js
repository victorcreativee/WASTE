"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const billing_controller_1 = require("../controllers/billing.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const organization_permission_middleware_1 = require("../middlewares/organization-permission.middleware");
const router = (0, express_1.Router)();
const run = (handler) => async (req, res, next) => { try {
    await handler(req, res);
}
catch (error) {
    next(error);
} };
const permission = (code) => (0, organization_permission_middleware_1.requireOrganizationPermission)(code);
const canView = (0, organization_permission_middleware_1.requireRoleOrOrganizationPermission)(["citizen"], "billing.read");
router.get("/billing/plans", canView, run(billing_controller_1.getServicePlansHandler));
router.post("/billing/plans", permission("billing.plan.manage"), run(billing_controller_1.createServicePlanHandler));
router.put("/billing/plans/:planId", permission("billing.plan.manage"), run(billing_controller_1.updateServicePlanHandler));
router.patch("/billing/plans/:planId/status", permission("billing.plan.manage"), run(billing_controller_1.updateServicePlanStatusHandler));
router.post("/billing/subscriptions", (0, auth_middleware_1.requireRoles)("citizen"), run(billing_controller_1.subscribeServicePlanHandler));
router.get("/billing/overview", canView, run(billing_controller_1.getBillingOverviewHandler));
router.get("/billing/payments/:paymentId/receipt", canView, run(billing_controller_1.getPaymentReceiptHandler));
router.post("/billing/invoices/generate", permission("billing.invoice.generate"), run(billing_controller_1.generateDueInvoicesHandler));
router.patch("/billing/subscriptions/:subscriptionId/status", permission("billing.subscription.manage"), run(billing_controller_1.updateSubscriptionStatusHandler));
router.post("/billing/payments", (0, auth_middleware_1.requireRoles)("citizen"), run(billing_controller_1.initiatePaymentHandler));
router.post("/billing/payments/record", permission("billing.payment.record"), run(billing_controller_1.recordOrganizationPaymentHandler));
router.patch("/billing/payments/:paymentId/confirm", permission("billing.payment.confirm"), run(billing_controller_1.confirmPaymentHandler));
exports.default = router;
