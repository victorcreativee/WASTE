-- Keep every close and reopen action. The current state remains on
-- recycling_daily_closures; this table is the immutable audit history.
CREATE TABLE IF NOT EXISTS recycling_daily_closure_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  closure_id uuid NOT NULL REFERENCES recycling_daily_closures(id) ON DELETE CASCADE,
  operating_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('closed', 'reopened')),
  actor_user_id uuid NOT NULL,
  reason text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  migration_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recycling_closure_event_actor_tenant_fkey
    FOREIGN KEY (actor_user_id, organization_id) REFERENCES users(id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_recycling_closure_events_org_day
  ON recycling_daily_closure_events (organization_id, operating_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recycling_closure_events_closure
  ON recycling_daily_closure_events (closure_id, created_at DESC);

-- Preserve the currently available history when upgrading an existing database.
INSERT INTO recycling_daily_closure_events (
  organization_id, closure_id, operating_date, action, actor_user_id,
  reason, snapshot, migration_key, created_at
)
SELECT organization_id, id, operating_date, 'closed', closed_by,
       notes, snapshot, 'legacy-close:' || id::text, closed_at
FROM recycling_daily_closures
ON CONFLICT (migration_key) DO NOTHING;

INSERT INTO recycling_daily_closure_events (
  organization_id, closure_id, operating_date, action, actor_user_id,
  reason, snapshot, migration_key, created_at
)
SELECT organization_id, id, operating_date, 'reopened', reopened_by,
       reopen_reason, snapshot, 'legacy-reopen:' || id::text, reopened_at
FROM recycling_daily_closures
WHERE reopened_by IS NOT NULL AND reopened_at IS NOT NULL
ON CONFLICT (migration_key) DO NOTHING;

-- Audit rows are append-only. Corrections are represented by another event.
CREATE OR REPLACE FUNCTION prevent_recycling_closure_event_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_audit_reset', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Daily closure audit history is append-only'
    USING ERRCODE='check_violation';
END $$;

DROP TRIGGER IF EXISTS prevent_recycling_closure_event_update ON recycling_daily_closure_events;
CREATE TRIGGER prevent_recycling_closure_event_update
  BEFORE UPDATE OR DELETE ON recycling_daily_closure_events
  FOR EACH ROW EXECUTE FUNCTION prevent_recycling_closure_event_change();

ALTER TABLE recycling_daily_closure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recycling_daily_closure_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kwms_tenant ON recycling_daily_closure_events;
CREATE POLICY kwms_tenant ON recycling_daily_closure_events
  USING (kwms_tenant_sees(organization_id))
  WITH CHECK (kwms_tenant_sees(organization_id));
