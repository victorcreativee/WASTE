ALTER TABLE recycling_material_lots
 ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'purchase',
 ADD COLUMN IF NOT EXISTS source_lot_id UUID REFERENCES recycling_material_lots(id);
ALTER TABLE recycling_material_lots DROP CONSTRAINT IF EXISTS recycling_material_lots_origin_check;
ALTER TABLE recycling_material_lots ADD CONSTRAINT recycling_material_lots_origin_check CHECK(origin IN('purchase','sorting_output'));

CREATE TABLE IF NOT EXISTS recycling_sorting_batches (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 input_lot_id UUID NOT NULL REFERENCES recycling_material_lots(id),
 output_lot_id UUID NOT NULL UNIQUE REFERENCES recycling_material_lots(id),
 processed_on DATE NOT NULL,
 input_kg NUMERIC(12,2) NOT NULL CHECK(input_kg>0),
 output_material_type TEXT NOT NULL,
 output_kg NUMERIC(12,2) NOT NULL CHECK(output_kg>0),
 rejected_kg NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(rejected_kg>=0),
 processing_cost_ugx BIGINT NOT NULL DEFAULT 0 CHECK(processing_cost_ugx>=0),
 notes TEXT,
 recorded_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(output_kg+rejected_kg<=input_kg)
);
CREATE INDEX IF NOT EXISTS recycling_sorting_org_date_idx ON recycling_sorting_batches(organization_id,processed_on DESC,created_at DESC);
