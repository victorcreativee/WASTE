type CashFlow = {
  received: string | number;
  operating_expenses: string | number;
  supplier_payments: string | number;
};

/** Fleet expenses already enter operating_expenses when paid; never subtract them again. */
export function netCashMovement(finance: CashFlow): number {
  return Number(finance.received) - Number(finance.operating_expenses) - Number(finance.supplier_payments);
}
