CREATE TABLE IF NOT EXISTS kampala_division_areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  division_id UUID NOT NULL REFERENCES kampala_divisions(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS kampala_area_name_per_division
  ON kampala_division_areas(division_id,LOWER(name));

INSERT INTO kampala_division_areas(division_id,name)
SELECT division.id,area.name FROM (VALUES
('central','Kisenyi'),('central','Old Kampala'),('central','Kololo'),('central','Kamwokya'),('central','Buganda Rd'),('central','Kampala Rd'),('central','Jinja Rd'),('central','Nasser'),('central','Kagugube'),('central','Nakasero'),('central','Usafi'),('central','Owino'),('central','Bukesa'),('central','Industrial area'),
('makindye','Namuwongo'),('makindye','Kisugu'),('makindye','Katwe'),('makindye','Nsambya'),('makindye','Salaama'),('makindye','Lukuli'),('makindye','Wabigalo'),('makindye','Makindye'),('makindye','Kibuye'),('makindye','Luwafu'),('makindye','Kabalagala'),('makindye','Bukasa'),('makindye','Buziga'),('makindye','Gaba'),('makindye','Muyenga'),('makindye','Kibuli'),('makindye','Munyonyo'),('makindye','Kansanga'),
('rubaga','Namungoona'),('rubaga','Nakulabye'),('rubaga','Mengo'),('rubaga','Busega'),('rubaga','Masanafu'),('rubaga','Kigobe'),('rubaga','Kabowa'),('rubaga','Kabuusu'),('rubaga','Bukuluji'),('rubaga','Lubaga'),('rubaga','Lungujja'),('rubaga','Najjanankumbi'),('rubaga','Nateete'),('rubaga','Lubya'),('rubaga','Mapeera'),('rubaga','Nabulagala'),('rubaga','Kasubi'),('rubaga','Mutundwe'),('rubaga','Kawaala'),('rubaga','Lugala'),('rubaga','Ndeeba'),
('kawempe','Makerere'),('kawempe','Wandegeya'),('kawempe','Bwaise'),('kawempe','Ttula'),('kawempe','Mpererwe'),('kawempe','Kyebando'),('kawempe','Kirokole'),('kawempe','Mbogo'),('kawempe','Kazo ward'),('kawempe','Nammere'),('kawempe','Kitala'),('kawempe','Mulago'),('kawempe','Kawempe'),('kawempe','Keti Falawo'),('kawempe','Kanyanya'),('kawempe','Kakungulu'),('kawempe','Kalerwe'),('kawempe','Sir. Apollo'),('kawempe','Kikaaya'),('kawempe','Komamboga'),
('nakawa','Banda'),('nakawa','Nakawa'),('nakawa','Luzira'),('nakawa','Mutungo'),('nakawa','Naguru'),('nakawa','Kiswa'),('nakawa','Mulimira'),('nakawa','Ntinda'),('nakawa','Bugoloobi'),('nakawa','Butabika'),('nakawa','Kinawataka'),('nakawa','Mbuya'),('nakawa','Bbiina'),('nakawa','Bukoto'),('nakawa','Kyanja'),('nakawa','Kyambogo'),('nakawa','Nabisunsa'),('nakawa','Kisaasi')
) AS area(division_code,name)
JOIN kampala_divisions division ON division.code=area.division_code
ON CONFLICT DO NOTHING;

ALTER TABLE waste_zones ADD COLUMN IF NOT EXISTS catalog_area_id UUID REFERENCES kampala_division_areas(id);
CREATE UNIQUE INDEX IF NOT EXISTS one_catalog_area_zone_per_organization
  ON waste_zones(organization_id,catalog_area_id) WHERE organization_id IS NOT NULL AND catalog_area_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_zone_catalog_division() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.catalog_area_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM kampala_division_areas area
    WHERE area.id=NEW.catalog_area_id AND area.division_id=NEW.division_id AND area.is_active
  ) THEN RAISE EXCEPTION 'The selected area does not belong to this division'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_zone_catalog_division ON waste_zones;
CREATE TRIGGER trg_zone_catalog_division BEFORE INSERT OR UPDATE OF division_id,catalog_area_id ON waste_zones
FOR EACH ROW EXECUTE FUNCTION enforce_zone_catalog_division();
