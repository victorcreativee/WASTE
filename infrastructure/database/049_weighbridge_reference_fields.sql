ALTER TABLE weighbridge_transactions
  ADD COLUMN IF NOT EXISTS facility_code VARCHAR(20) NOT NULL DEFAULT 'BUYALA',
  ADD COLUMN IF NOT EXISTS shift VARCHAR(50),
  ADD COLUMN IF NOT EXISTS normalized_registration VARCHAR(50),
  ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS origin_area VARCHAR(120),
  ADD COLUMN IF NOT EXISTS operator_category VARCHAR(80),
  ADD COLUMN IF NOT EXISTS division VARCHAR(80),
  ADD COLUMN IF NOT EXISTS driver_phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS vehicle_matched BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS driver_matched BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tare_capture_mode VARCHAR(30) NOT NULL DEFAULT 'second_weighing';

UPDATE weighbridge_transactions
SET normalized_registration=UPPER(REGEXP_REPLACE(registration,'[^A-Za-z0-9]','','g'))
WHERE normalized_registration IS NULL;

ALTER TABLE weighbridge_transactions ALTER COLUMN normalized_registration SET NOT NULL;
ALTER TABLE weighbridge_transactions DROP CONSTRAINT IF EXISTS weighbridge_tare_capture_mode_check;
ALTER TABLE weighbridge_transactions ADD CONSTRAINT weighbridge_tare_capture_mode_check
  CHECK(tare_capture_mode IN('stored_vehicle_tare','second_weighing','unconfirmed'));
CREATE INDEX IF NOT EXISTS weighbridge_registration_lookup ON weighbridge_transactions(normalized_registration,operation_date DESC);
