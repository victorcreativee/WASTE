CREATE TABLE IF NOT EXISTS supplier_bills (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 bill_number VARCHAR(60) NOT NULL, supplier_id UUID NOT NULL REFERENCES suppliers(id), purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
 description VARCHAR(240) NOT NULL, amount_ugx BIGINT NOT NULL CHECK(amount_ugx>0), balance_ugx BIGINT NOT NULL CHECK(balance_ugx>=0),
 issued_on DATE NOT NULL, due_on DATE NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK(status IN ('open','partially_paid','paid','overdue','void')),
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,supplier_id,bill_number), CHECK(due_on>=issued_on)
);
CREATE TABLE IF NOT EXISTS supplier_payments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 bill_id UUID NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE, amount_ugx BIGINT NOT NULL CHECK(amount_ugx>0),
 payment_method VARCHAR(40) NOT NULL, reference VARCHAR(120), paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
 notes VARCHAR(500), recorded_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_org_due ON supplier_bills(organization_id,status,due_on);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_bill ON supplier_payments(bill_id,paid_on DESC);
