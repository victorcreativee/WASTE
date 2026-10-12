ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS customer_number VARCHAR(32);

UPDATE customer_profiles
SET customer_number='CUS-'||UPPER(SUBSTRING(REPLACE(id::text,'-','') FROM 1 FOR 10))
WHERE customer_number IS NULL;

ALTER TABLE customer_profiles ALTER COLUMN customer_number SET NOT NULL;
ALTER TABLE customer_profiles ALTER COLUMN customer_number
  SET DEFAULT ('CUS-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text,'-','') FROM 1 FOR 10)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_profiles_number ON customer_profiles(customer_number);

CREATE SEQUENCE IF NOT EXISTS customer_contract_number_seq START 1001;

CREATE INDEX IF NOT EXISTS idx_customer_contracts_overlap
  ON customer_contracts(organization_id,customer_id,starts_on,ends_on)
  WHERE status NOT IN ('cancelled','expired');
