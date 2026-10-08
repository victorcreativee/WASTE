ALTER TABLE recycling_material_lots
 ADD COLUMN IF NOT EXISTS unit_purchase_price_ugx BIGINT NOT NULL DEFAULT 0 CHECK(unit_purchase_price_ugx>=0),
 ADD COLUMN IF NOT EXISTS worker_wages_ugx BIGINT NOT NULL DEFAULT 0 CHECK(worker_wages_ugx>=0),
 ADD COLUMN IF NOT EXISTS food_ugx BIGINT NOT NULL DEFAULT 0 CHECK(food_ugx>=0),
 ADD COLUMN IF NOT EXISTS transport_ugx BIGINT NOT NULL DEFAULT 0 CHECK(transport_ugx>=0),
 ADD COLUMN IF NOT EXISTS driver_fee_ugx BIGINT NOT NULL DEFAULT 0 CHECK(driver_fee_ugx>=0),
 ADD COLUMN IF NOT EXISTS other_expense_ugx BIGINT NOT NULL DEFAULT 0 CHECK(other_expense_ugx>=0),
 ADD COLUMN IF NOT EXISTS manager_float_used_ugx BIGINT NOT NULL DEFAULT 0 CHECK(manager_float_used_ugx>=0);

ALTER TABLE recycling_material_sales
 ADD COLUMN IF NOT EXISTS worker_wages_ugx BIGINT NOT NULL DEFAULT 0 CHECK(worker_wages_ugx>=0),
 ADD COLUMN IF NOT EXISTS food_ugx BIGINT NOT NULL DEFAULT 0 CHECK(food_ugx>=0),
 ADD COLUMN IF NOT EXISTS transport_ugx BIGINT NOT NULL DEFAULT 0 CHECK(transport_ugx>=0),
 ADD COLUMN IF NOT EXISTS other_expense_ugx BIGINT NOT NULL DEFAULT 0 CHECK(other_expense_ugx>=0);

CREATE TABLE IF NOT EXISTS recycling_manager_float_transactions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 transaction_date DATE NOT NULL,
 transaction_type TEXT NOT NULL CHECK(transaction_type IN('given','spent')),
 amount_ugx BIGINT NOT NULL CHECK(amount_ugx>0),
 notes TEXT,
 purchase_lot_id UUID REFERENCES recycling_material_lots(id),
 recorded_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recycling_float_org_date_idx ON recycling_manager_float_transactions(organization_id,transaction_date DESC,created_at DESC);
