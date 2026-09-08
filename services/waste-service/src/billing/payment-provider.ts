export type PaymentRequest = { amountUgx: number; payerPhone?: string; invoiceNumber: string };
export type PaymentInitiation = { status: "pending"; providerReference: string | null; message: string };

export interface PaymentProvider {
  readonly code: string;
  initiate(request: PaymentRequest): Promise<PaymentInitiation>;
}

class PendingExternalProvider implements PaymentProvider {
  constructor(readonly code: string) {}
  async initiate(): Promise<PaymentInitiation> {
    return { status: "pending", providerReference: null, message: "Payment request recorded. External provider confirmation is pending." };
  }
}

export function getPaymentProvider(code: string): PaymentProvider {
  return new PendingExternalProvider(code);
}
