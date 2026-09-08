import { NextFunction,Request,Response,Router } from "express";
import {
  confirmPaymentHandler,createServicePlanHandler,getBillingOverviewHandler,getServicePlansHandler,initiatePaymentHandler,subscribeServicePlanHandler,updateServicePlanHandler,updateServicePlanStatusHandler,generateDueInvoicesHandler,updateSubscriptionStatusHandler,recordOrganizationPaymentHandler,
} from "../controllers/billing.controller";
import { requireRoles } from "../middlewares/auth.middleware";
const router=Router();
const run=(handler:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response,next:NextFunction)=>{try{await handler(req,res);}catch(error){next(error);}};
const canView=requireRoles("citizen","company_admin","supervisor");
router.get("/billing/plans",canView,run(getServicePlansHandler));
router.post("/billing/plans",requireRoles("company_admin"),run(createServicePlanHandler));
router.put("/billing/plans/:planId",requireRoles("company_admin"),run(updateServicePlanHandler));
router.patch("/billing/plans/:planId/status",requireRoles("company_admin"),run(updateServicePlanStatusHandler));
router.post("/billing/subscriptions",requireRoles("citizen"),run(subscribeServicePlanHandler));
router.get("/billing/overview",canView,run(getBillingOverviewHandler));
router.post("/billing/invoices/generate",requireRoles("company_admin"),run(generateDueInvoicesHandler));
router.patch("/billing/subscriptions/:subscriptionId/status",requireRoles("company_admin"),run(updateSubscriptionStatusHandler));
router.post("/billing/payments",requireRoles("citizen"),run(initiatePaymentHandler));
router.post("/billing/payments/record",requireRoles("company_admin"),run(recordOrganizationPaymentHandler));
router.patch("/billing/payments/:paymentId/confirm",requireRoles("company_admin"),run(confirmPaymentHandler));
export default router;
