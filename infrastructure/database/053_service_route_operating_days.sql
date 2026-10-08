ALTER TABLE service_routes
  ADD COLUMN IF NOT EXISTS operating_days SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::SMALLINT[];

ALTER TABLE service_routes DROP CONSTRAINT IF EXISTS service_routes_operating_days_valid;
ALTER TABLE service_routes ADD CONSTRAINT service_routes_operating_days_valid CHECK (
  cardinality(operating_days) > 0
  AND operating_days <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]
);

COMMENT ON COLUMN service_routes.operating_days IS
  'ISO weekdays when the reusable route is due: Monday=1 through Sunday=7.';
