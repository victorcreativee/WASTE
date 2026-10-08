import { requireOrganizationScope } from "../middlewares/organization-scope";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import {
  confirmPayment,
  createServicePlan,
  findBillingOverview,
  findServicePlans,
  initiateCustomerPayment,
  updateServicePlan,
  updateServicePlanStatus,
  generateDueSubscriptionInvoices,
  updateSubscriptionStatus,
  recordOrganizationPayment,
} from "../services/billing.service";
import {
  confirmPaymentSchema,
  createServicePlanSchema,
  initiatePaymentSchema,
  subscribeServicePlanSchema,
  updateServicePlanStatusSchema,
  updateSubscriptionStatusSchema,
  recordOrganizationPaymentSchema,
} from "../validators/billing.validator";

function auth(req: Request) {
  return (req as AuthenticatedRequest).auth!;
}
function organizationScope(req: Request) {
  return auth(req).roles.includes("citizen")
    ? null
    : requireOrganizationScope(req);
}
function customerUser(req: Request) {
  return auth(req).roles.includes("citizen") ? auth(req).userId : null;
}

export async function getServicePlansHandler(req: Request, res: Response) {
  const plans = await findServicePlans(
    organizationScope(req),
    customerUser(req)
  );
  return res
    .status(200)
    .json({ success: true, message: "Service plans fetched", data: plans });
}
export async function createServicePlanHandler(req: Request, res: Response) {
  const organizationId = auth(req).organizationId;
  if (!organizationId)
    return res.status(403).json({
      success: false,
      message: "Account is not linked to an organization",
    });
  const plan = await createServicePlan(
    organizationId,
    createServicePlanSchema.parse(req.body)
  );
  return res
    .status(201)
    .json({ success: true, message: "Service plan created", data: plan });
}
export async function updateServicePlanHandler(req: Request, res: Response) {
  const organizationId = auth(req).organizationId;
  if (!organizationId)
    return res.status(403).json({
      success: false,
      message: "Account is not linked to an organization",
    });
  const plan = await updateServicePlan(
    organizationId,
    req.params.planId as string,
    createServicePlanSchema.parse(req.body)
  );
  if (!plan)
    return res.status(409).json({
      success: false,
      message:
        "Packages already used by contracts or subscriptions cannot be repriced. Create a new package instead.",
    });
  return res.json({
    success: true,
    message: "Service package updated",
    data: plan,
  });
}
export async function updateServicePlanStatusHandler(
  req: Request,
  res: Response
) {
  const organizationId = auth(req).organizationId;
  if (!organizationId)
    return res.status(403).json({
      success: false,
      message: "Account is not linked to an organization",
    });
  const { isActive } = updateServicePlanStatusSchema.parse(req.body);
  const plan = await updateServicePlanStatus(
    organizationId,
    req.params.planId as string,
    isActive
  );
  if (!plan)
    return res.status(409).json({
      success: false,
      message:
        "A package with active or suspended subscriptions cannot be deactivated.",
    });
  return res.json({
    success: true,
    message: `Service package ${isActive ? "activated" : "deactivated"}`,
    data: plan,
  });
}
export async function subscribeServicePlanHandler(req: Request, res: Response) {
  subscribeServicePlanSchema.parse(req.body);
  return res.status(409).json({
    success: false,
    message:
      "Service packages are activated through a provider-approved contract. Contact your waste service organization.",
  });
}
export async function getBillingOverviewHandler(req: Request, res: Response) {
  const overview = await findBillingOverview(
    organizationScope(req),
    customerUser(req)
  );
  return res.status(200).json({
    success: true,
    message: "Billing overview fetched",
    data: overview,
  });
}
export async function generateDueInvoicesHandler(req: Request, res: Response) {
  const organizationId = auth(req).organizationId;
  if (!organizationId)
    return res.status(403).json({
      success: false,
      message: "Account is not linked to an organization",
    });
  const invoices = await generateDueSubscriptionInvoices(organizationId);
  return res.status(201).json({
    success: true,
    message: invoices.length
      ? `${invoices.length} due invoice${
          invoices.length === 1 ? "" : "s"
        } generated`
      : "No subscriptions are due for billing",
    data: { generated: invoices.length, invoices },
  });
}
export async function updateSubscriptionStatusHandler(
  req: Request,
  res: Response
) {
  const organizationId = auth(req).organizationId;
  if (!organizationId)
    return res.status(403).json({
      success: false,
      message: "Account is not linked to an organization",
    });
  const { status } = updateSubscriptionStatusSchema.parse(req.body);
  const subscription = await updateSubscriptionStatus(
    organizationId,
    req.params.subscriptionId as string,
    status
  );
  if (!subscription)
    return res.status(409).json({
      success: false,
      message:
        "This service change is not available from the subscription's current status",
    });
  return res.json({
    success: true,
    message: `Customer service ${status === "active" ? "resumed" : status}`,
    data: subscription,
  });
}
export async function initiatePaymentHandler(req: Request, res: Response) {
  const result = await initiateCustomerPayment(
    auth(req).userId,
    initiatePaymentSchema.parse(req.body)
  );
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
export async function confirmPaymentHandler(req: Request, res: Response) {
  const input = confirmPaymentSchema.parse(req.body);
  const result = await confirmPayment(
    req.params.paymentId as string,
    organizationScope(req),
    input.providerReference
  );
  if (!result)
    return res.status(409).json({
      success: false,
      message:
        "Payment cannot be confirmed: it is unavailable, already processed, exceeds the remaining invoice balance, or uses a duplicate reference.",
    });
  return res.status(200).json({
    success: true,
    message: "Payment confirmed and invoice balance updated",
    data: result,
  });
}
export async function recordOrganizationPaymentHandler(
  req: Request,
  res: Response
) {
  const organizationId = auth(req).organizationId;
  if (!organizationId)
    return res.status(403).json({
      success: false,
      message: "Account is not linked to an organization",
    });
  const result = await recordOrganizationPayment(
    organizationId,
    recordOrganizationPaymentSchema.parse(req.body)
  );
  if (!result)
    return res.status(409).json({
      success: false,
      message:
        "Payment exceeds the balance, the invoice is no longer payable, or this reference was already recorded",
    });
  return res.status(201).json({
    success: true,
    message: "Payment recorded and invoice balance updated",
    data: result,
  });
}
