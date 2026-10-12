CREATE OR REPLACE FUNCTION seed_recycling_material_catalog(p_organization_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO recycling_material_catalog(organization_id,name,category)
 VALUES
  (p_organization_id,'Mixed','plastic'),
  (p_organization_id,'Steel/PP','other'),
  (p_organization_id,'Other','other'),
  (p_organization_id,'PET','plastic'),
  (p_organization_id,'Sacs','plastic'),
  (p_organization_id,'Soft','plastic'),
  (p_organization_id,'Box','paper'),
  (p_organization_id,'Cups','plastic'),
  (p_organization_id,'PP','plastic'),
  (p_organization_id,'Supermarket','plastic'),
  (p_organization_id,'Steel','metal')
 ON CONFLICT(organization_id,lower(name)) DO UPDATE SET active=true,updated_at=now();
END;
$$;

DO $$ DECLARE organization UUID; BEGIN
 FOR organization IN SELECT id FROM organizations WHERE type='recycling_company' LOOP
  PERFORM seed_recycling_material_catalog(organization);
 END LOOP;
END $$;
