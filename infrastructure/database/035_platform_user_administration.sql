CREATE TABLE IF NOT EXISTS platform_administration_events(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),actor_id UUID NOT NULL REFERENCES users(id),action TEXT NOT NULL,
 target_user_id UUID REFERENCES users(id),details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_platform_admin_events_time ON platform_administration_events(created_at DESC,id);
CREATE OR REPLACE FUNCTION prevent_platform_event_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Platform administration events cannot be changed or deleted'; END $$;
DROP TRIGGER IF EXISTS trg_immutable_platform_events ON platform_administration_events;
CREATE TRIGGER trg_immutable_platform_events BEFORE UPDATE OR DELETE ON platform_administration_events FOR EACH ROW EXECUTE FUNCTION prevent_platform_event_mutation();
