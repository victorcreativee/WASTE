-- Recycling: one name for each material.
--
-- Two names are the same material when they differ only in case, spaces or punctuation ("Steel PP", "steel/pp"). The key
-- makes that comparison, and the index stops a company having both in its catalogue.
--
-- A merged name stays as an alias, so a phone still syncing the old name reaches the material it became.

CREATE OR REPLACE FUNCTION recycling_material_key(name TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(regexp_replace(lower(name), '[^a-z0-9]', '', 'g'), ''), lower(name));
$$;

CREATE UNIQUE INDEX IF NOT EXISTS recycling_material_catalog_org_key_idx ON recycling_material_catalog(organization_id, recycling_material_key(name));

CREATE TABLE IF NOT EXISTS recycling_material_aliases (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  alias_key TEXT NOT NULL,
  alias TEXT NOT NULL,
  material TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, alias_key)
);

ALTER TABLE recycling_material_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE recycling_material_aliases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kwms_tenant ON recycling_material_aliases;
CREATE POLICY kwms_tenant ON recycling_material_aliases USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id));
DROP TRIGGER IF EXISTS trg_kwms_audit ON recycling_material_aliases;
CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON recycling_material_aliases FOR EACH ROW EXECUTE FUNCTION kwms_audit_row();
