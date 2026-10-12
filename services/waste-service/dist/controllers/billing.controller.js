"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServicePlansHandler = getServicePlansHandler;
exports.createServicePlanHandler = createServicePlanHandler;
exports.updateServicePlanHandler = updateServicePlanHandler;
exports.updateServicePlanStatusHandler = updateServicePlanStatusHandler;
exports.subscribeServicePlanHandler = subscribeServicePlanHandler;
exports.getBillingOverviewHandler = getBillingOverviewHandler;
exports.getPaymentReceiptHandler = getPaymentReceiptHandler;
exports.generateDueInvoicesHandler = generateDueInvoicesHandler;
exports.updateSubscriptionStatusHandler = updateSubscriptionStatusHandler;
exports.initiatePaymentHandler = initiatePaymentHandler;
exports.confirmPaymentHandler = confirmPaymentHandler;
exports.recordOrganizationPaymentHandler = recordOrganizationPaymentHandler;
const organization_scope_1 = require("../middlewares/organization-scope");
const billing_service_1 = require("../services/billing.service");
const billing_validator_1 = require("../validators/billing.validator");
function auth(req) {
    return req.auth;
}
function organizationScope(req) {
    return auth(req).roles.includes("citizen")
        ? null
        : (0, organization_scope_1.requireOrganizationScope)(req);
}
function customerUser(req) {
    return auth(req).roles.includes("citizen") ? auth(req).userId : null;
}
async function getServicePlansHandler(req, res) {
    const plans = await (0, billing_service_1.findServicePlans)(organizationScope(req), customerUser(req));
    return res
        .status(200)
        .json({ success: true, message: "Service plans fetched", data: plans });
}
async function createServicePlanHandler(req, res) {
    const organizationId = auth(req).organizationId;
    if (!organizationId)
        return res.status(403).json({
            success: false,
            message: "Account is not linked to an organization",
        });
    const plan = await (0, billing_service_1.createServicePlan)(organizationId, billing_validator_1.createServicePlanSchema.parse(req.body));
    return res
        .status(201)
        .json({ success: true, message: "Service plan created", data: plan });
}
async function updateServicePlanHandler(req, res) {
    const organizationId = auth(req).organizationId;
    if (!organizationId)
        return res.status(403).json({
            success: false,
            message: "Account is not linked to an organization",
        });
    const plan = await (0, billing_service_1.updateServicePlan)(organizationId, req.params.planId, billing_validator_1.createServicePlanSchema.parse(req.body));
    if (!plan)
        return res.status(409).json({
            success: false,
            message: "Packages already used by contracts or subscriptions cannot be repriced. Create a new package instead.",
        });
    return res.json({
        success: true,
        message: "Service package updated",
        data: plan,
    });
}
async function updateServicePlanStatusHandler(req, res) {
    const organizationId = auth(req).organizationId;
    if (!organizationId)
        return res.status(403).json({
            success: false,
            message: "Account is not linked to an organization",
        });
    const { isActive } = billing_validator_1.updateServicePlanStatusSchema.parse(req.body);
    const plan = await (0, billing_service_1.updateServicePlanStatus)(organizationId, req.params.planId, isActive);
    if (!plan)
        return res.status(409).json({
            success: false,
            message: "A package with active or suspended subscriptions cannot be deactivated.",
        });
    return res.json({
        success: true,
        message: `Service package ${isActive ? "activated" : "deactivated"}`,
        data: plan,
    });
}
async function subscribeServicePlanHandler(req, res) {
    billing_validator_1.subscribeServicePlanSchema.parse(req.body);
    return res.status(409).json({
        success: false,
        message: "Service packages are activated through a provider-approved contract. Contact your waste service organization.",
    });
}
async function getBillingOverviewHandler(req, res) {
    const overview = await (0, billing_service_1.findBillingOverview)(organizationScope(req), customerUser(req));
    return res.status(200).json({
        success: true,
        message: "Billing overview fetched",
        data: overview,
    });
}
async function getPaymentReceiptHandler(req, res) {
    const receipt = await (0, billing_service_1.findPaymentReceipt)(req.params.paymentId, organizationScope(req), customerUser(req));
    if (!receipt)
        return res.status(404).json({ success: false, message: "Receipt not found or payment has not been confirmed" });
    return res.status(200).json({ success: true, message: "Payment receipt fetched", data: receipt });
}
async function generateDueInvoicesHandler(req, res) {
    const organizationId = auth(req).organizationId;
    if (!organizationId)
        return res.status(403).json({
            success: false,
            message: "Account is not linked to an organization",
        });
    const invoices = await (0, billing_service_1.generateDueSubscriptionInvoices)(organizationId, auth(req).userId);
    return res.status(201).json({
        success: true,
        message: invoices.length
            ? `${invoices.length} due invoice${invoices.length === 1 ? "" : "s"} generated`
            : "No subscriptions are due for billing",
        data: { generated: invoices.length, invoices },
    });
}
async function updateSubscriptionStatusHandler(req, res) {
    const organizationId = auth(req).organizationId;
    if (!organizationId)
        return res.status(403).json({
            success: false,
            message: "Account is not linked to an organization",
        });
    const { status } = billing_validator_1.updateSubscriptionStatusSchema.parse(req.body);
    const subscription = await (0, billing_service_1.updateSubscriptionStatus)(organizationId, req.params.subscriptionId, status);
    if (!subscription)
        return res.status(409).json({
            success: false,
            message: "This service change is not available from the subscription's current status",
        });
    return res.json({
        success: true,
        message: `Customer service ${status === "active" ? "resumed" : status}`,
        data: subscription,
    });
}
async function initiatePaymentHandler(req, res) {
    const result = await (0, billing_service_1.initiateCustomerPayment)(auth(req).userId, billing_validator_1.initiatePaymentSchema.parse(req.body));
    if (!result)
        return res.status(400).json({
            success: false,
            message: "Invoice is unavailable or payment exceeds its balance",
        });
    return res.status(201).json({
        success: true,
        message: result.providerMessage,
        data: result.payment,
    });
}
async function confirmPaymentHandler(req, res) {
    const input = billing_validator_1.confirmPaymentSchema.parse(req.body);
    const result = await (0, billing_service_1.confirmPayment)(req.params.paymentId, organizationScope(req), input.providerReference, auth(req).userId);
    if (!result)
        return res.status(409).json({
            success: false,
            message: "Payment cannot be confirmed: it is unavailable, already processed, exceeds the remaining invoice balance, or uses a duplicate reference.",
        });
    return res.status(200).json({
        success: true,
        message: "Payment confirmed and invoice balance updated",
        data: result,
    });
}
async function recordOrganizationPaymentHandler(req, res) {
    const organizationId = auth(req).organizationId;
    if (!organizationId)
        return res.status(403).json({
            success: false,
            message: "Account is not linked to an organization",
        });
    const result = await (0, billing_service_1.recordOrganizationPayment)(organizationId, billing_validator_1.recordOrganizationPaymentSchema.parse(req.body), auth(req).userId);
    if (!result)
        return res.status(409).json({
            success: false,
            message: "Payment exceeds the balance, the invoice is no longer payable, or this reference was already recorded",
        });
    return res.status(201).json({
        success: true,
        message: "Payment recorded and invoice balance updated",
        data: result,
    });
}
