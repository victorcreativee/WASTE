BEGIN;

ALTER TABLE organization_expenses
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS source_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_source
  ON organization_expenses(organization_id, source_type, source_id);

-- No historical backfill: existing fleet costs may already have manual expenses.
CREATE OR REPLACE FUNCTION record_fleet_expense() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  expense_category TEXT;
  source_kind TEXT;
  actor UUID;
  expense_vendor TEXT;
  recorded_date DATE;
  description_text TEXT;
BEGIN
  IF NEW.cost_ugx <= 0 THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'truck_fuel_records' THEN
    expense_category := 'fuel';
    source_kind := 'fleet_fuel';
    actor := NEW.recorded_by;
    expense_vendor := NEW.station;
    recorded_date := NEW.fuel_date;
    description_text := 'Fleet fuel: ' || NEW.litres || ' litres';
  ELSE
    IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'completed' THEN RETURN NEW; END IF;
    END IF;
    expense_category := 'maintenance';
    source_kind := 'fleet_maintenance';
    actor := NEW.created_by;
    expense_vendor := NEW.service_provider;
    recorded_date := COALESCE(NEW.completed_at::date, CURRENT_DATE);
    description_text := 'Fleet maintenance: ' || NEW.title;
  END IF;
  INSERT INTO organization_expenses(
    organization_id, expense_number, category, description, vendor,
    amount_ugx, expense_date, reference, created_by, source_type, source_id
  ) VALUES (
    NEW.organization_id, 'FLT-' || NEW.id::text, expense_category,
    LEFT(description_text, 240), expense_vendor, NEW.cost_ugx, recorded_date,
    source_kind || ':' || NEW.id::text, actor, source_kind, NEW.id
  ) ON CONFLICT (organization_id, source_type, source_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='fuel_expense_created' AND tgrelid='truck_fuel_records'::regclass) THEN
    CREATE TRIGGER fuel_expense_created AFTER INSERT ON truck_fuel_records
      FOR EACH ROW EXECUTE FUNCTION record_fleet_expense();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='maintenance_expense_created' AND tgrelid='truck_maintenance_records'::regclass) THEN
    CREATE TRIGGER maintenance_expense_created AFTER INSERT OR UPDATE OF status ON truck_maintenance_records
      FOR EACH ROW EXECUTE FUNCTION record_fleet_expense();
  END IF;
END $$;
COMMIT;
