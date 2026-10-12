ALTER TABLE recycling_material_lots
  ADD COLUMN IF NOT EXISTS collection_latitude numeric(10,7),
  ADD COLUMN IF NOT EXISTS collection_longitude numeric(10,7),
  ADD COLUMN IF NOT EXISTS collection_accuracy_m numeric(10,2);

ALTER TABLE recycling_material_lots DROP CONSTRAINT IF EXISTS recycling_material_lots_collection_latitude_check;
ALTER TABLE recycling_material_lots ADD CONSTRAINT recycling_material_lots_collection_latitude_check CHECK (collection_latitude IS NULL OR collection_latitude BETWEEN -90 AND 90);
ALTER TABLE recycling_material_lots DROP CONSTRAINT IF EXISTS recycling_material_lots_collection_longitude_check;
ALTER TABLE recycling_material_lots ADD CONSTRAINT recycling_material_lots_collection_longitude_check CHECK (collection_longitude IS NULL OR collection_longitude BETWEEN -180 AND 180);
ALTER TABLE recycling_material_lots DROP CONSTRAINT IF EXISTS recycling_material_lots_collection_accuracy_check;
ALTER TABLE recycling_material_lots ADD CONSTRAINT recycling_material_lots_collection_accuracy_check CHECK (collection_accuracy_m IS NULL OR collection_accuracy_m >= 0);
