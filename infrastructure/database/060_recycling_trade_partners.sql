CREATE TABLE IF NOT EXISTS recycling_trade_partners (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 partner_type TEXT NOT NULL CHECK(partner_type IN('supplier','buyer','both')),
 name TEXT NOT NULL,
 contact_person TEXT,
 phone TEXT,
 email TEXT,
 address TEXT,
 tax_number TEXT,
 active BOOLEAN NOT NULL DEFAULT true,
 created_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recycling_partner_org_name_idx ON recycling_trade_partners(organization_id,lower(name));

ALTER TABLE recycling_material_lots
 ADD COLUMN IF NOT EXISTS supplier_partner_id UUID REFERENCES recycling_trade_partners(id),
 ADD COLUMN IF NOT EXISTS purchase_payment_status TEXT NOT NULL DEFAULT 'paid',
 ADD COLUMN IF NOT EXISTS purchase_payment_reference TEXT,
 ADD COLUMN IF NOT EXISTS purchase_paid_on DATE;
ALTER TABLE recycling_material_lots DROP CONSTRAINT IF EXISTS recycling_lots_purchase_payment_status_check;
ALTER TABLE recycling_material_lots ADD CONSTRAINT recycling_lots_purchase_payment_status_check CHECK(purchase_payment_status IN('paid','credit'));

ALTER TABLE recycling_material_sales
 ADD COLUMN IF NOT EXISTS buyer_partner_id UUID REFERENCES recycling_trade_partners(id),
 ADD COLUMN IF NOT EXISTS invoice_number TEXT,
 ADD COLUMN IF NOT EXISTS payment_reference TEXT,
 ADD COLUMN IF NOT EXISTS paid_on DATE;
CREATE UNIQUE INDEX IF NOT EXISTS recycling_sale_invoice_org_idx ON recycling_material_sales(organization_id,invoice_number) WHERE invoice_number IS NOT NULL;
