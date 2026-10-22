-- Module 6: recycling factories (organization type processing_plant) and chain of custody from recyclers.
-- Additive and idempotent. Requires 092–096.

-- 1. Factories join the regulated organization types.
ALTER TABLE permit_activity_types DROP CONSTRAINT IF EXISTS permit_activity_types_organization_type_check;
ALTER TABLE permit_activity_types ADD CONSTRAINT permit_activity_types_organization_type_check
  CHECK(organization_type IN('waste_collection_company','recycling_company','processing_plant'));
ALTER TABLE regulatory_returns DROP CONSTRAINT IF EXISTS regulatory_returns_organization_type_check;
ALTER TABLE regulatory_returns ADD CONSTRAINT regulatory_returns_organization_type_check
  CHECK(organization_type IN('waste_collection_company','recycling_company','processing_plant'));
ALTER TABLE platform_packages DROP CONSTRAINT IF EXISTS platform_packages_organization_type_check;
ALTER TABLE platform_packages ADD CONSTRAINT platform_packages_organization_type_check
  CHECK(organization_type IN('waste_collection_company','recycling_company','processing_plant'));

INSERT INTO permit_activity_types(code,name,description,organization_type,sort_order) VALUES
 ('recycled_material_processing','Recycled material processing','Turning recyclable materials into raw material such as flakes, pellets, pulp or bales.','processing_plant',210),
 ('recycled_product_manufacturing','Recycled product manufacturing','Manufacturing finished products from recycled raw material.','processing_plant',220)
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,organization_type=EXCLUDED.organization_type,sort_order=EXCLUDED.sort_order;

INSERT INTO platform_packages(code,name,description,monthly_fee_ugx,organization_type,feature_codes)
VALUES('factory_standard','Factory Standard','Material intake, processing batches, product dispatch and KCCA regulatory portal for recycling factories.',0,'processing_plant',ARRAY[]::text[])
ON CONFLICT(code) DO NOTHING;

-- 2. Chain of custody: a recycler's sale can name the licensed factory receiving the material.
ALTER TABLE recycling_material_sales ADD COLUMN IF NOT EXISTS buyer_organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_recycling_sales_buyer_organization ON recycling_material_sales(buyer_organization_id,sold_on DESC) WHERE buyer_organization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION check_sale_buyer_factory() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.buyer_organization_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM organizations WHERE id=NEW.buyer_organization_id AND type='processing_plant' AND is_active
  ) THEN
    RAISE EXCEPTION 'Choose an active licensed recycling factory as the buyer' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sale_buyer_factory ON recycling_material_sales;
CREATE TRIGGER trg_sale_buyer_factory BEFORE INSERT OR UPDATE OF buyer_organization_id ON recycling_material_sales
FOR EACH ROW EXECUTE FUNCTION check_sale_buyer_factory();

-- Once a factory has received a delivery, the sale's buyer, quantity and material are part of the custody record.
CREATE OR REPLACE FUNCTION protect_received_sale() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.buyer_organization_id IS DISTINCT FROM OLD.buyer_organization_id OR NEW.quantity_kg IS DISTINCT FROM OLD.quantity_kg OR NEW.lot_id IS DISTINCT FROM OLD.lot_id)
     AND EXISTS(SELECT 1 FROM factory_intakes WHERE source_sale_id=OLD.id AND status='received') THEN
    RAISE EXCEPTION 'The factory has already received this delivery; its buyer, quantity and material can no longer change' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;

