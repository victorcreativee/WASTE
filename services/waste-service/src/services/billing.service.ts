import { startCustomerPayment } from "../repositories/mobile-money.repository";
import {
  confirmPayment, createServicePlan, findBillingOverview,
  findServicePlans, subscribeCustomer,
  updateServicePlan, updateServicePlanStatus,
  generateDueSubscriptionInvoices, updateSubscriptionStatus, recordOrganizationPayment,
  findPaymentReceipt,
} from "../repositories/billing.repository";

export { createServicePlan, findBillingOverview, findServicePlans, subscribeCustomer, confirmPayment, updateServicePlan, updateServicePlanStatus, generateDueSubscriptionInvoices, updateSubscriptionStatus, recordOrganizationPayment, findPaymentReceipt };

export async function initiateCustomerPayment(userId: string, input: {
  invoiceId: string; amountUgx: number; provider: string; payerPhone?: string;
}) {
  const started = await startCustomerPayment(userId, input);
  return started ? { payment: started.payment, automatic: started.automatic, providerMessage: started.message } : null;
}
