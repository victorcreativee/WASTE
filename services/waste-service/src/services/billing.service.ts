import { getPaymentProvider } from "../billing/payment-provider";
import {
  confirmPayment, createPendingPayment, createServicePlan, findBillingOverview,
  findServicePlans, subscribeCustomer,
  updateServicePlan, updateServicePlanStatus,
  generateDueSubscriptionInvoices, updateSubscriptionStatus, recordOrganizationPayment,
} from "../repositories/billing.repository";

export { createServicePlan, findBillingOverview, findServicePlans, subscribeCustomer, confirmPayment, updateServicePlan, updateServicePlanStatus, generateDueSubscriptionInvoices, updateSubscriptionStatus, recordOrganizationPayment };

export async function initiateCustomerPayment(userId: string, input: {
  invoiceId: string; amountUgx: number; provider: string; payerPhone?: string;
}) {
  const provider = getPaymentProvider(input.provider);
  const initiation = await provider.initiate({ amountUgx: input.amountUgx, payerPhone: input.payerPhone, invoiceNumber: input.invoiceId });
  const payment = await createPendingPayment(userId, input, initiation.providerReference);
  return payment ? { payment, providerMessage: initiation.message } : null;
}
