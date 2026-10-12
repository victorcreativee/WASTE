CREATE SEQUENCE IF NOT EXISTS customer_invoice_number_seq START 1001;

ALTER TABLE customer_invoices
  ADD COLUMN IF NOT EXISTS billing_period_start DATE,
  ADD COLUMN IF NOT EXISTS billing_period_end DATE;

ALTER TABLE customer_invoices
  DROP CONSTRAINT IF EXISTS customer_invoices_billing_period_check;
ALTER TABLE customer_invoices
  ADD CONSTRAINT customer_invoices_billing_period_check
  CHECK (
    (billing_period_start IS NULL AND billing_period_end IS NULL)
    OR (billing_period_start IS NOT NULL AND billing_period_end >= billing_period_start)
  );

CREATE UNIQUE INDEX IF NOT EXISTS customer_invoice_subscription_period_idx
  ON customer_invoices(subscription_id,billing_period_start)
  WHERE status <> 'cancelled' AND billing_period_start IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_invoices_customer_period_idx
  ON customer_invoices(customer_id,billing_period_start DESC);