-- 3. Factory records.
CREATE TABLE IF NOT EXISTS factory_intakes(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 intake_number TEXT UNIQUE NOT NULL,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 source_sale_id UUID REFERENCES recycling_material_sales(id),
 supplier_organization_id UUID REFERENCES organizations(id),
 supplier_name TEXT NOT NULL,
 material_category TEXT NOT NULL CHECK(material_category IN('plastic','paper','metal','glass','organic','textile','other')),
 material_description TEXT NOT NULL,
 declared_kg NUMERIC(12,2) CHECK(declared_kg IS NULL OR declared_kg>0),
 received_kg NUMERIC(12,2) NOT NULL CHECK(received_kg>0),
 rejected_kg NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(rejected_kg>=0),
 accepted_kg NUMERIC(12,2) GENERATED ALWAYS AS (received_kg-rejected_kg) STORED,
 available_kg NUMERIC(12,2) NOT NULL CHECK(available_kg>=0),
 received_on DATE NOT NULL,
 vehicle_registration TEXT,
 notes TEXT,
 status TEXT NOT NULL DEFAULT 'received' CHECK(status IN('received','voided')),
 void_reason TEXT,
 recorded_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(rejected_kg<=received_kg),
 CHECK(available_kg<=received_kg-rejected_kg),
 CHECK((status='voided')=(void_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_factory_intakes_org ON factory_intakes(organization_id,received_on DESC,id);
-- One received intake per delivery; a voided intake keeps its link for the record and frees the delivery to be received again.
ALTER TABLE factory_intakes DROP CONSTRAINT IF EXISTS factory_intakes_source_sale_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS one_received_intake_per_sale ON factory_intakes(source_sale_id) WHERE status='received' AND source_sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_factory_intakes_received_on ON factory_intakes(received_on) WHERE status='received';

CREATE TABLE IF NOT EXISTS factory_batches(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 batch_number TEXT UNIQUE NOT NULL,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 processed_on DATE NOT NULL,
 product_name TEXT NOT NULL,
 input_kg NUMERIC(12,2) NOT NULL CHECK(input_kg>0),
 output_kg NUMERIC(12,2) NOT NULL CHECK(output_kg>=0),
 residue_kg NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(residue_kg>=0),
 residue_disposal TEXT,
 notes TEXT,
 recorded_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(output_kg+residue_kg<=input_kg)
);
CREATE INDEX IF NOT EXISTS idx_factory_batches_org ON factory_batches(organization_id,processed_on DESC,id);

CREATE TABLE IF NOT EXISTS factory_batch_inputs(
 batch_id UUID NOT NULL REFERENCES factory_batches(id) ON DELETE CASCADE,
 intake_id UUID NOT NULL REFERENCES factory_intakes(id),
 kg NUMERIC(12,2) NOT NULL CHECK(kg>0),
 PRIMARY KEY(batch_id,intake_id)
);

CREATE TABLE IF NOT EXISTS factory_dispatches(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 dispatch_number TEXT UNIQUE NOT NULL,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 batch_id UUID REFERENCES factory_batches(id),
 product_name TEXT NOT NULL,
 quantity_kg NUMERIC(12,2) NOT NULL CHECK(quantity_kg>0),
 buyer_name TEXT NOT NULL,
 destination TEXT,
 dispatched_on DATE NOT NULL,
 notes TEXT,
 recorded_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_factory_dispatches_org ON factory_dispatches(organization_id,dispatched_on DESC,id);

-- Factory records belong to factories, and the person recording them belongs to the same factory.
CREATE OR REPLACE FUNCTION check_factory_record() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM organizations WHERE id=NEW.organization_id AND type='processing_plant') THEN
    RAISE EXCEPTION 'Factory records can only belong to a recycling factory' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.recorded_by AND organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'The recording user must belong to the factory' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_factory_intake_owner ON factory_intakes;
CREATE TRIGGER trg_factory_intake_owner BEFORE INSERT ON factory_intakes FOR EACH ROW EXECUTE FUNCTION check_factory_record();
DROP TRIGGER IF EXISTS trg_factory_batch_owner ON factory_batches;
CREATE TRIGGER trg_factory_batch_owner BEFORE INSERT ON factory_batches FOR EACH ROW EXECUTE FUNCTION check_factory_record();
DROP TRIGGER IF EXISTS trg_factory_dispatch_owner ON factory_dispatches;
CREATE TRIGGER trg_factory_dispatch_owner BEFORE INSERT ON factory_dispatches FOR EACH ROW EXECUTE FUNCTION check_factory_record();

DROP TRIGGER IF EXISTS trg_protect_received_sale ON recycling_material_sales;
CREATE TRIGGER trg_protect_received_sale BEFORE UPDATE ON recycling_material_sales FOR EACH ROW EXECUTE FUNCTION protect_received_sale();

-- 4. Permit checks cover factories: receiving material requires the processing activity.
CREATE OR REPLACE FUNCTION organization_permit_block_reason(p_organization_id UUID,p_activities TEXT[],p_blocked_action TEXT) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE org_type TEXT; latest RECORD; activity_names TEXT;
BEGIN
  SELECT type INTO org_type FROM organizations WHERE id=p_organization_id;
  IF org_type IS NULL OR org_type NOT IN('waste_collection_company','recycling_company','processing_plant') THEN RETURN NULL; END IF;
  IF EXISTS(
    SELECT 1 FROM organization_permit_applications p JOIN organization_permit_activities a ON a.permit_application_id=p.id
    WHERE p.organization_id=p_organization_id AND p.status='approved' AND (p.valid_until IS NULL OR p.valid_until>=CURRENT_DATE)
      AND a.activity_code=ANY(p_activities)
  ) THEN RETURN NULL; END IF;
  -- Transitional rule: organizations with no permit on record are listed for KCCA but not blocked.
  SELECT p.permit_number,p.status,p.valid_until INTO latest FROM organization_permit_applications p
  WHERE p.organization_id=p_organization_id AND p.permit_number IS NOT NULL
  ORDER BY (p.status='approved') DESC,p.valid_until DESC NULLS LAST,p.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF latest.status='suspended' THEN
    RETURN 'KCCA permit '||latest.permit_number||' is suspended. '||p_blocked_action||' until KCCA reinstates it.';
  END IF;
  IF latest.status='expired' OR (latest.valid_until IS NOT NULL AND latest.valid_until<CURRENT_DATE) THEN
    RETURN 'KCCA permit '||latest.permit_number||' expired on '||to_char(latest.valid_until,'DD Mon YYYY')||'. '||p_blocked_action||' until KCCA renews it.';
  END IF;
  SELECT string_agg(lower(name),' or ' ORDER BY sort_order) INTO activity_names FROM permit_activity_types WHERE code=ANY(p_activities);
  RETURN 'KCCA permit '||latest.permit_number||' does not authorize '||COALESCE(activity_names,array_to_string(p_activities,' or '))||'. Ask KCCA to add it to your permit.';
END $$;

CREATE OR REPLACE FUNCTION enforce_factory_intake_permit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE reason TEXT;
BEGIN
  reason := organization_permit_block_reason(NEW.organization_id,ARRAY['recycled_material_processing'],'New material intake cannot be recorded');
  IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_factory_intake_permit ON factory_intakes;
CREATE TRIGGER trg_factory_intake_permit BEFORE INSERT ON factory_intakes FOR EACH ROW EXECUTE FUNCTION enforce_factory_intake_permit();

-- 5. Expiry notices describe what stops for each kind of organization.
CREATE OR REPLACE FUNCTION expire_lapsed_permits() RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE expired_count INTEGER;
BEGIN
  WITH lapsed AS (
    UPDATE organization_permit_applications
    SET status='expired',expired_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE status='approved' AND valid_until IS NOT NULL AND valid_until<CURRENT_DATE
    RETURNING id,organization_id,valid_until,permit_number
  ), history AS (
    INSERT INTO organization_permit_history(application_id,previous_status,new_status,notes)
    SELECT id,'approved','expired','Validity ended on '||to_char(valid_until,'DD Mon YYYY')||'. Expired automatically.' FROM lapsed
  ), authorizations AS (
    UPDATE organization_division_authorizations SET status='expired'
    WHERE permit_application_id IN(SELECT id FROM lapsed) AND status='active'
  ), notices AS (
    INSERT INTO permit_lifecycle_notices(permit_application_id,organization_id,notice_type,valid_until,message)
    SELECT l.id,l.organization_id,'expired',l.valid_until,'Permit '||l.permit_number||' expired on '||to_char(l.valid_until,'DD Mon YYYY')||'. '||
      CASE WHEN o.type='recycling_company' THEN 'New material purchases and sales cannot be recorded'
           WHEN o.type='processing_plant' THEN 'New material intake cannot be recorded'
           ELSE 'New collection routes cannot be planned or dispatched' END||' until KCCA renews it.'
    FROM lapsed l LEFT JOIN organizations o ON o.id=l.organization_id ON CONFLICT DO NOTHING
  )
  SELECT count(*) INTO expired_count FROM lapsed;
  RETURN expired_count;
END $$;
