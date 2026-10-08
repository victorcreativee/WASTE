CREATE TABLE IF NOT EXISTS recycling_material_lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 material_type text NOT NULL, source_name text NOT NULL, quantity_kg numeric(12,2) NOT NULL CHECK(quantity_kg>0),
 available_kg numeric(12,2) NOT NULL CHECK(available_kg>=0), collected_on date NOT NULL,
 quality text NOT NULL CHECK(quality IN('sorted','clean','mixed','contaminated')),
 status text NOT NULL DEFAULT 'available' CHECK(status IN('available','partially_sold','sold','rejected')),
 notes text, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recycling_material_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), lot_id uuid NOT NULL REFERENCES recycling_material_lots(id),
 buyer_name text NOT NULL, industry text NOT NULL, quantity_kg numeric(12,2) NOT NULL CHECK(quantity_kg>0),
 unit_price_ugx bigint NOT NULL CHECK(unit_price_ugx>0), sold_on date NOT NULL,
 status text NOT NULL DEFAULT 'recorded' CHECK(status IN('recorded','paid')),
 notes text, recorded_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recycling_lots_org_idx ON recycling_material_lots(organization_id,status,collected_on DESC);
CREATE INDEX IF NOT EXISTS recycling_sales_org_idx ON recycling_material_sales(organization_id,sold_on DESC);
