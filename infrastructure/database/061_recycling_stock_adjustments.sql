CREATE TABLE IF NOT EXISTS recycling_stock_adjustments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 lot_id UUID NOT NULL REFERENCES recycling_material_lots(id),
 adjustment_date DATE NOT NULL,
 adjustment_type TEXT NOT NULL CHECK(adjustment_type IN('loss','correction_in','correction_out')),
 quantity_kg NUMERIC(12,2) NOT NULL CHECK(quantity_kg>0),
 reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
 notes TEXT,
 recorded_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recycling_stock_adjustment_org_date_idx ON recycling_stock_adjustments(organization_id,adjustment_date DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS recycling_stock_adjustment_lot_idx ON recycling_stock_adjustments(lot_id);
