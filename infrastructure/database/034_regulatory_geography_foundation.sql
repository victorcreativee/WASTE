CREATE TABLE IF NOT EXISTS kampala_divisions(id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),code TEXT UNIQUE NOT NULL,name TEXT UNIQUE NOT NULL,is_active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO kampala_divisions(code,name) VALUES ('central','Central Division'),('kawempe','Kawempe Division'),('makindye','Makindye Division'),('nakawa','Nakawa Division'),('rubaga','Rubaga Division') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name;

CREATE TABLE IF NOT EXISTS organization_permit_applications(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),application_number TEXT UNIQUE NOT NULL,organization_id UUID REFERENCES organizations(id),company_name TEXT NOT NULL,registration_number TEXT NOT NULL,
 contact_name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,service_description TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN('draft','submitted','under_review','information_required','approved','rejected','suspended','expired')),
 submitted_at TIMESTAMPTZ,review_notes TEXT,permit_number TEXT UNIQUE,valid_from DATE,valid_until DATE,reviewed_by UUID REFERENCES users(id),reviewed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_permits_status ON organization_permit_applications(status,created_at DESC);
CREATE TABLE IF NOT EXISTS organization_permit_documents(id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),application_id UUID NOT NULL REFERENCES organization_permit_applications(id) ON DELETE CASCADE,document_type TEXT NOT NULL,file_name TEXT NOT NULL,file_url TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS organization_permit_history(id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),application_id UUID NOT NULL REFERENCES organization_permit_applications(id) ON DELETE CASCADE,previous_status TEXT,new_status TEXT NOT NULL,notes TEXT,changed_by UUID REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS organization_division_authorizations(id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,division_id UUID NOT NULL REFERENCES kampala_divisions(id),permit_application_id UUID NOT NULL REFERENCES organization_permit_applications(id),status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','suspended','expired')),authorized_by UUID NOT NULL REFERENCES users(id),authorized_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_on DATE,UNIQUE(organization_id,division_id));
ALTER TABLE waste_zones ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES kampala_divisions(id);
CREATE INDEX IF NOT EXISTS idx_waste_zones_division ON waste_zones(division_id);

CREATE OR REPLACE FUNCTION enforce_authorized_zone_division() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.organization_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.division_id IS DISTINCT FROM OLD.division_id) THEN
  IF NEW.division_id IS NULL THEN RAISE EXCEPTION 'Choose a KCCA-authorized division for this zone'; END IF;
  IF NOT EXISTS(SELECT 1 FROM organization_division_authorizations a JOIN organization_permit_applications p ON p.id=a.permit_application_id WHERE a.organization_id=NEW.organization_id AND a.division_id=NEW.division_id AND a.status='active' AND (a.expires_on IS NULL OR a.expires_on>=CURRENT_DATE) AND p.status='approved' AND (p.valid_until IS NULL OR p.valid_until>=CURRENT_DATE)) THEN RAISE EXCEPTION 'Organization is not authorized by KCCA for this division'; END IF;
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_authorized_zone_division ON waste_zones;
CREATE TRIGGER trg_authorized_zone_division BEFORE INSERT OR UPDATE OF organization_id,division_id ON waste_zones FOR EACH ROW EXECUTE FUNCTION enforce_authorized_zone_division();
