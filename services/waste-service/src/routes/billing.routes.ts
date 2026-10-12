import { NextFunction,Request,Response,Router } from "express";
import {
  confirmPaymentHandler,createServicePlanHandler,getBillingOverviewHandler,getServicePlansHandler,initiatePaymentHandler,subscribeServicePlanHandler,updateServicePlanHandler,updateServicePlanStatusHandler,generateDueInvoicesHandler,updateSubscriptionStatusHandler,recordOrganizationPaymentHandler,getPaymentReceiptHandler,
} from "../controllers/billing.controller";
import { requireRoles } from "../middlewares/auth.middleware";
import { requireOrganizationPermission,requireRoleOrOrganizationPermission } from "../middlewares/organization-permission.middleware";
const router=Router();
const run=(handler:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response,next:NextFunction)=>{try{await handler(req,res);}catch(error){next(error);}};
const permission=(code:string)=>requireOrganizationPermission(code);
const canView=requireRoleOrOrganizationPermission(["citizen"],"billing.read");
router.get("/billing/plans",canView,run(getServicePlansHandler));
router.post("/billing/plans",permission("billing.plan.manage"),run(createServicePlanHandler));
router.put("/billing/plans/:planId",permission("billing.plan.manage"),run(updateServicePlanHandler));
router.patch("/billing/plans/:planId/status",permission("billing.plan.manage"),run(updateServicePlanStatusHandler));
router.post("/billing/subscriptions",requireRoles("citizen"),run(subscribeServicePlanHandler));
router.get("/billing/overview",canView,run(getBillingOverviewHandler));
router.get("/billing/payments/:paymentId/receipt",canView,run(getPaymentReceiptHandler));
router.post("/billing/invoices/generate",permission("billing.invoice.generate"),run(generateDueInvoicesHandler));
router.patch("/billing/subscriptions/:subscriptionId/status",permission("billing.subscription.manage"),run(updateSubscriptionStatusHandler));
router.post("/billing/payments",requireRoles("citizen"),run(initiatePaymentHandler));
router.post("/billing/payments/record",permission("billing.payment.record"),run(recordOrganizationPaymentHandler));
router.patch("/billing/payments/:paymentId/confirm",permission("billing.payment.confirm"),run(confirmPaymentHandler));
export default router;
