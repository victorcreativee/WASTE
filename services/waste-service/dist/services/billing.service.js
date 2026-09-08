"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordOrganizationPayment = exports.updateSubscriptionStatus = exports.generateDueSubscriptionInvoices = exports.updateServicePlanStatus = exports.updateServicePlan = exports.confirmPayment = exports.subscribeCustomer = exports.findServicePlans = exports.findBillingOverview = exports.createServicePlan = void 0;
exports.initiateCustomerPayment = initiateCustomerPayment;
const payment_provider_1 = require("../billing/payment-provider");
const billing_repository_1 = require("../repositories/billing.repository");
Object.defineProperty(exports, "confirmPayment", { enumerable: true, get: function () { return billing_repository_1.confirmPayment; } });
Object.defineProperty(exports, "createServicePlan", { enumerable: true, get: function () { return billing_repository_1.createServicePlan; } });
Object.defineProperty(exports, "findBillingOverview", { enumerable: true, get: function () { return billing_repository_1.findBillingOverview; } });
Object.defineProperty(exports, "findServicePlans", { enumerable: true, get: function () { return billing_repository_1.findServicePlans; } });
Object.defineProperty(exports, "subscribeCustomer", { enumerable: true, get: function () { return billing_repository_1.subscribeCustomer; } });
Object.defineProperty(exports, "updateServicePlan", { enumerable: true, get: function () { return billing_repository_1.updateServicePlan; } });
Object.defineProperty(exports, "updateServicePlanStatus", { enumerable: true, get: function () { return billing_repository_1.updateServicePlanStatus; } });
Object.defineProperty(exports, "generateDueSubscriptionInvoices", { enumerable: true, get: function () { return billing_repository_1.generateDueSubscriptionInvoices; } });
Object.defineProperty(exports, "updateSubscriptionStatus", { enumerable: true, get: function () { return billing_repository_1.updateSubscriptionStatus; } });
Object.defineProperty(exports, "recordOrganizationPayment", { enumerable: true, get: function () { return billing_repository_1.recordOrganizationPayment; } });
async function initiateCustomerPayment(userId, input) {
    const provider = (0, payment_provider_1.getPaymentProvider)(input.provider);
    const initiation = await provider.initiate({ amountUgx: input.amountUgx, payerPhone: input.payerPhone, invoiceNumber: input.invoiceId });
    const payment = await (0, billing_repository_1.createPendingPayment)(userId, input, initiation.providerReference);
    return payment ? { payment, providerMessage: initiation.message } : null;
}
