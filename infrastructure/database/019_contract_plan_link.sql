ALTER TABLE service_plans
  ADD COLUMN IF NOT EXISTS collections_per_period INTEGER NOT NULL DEFAULT 1 CHECK (collections_per_period > 0),
  ADD COLUMN IF NOT EXISTS response_hours INTEGER NOT NULL DEFAULT 24 CHECK (response_hours > 0);

ALTER TABLE customer_contracts
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES service_plans(id),
  ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES customer_subscriptions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_plan ON customer_contracts(plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_subscription
  ON customer_contracts(subscription_id) WHERE subscription_id IS NOT NULL;
