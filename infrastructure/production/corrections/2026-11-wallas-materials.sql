-- Wallas Ecotrade: one-off stock correction, agreed with the company in November 2026.
--
--   1. Soft black stock becomes 30 kg. The other 218 kg is written off as a stock loss on its own lots, so the sorting
--      entries stay as recorded and the loss appears in the reports.
--   2. Steel/PP joins Steel, Pet clear joins PET, Black cups and White cups join Cups. Lots keep their history: each notes
--      the name it was recorded under, the old name stays as an alias, and the audit log holds the rows as they were.
--   3. The material list keeps the materials in use. Names taken off it stay in the catalogue and can be added back.
--
-- Nothing is deleted. It stops without changing anything if the stock is not what was reviewed.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE wallas AS
  SELECT o.id org, (SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.organization_id=o.id AND r.name='company_admin' AND u.status='active' ORDER BY u.created_at LIMIT 1) admin,
    (now() AT TIME ZONE 'Africa/Kampala')::date today
  FROM organizations o WHERE o.name='Wallas Ecotrade' AND o.type='recycling_company';

CREATE TEMP TABLE before_stock AS
  SELECT material_type material, SUM(available_kg) kg FROM recycling_material_lots WHERE organization_id=(SELECT org FROM wallas) GROUP BY 1;

CREATE TEMP TABLE write_off(lot_id UUID, kg NUMERIC) ;
INSERT INTO write_off VALUES ('293e09a1-944b-4610-a9b4-59fa7996b434',175),('e81c352a-7661-4f69-a616-21cc0b37e59d',26),('b1d495a6-b30d-4b30-8e4d-886c318aade8',17);

CREATE TEMP TABLE merges(old_name TEXT, new_name TEXT);
INSERT INTO merges VALUES ('Steel/PP','Steel'),('Pet clear','PET'),('Black cups','Cups'),('White cups','Cups');

DO $$
DECLARE org UUID := (SELECT w.org FROM wallas w); untouched INT;
BEGIN
  IF org IS NULL OR (SELECT admin FROM wallas) IS NULL THEN RAISE EXCEPTION 'Wallas Ecotrade or its administrator was not found'; END IF;
  SELECT COUNT(*) INTO untouched FROM write_off w JOIN recycling_material_lots l ON l.id=w.lot_id
    WHERE l.organization_id=org AND l.material_type='Soft black' AND l.available_kg=w.kg AND l.quantity_kg=w.kg;
  IF untouched<>3 THEN RAISE EXCEPTION 'Soft black stock has changed since it was reviewed'; END IF;
  IF (SELECT kg FROM before_stock WHERE material='Soft black')<>248 THEN RAISE EXCEPTION 'Soft black is no longer 248 kg'; END IF;
END $$;

-- 1. Soft black
INSERT INTO recycling_stock_adjustments(organization_id,lot_id,adjustment_date,adjustment_type,quantity_kg,reason,notes,recorded_by)
  SELECT wl.org,w.lot_id,wl.today,'loss',w.kg,'Stock correction','Soft black stock corrected to 30 kg, as agreed with the company.',wl.admin FROM write_off w CROSS JOIN wallas wl;
UPDATE recycling_material_lots l SET available_kg=0,status='rejected',updated_at=now() FROM write_off w WHERE l.id=w.lot_id;

-- 2. Merges
UPDATE recycling_material_lots l SET material_type=m.new_name,notes=concat_ws(' ',NULLIF(l.notes,''),'Recorded as '||m.old_name||' until the names were merged.'),updated_at=now()
  FROM merges m WHERE l.organization_id=(SELECT org FROM wallas) AND l.material_type=m.old_name;
UPDATE recycling_sorting_batches b SET output_material_type=m.new_name FROM merges m WHERE b.organization_id=(SELECT org FROM wallas) AND b.output_material_type=m.old_name;
INSERT INTO recycling_material_aliases(organization_id,alias_key,alias,material)
  SELECT (SELECT org FROM wallas),recycling_material_key(m.old_name),m.old_name,m.new_name FROM merges m;

-- 3. The list keeps what is in use
UPDATE recycling_material_catalog c SET active=(c.name IN (SELECT DISTINCT material_type FROM recycling_material_lots l WHERE l.organization_id=c.organization_id)),updated_at=now()
  WHERE c.organization_id=(SELECT org FROM wallas) AND c.active;
UPDATE recycling_material_catalog c SET active=true,updated_at=now() WHERE c.organization_id=(SELECT org FROM wallas) AND c.name IN (SELECT new_name FROM merges);

-- Stock must be exactly what it was, less the write-off, under the merged names.
DO $$
DECLARE differences INT;
BEGIN
  WITH expected AS (
    SELECT COALESCE(m.new_name,b.material) material, SUM(b.kg)-CASE WHEN COALESCE(m.new_name,b.material)='Soft black' THEN 218 ELSE 0 END kg
    FROM before_stock b LEFT JOIN merges m ON m.old_name=b.material GROUP BY 1
  ), actual AS (
    SELECT material_type material, SUM(available_kg) kg FROM recycling_material_lots WHERE organization_id=(SELECT org FROM wallas) GROUP BY 1
  )
  SELECT COUNT(*) INTO differences FROM expected e FULL JOIN actual a USING(material) WHERE e.kg IS DISTINCT FROM a.kg;
  IF differences>0 THEN RAISE EXCEPTION 'Stock does not balance after the correction'; END IF;
END $$;

SELECT material_type "Material", SUM(quantity_kg) "Recorded kg", SUM(available_kg) "Stock kg" FROM recycling_material_lots WHERE organization_id=(SELECT org FROM wallas) GROUP BY 1 ORDER BY 1;
SELECT string_agg(name,', ' ORDER BY name) "Material list" FROM recycling_material_catalog WHERE organization_id=(SELECT org FROM wallas) AND active;
COMMIT;
