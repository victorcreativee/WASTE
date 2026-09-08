CREATE TABLE IF NOT EXISTS service_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    customer_type VARCHAR(30) CHECK (customer_type IN ('residential','commercial','office_business','industrial')),
    billing_frequency VARCHAR(30) NOT NULL CHECK (billing_frequency IN ('monthly','quarterly','annual','on_demand')),
    fee_ugx BIGINT NOT NULL CHECK (fee_ugx >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    service_location_id UUID NOT NULL REFERENCES customer_service_locations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES service_plans(id),
    status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','suspended','cancelled')),
    starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
    next_billing_date DATE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_location_subscription
  ON customer_subscriptions(service_location_id) WHERE status IN ('pending','active','suspended');

CREATE TABLE IF NOT EXISTS customer_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(40) UNIQUE NOT NULL,
    subscription_id UUID NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    amount_ugx BIGINT NOT NULL CHECK (amount_ugx >= 0),
    balance_ugx BIGINT NOT NULL CHECK (balance_ugx >= 0),
    status VARCHAR(30) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','partially_paid','paid','overdue','cancelled')),
    issued_on DATE NOT NULL DEFAULT CURRENT_DATE,
    due_on DATE NOT NULL,
    paid_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    amount_ugx BIGINT NOT NULL CHECK (amount_ugx > 0),
    provider VARCHAR(40) NOT NULL,
    provider_reference VARCHAR(150),
    payer_phone VARCHAR(50),
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','successful','failed','cancelled')),
    confirmed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plans_org ON service_plans(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON customer_subscriptions(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON customer_invoices(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_org_status ON customer_payments(organization_id, status);
