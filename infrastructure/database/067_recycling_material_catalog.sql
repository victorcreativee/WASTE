CREATE TABLE IF NOT EXISTS recycling_material_catalog (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 80),
 category TEXT NOT NULL DEFAULT 'other' CHECK(category IN('plastic','paper','metal','glass','organic','textile','other')),
 active BOOLEAN NOT NULL DEFAULT true,
 created_by UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recycling_material_catalog_org_name_idx
 ON recycling_material_catalog(organization_id,lower(name));

CREATE OR REPLACE FUNCTION seed_recycling_material_catalog(p_organization_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO recycling_material_catalog(organization_id,name,category)
 VALUES
  (p_organization_id,'PET','plastic'),
  (p_organization_id,'HDPE','plastic'),
  (p_organization_id,'PP','plastic'),
  (p_organization_id,'Soft plastic','plastic'),
  (p_organization_id,'Sacs','plastic'),
  (p_organization_id,'Cardboard / Box','paper'),
  (p_organization_id,'Steel','metal'),
  (p_organization_id,'Aluminium','metal'),
  (p_organization_id,'Glass','glass'),
  (p_organization_id,'Other reusable material','other')
 ON CONFLICT(organization_id,lower(name)) DO NOTHING;
END;
$$;

DO $$ DECLARE organization UUID; BEGIN
 FOR organization IN SELECT id FROM organizations WHERE type='recycling_company' LOOP
  PERFORM seed_recycling_material_catalog(organization);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION seed_new_recycling_company_materials()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type='recycling_company' AND (TG_OP='INSERT' OR OLD.type IS DISTINCT FROM NEW.type) THEN
  PERFORM seed_recycling_material_catalog(NEW.id);
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS organizations_seed_recycling_materials ON organizations;
CREATE TRIGGER organizations_seed_recycling_materials
 AFTER INSERT OR UPDATE OF type ON organizations
 FOR EACH ROW EXECUTE FUNCTION seed_new_recycling_company_materials();
