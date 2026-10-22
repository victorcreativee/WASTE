-- Module 4: issued KCCA city reports. An issued report is a frozen, numbered snapshot of the figures as published,
-- so official numbers do not shift when operational data is corrected later. Additive and idempotent.

CREATE TABLE IF NOT EXISTS city_reports(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 report_number TEXT UNIQUE NOT NULL,
 period_type TEXT NOT NULL CHECK(period_type IN('month','quarter')),
 period_key TEXT NOT NULL CHECK(period_key ~ '^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$'),
 period_from DATE NOT NULL,
 period_to DATE NOT NULL,
 title TEXT NOT NULL,
 data JSONB NOT NULL,
 commentary TEXT,
 status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN('issued','superseded')),
 issued_by UUID NOT NULL REFERENCES users(id),
 issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 superseded_by UUID REFERENCES city_reports(id) DEFERRABLE INITIALLY DEFERRED,
 superseded_reason TEXT,
 superseded_at TIMESTAMPTZ,
 CHECK(period_to>=period_from),
 CHECK(status<>'superseded' OR (superseded_by IS NOT NULL AND superseded_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_issued_city_report_per_period ON city_reports(period_key) WHERE status='issued';
CREATE INDEX IF NOT EXISTS idx_city_reports_issued ON city_reports(issued_at DESC);

-- Published content is frozen; the only permitted change is marking an issued report as superseded.
CREATE OR REPLACE FUNCTION protect_issued_city_report() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issued city reports cannot be deleted' USING ERRCODE='P0001'; END IF;
  IF NEW.data IS DISTINCT FROM OLD.data OR NEW.commentary IS DISTINCT FROM OLD.commentary OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.period_key IS DISTINCT FROM OLD.period_key OR NEW.period_from IS DISTINCT FROM OLD.period_from OR NEW.period_to IS DISTINCT FROM OLD.period_to
     OR NEW.report_number IS DISTINCT FROM OLD.report_number OR NEW.issued_by IS DISTINCT FROM OLD.issued_by OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR OLD.status='superseded' THEN
    RAISE EXCEPTION 'An issued city report cannot be changed; issue a replacement instead' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_protect_city_report ON city_reports;
CREATE TRIGGER trg_protect_city_report BEFORE UPDATE OR DELETE ON city_reports
FOR EACH ROW WHEN (pg_trigger_depth()=0) EXECUTE FUNCTION protect_issued_city_report();

-- Period queries used by the report.
CREATE INDEX IF NOT EXISTS idx_citizen_issues_created_on ON citizen_issues((created_at::date));
CREATE INDEX IF NOT EXISTS idx_collection_jobs_job_date ON collection_jobs(job_date,status);
CREATE INDEX IF NOT EXISTS idx_permit_history_created ON organization_permit_history(created_at);
