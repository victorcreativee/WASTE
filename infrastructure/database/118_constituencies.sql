-- KWMS module 6: constituency-level dashboards. Kampala's nine parliamentary constituencies, each made of named areas
-- from the area catalogue (044). Household locations already carry their area, so every collection, receipt and bill
-- can be counted in a constituency once its area is assigned. Central Division is a single constituency and its areas
-- are assigned here; KCCA assigns the areas of the other divisions. Additive and idempotent. Requires 044, 113.

CREATE TABLE IF NOT EXISTS kampala_constituencies(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 code TEXT NOT NULL UNIQUE CHECK(code ~ '^[a-z_]{3,40}$'),
 name TEXT NOT NULL UNIQUE,
 division_id UUID NOT NULL REFERENCES kampala_divisions(id),
 sort_order INT NOT NULL DEFAULT 0
);
INSERT INTO kampala_constituencies(code,name,division_id,sort_order)
SELECT c.code,c.name,d.id,c.sort_order FROM (VALUES
 ('kampala_central','Kampala Central Division','central',1),
 ('kawempe_north','Kawempe North','kawempe',2),('kawempe_south','Kawempe South','kawempe',3),
 ('makindye_east','Makindye East','makindye',4),('makindye_west','Makindye West','makindye',5),
 ('nakawa_east','Nakawa East','nakawa',6),('nakawa_west','Nakawa West','nakawa',7),
 ('rubaga_north','Rubaga North','rubaga',8),('rubaga_south','Rubaga South','rubaga',9)
) c(code,name,division_code,sort_order) JOIN kampala_divisions d ON d.code=c.division_code
ON CONFLICT(code) DO NOTHING;

ALTER TABLE kampala_division_areas ADD COLUMN IF NOT EXISTS constituency_id UUID REFERENCES kampala_constituencies(id);
ALTER TABLE kampala_division_areas ADD COLUMN IF NOT EXISTS constituency_assigned_by UUID REFERENCES users(id);
ALTER TABLE kampala_division_areas ADD COLUMN IF NOT EXISTS constituency_assigned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_division_areas_constituency ON kampala_division_areas(constituency_id);

-- An area can only belong to a constituency of its own division.
CREATE OR REPLACE FUNCTION check_area_constituency() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.constituency_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM kampala_constituencies c WHERE c.id=NEW.constituency_id AND c.division_id=NEW.division_id) THEN
    RAISE EXCEPTION 'An area can only belong to a constituency in its own division' USING ERRCODE='KW400';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_check_area_constituency ON kampala_division_areas;
CREATE TRIGGER trg_check_area_constituency BEFORE INSERT OR UPDATE OF constituency_id,division_id ON kampala_division_areas
  FOR EACH ROW EXECUTE FUNCTION check_area_constituency();

-- Central Division is one constituency.
UPDATE kampala_division_areas a SET constituency_id=c.id,constituency_assigned_at=CURRENT_TIMESTAMP
FROM kampala_constituencies c WHERE c.code='kampala_central' AND a.division_id=c.division_id AND a.constituency_id IS NULL;

DROP TRIGGER IF EXISTS trg_kwms_audit ON kampala_division_areas;
CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON kampala_division_areas FOR EACH ROW EXECUTE FUNCTION kwms_audit_row();
