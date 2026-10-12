CREATE SEQUENCE IF NOT EXISTS customer_receipt_number_seq START 1001;

ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(40);

WITH numbered AS (
  SELECT id,ROW_NUMBER() OVER(ORDER BY COALESCE(confirmed_at,created_at),id) AS row_number
  FROM customer_payments
  WHERE status='successful' AND receipt_number IS NULL
)
UPDATE customer_payments p
SET receipt_number='RCT-LEGACY-'||LPAD(numbered.row_number::text,6,'0')
FROM numbered WHERE numbered.id=p.id;

CREATE UNIQUE INDEX IF NOT EXISTS customer_payments_receipt_number_idx
  ON customer_payments(receipt_number) WHERE receipt_number IS NOT NULL;
