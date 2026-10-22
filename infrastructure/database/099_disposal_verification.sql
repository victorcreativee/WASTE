-- Module 8: disposal verification — every completed collection trip should end at a KCCA weighbridge. A registry of
-- disposal facilities, company explanations for trips without a ticket (reviewed by KCCA), KCCA acceptance of tickets
-- that belong to no trip, and the facts each trip's disposal state is derived from. Additive and idempotent. Requires 092–098.

CREATE TABLE IF NOT EXISTS disposal_facilities(
 code VARCHAR(20) PRIMARY KEY CHECK(length(code) BETWEEN 2 AND 20),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
 kind TEXT NOT NULL CHECK(kind IN('landfill','transfer_station','composting','materials_recovery')),
 is_active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO disposal_facilities(code,name,kind) VALUES
 ('BUYALA','Buyala Waste Management Facility','landfill'),
 ('KITEEZI','Kiteezi Landfill','landfill')
ON CONFLICT(code) DO NOTHING;
-- Facilities already named on weighbridge tickets join the registry so the reference below is valid.
INSERT INTO disposal_facilities(code,name,kind)
SELECT facility_code,left(max(facility),160),'landfill' FROM weighbridge_transactions GROUP BY facility_code
ON CONFLICT(code) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='weighbridge_facility_registered') THEN
    ALTER TABLE weighbridge_transactions ADD CONSTRAINT weighbridge_facility_registered FOREIGN KEY(facility_code) REFERENCES disposal_facilities(code);
  END IF;
END $$;

-- New tickets must name an active facility; the facility name always comes from the registry.
CREATE OR REPLACE FUNCTION weighbridge_ticket_facility() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE facility RECORD;
BEGIN
  SELECT name,is_active INTO facility FROM disposal_facilities WHERE code=NEW.facility_code;
  IF NOT FOUND OR NOT facility.is_active THEN RAISE EXCEPTION 'Choose an active disposal facility'; END IF;
  NEW.facility := facility.name;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_weighbridge_ticket_facility ON weighbridge_transactions;
CREATE TRIGGER trg_weighbridge_ticket_facility BEFORE INSERT ON weighbridge_transactions FOR EACH ROW EXECUTE FUNCTION weighbridge_ticket_facility();

-- A ticket that belongs to no collection trip (an ad-hoc load, a vehicle hired for a day) is accepted by KCCA with a reason.
ALTER TABLE weighbridge_transactions
  ADD COLUMN IF NOT EXISTS no_trip_reason TEXT,
  ADD COLUMN IF NOT EXISTS no_trip_accepted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS no_trip_accepted_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='weighbridge_no_trip_acceptance') THEN
    ALTER TABLE weighbridge_transactions ADD CONSTRAINT weighbridge_no_trip_acceptance CHECK(
      (no_trip_accepted_at IS NULL AND no_trip_accepted_by IS NULL AND no_trip_reason IS NULL)
      OR (no_trip_accepted_at IS NOT NULL AND no_trip_accepted_by IS NOT NULL AND length(no_trip_reason)>=5 AND trip_id IS NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_weighbridge_unlinked ON weighbridge_transactions(organization_id,operation_date)
  WHERE trip_id IS NULL AND status='completed' AND no_trip_accepted_at IS NULL;

-- A company's explanation for a completed trip without a weighbridge ticket. KCCA accepts or rejects it once; a rejected
-- explanation can be followed by a new one.
CREATE TABLE IF NOT EXISTS trip_disposal_explanations(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 trip_id UUID NOT NULL REFERENCES collection_routes(id) ON DELETE CASCADE,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 reason TEXT NOT NULL CHECK(reason IN('no_load','delivered_elsewhere','vehicle_breakdown','combined_load','weighbridge_unavailable','other')),
 details TEXT NOT NULL CHECK(length(details) BETWEEN 5 AND 2000),
 related_ticket_id UUID REFERENCES weighbridge_transactions(id),
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','accepted','rejected')),
 submitted_by UUID NOT NULL REFERENCES users(id),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_by UUID REFERENCES users(id),
 reviewed_at TIMESTAMPTZ,
 review_note TEXT,
 CHECK((status='submitted')=(reviewed_at IS NULL)),
 CHECK(status<>'rejected' OR length(review_note)>=5),
 CHECK(reason<>'combined_load' OR related_ticket_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_explanation_per_trip ON trip_disposal_explanations(trip_id) WHERE status IN('submitted','accepted');
CREATE INDEX IF NOT EXISTS idx_disposal_explanations_review ON trip_disposal_explanations(submitted_at) WHERE status='submitted';

-- Explanations are filed by the trip's own company for a completed trip; a combined load names a completed ticket of the
-- same company; once reviewed, an explanation never changes.
CREATE OR REPLACE FUNCTION guard_trip_disposal_explanation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'submitted' THEN RAISE EXCEPTION 'A reviewed explanation cannot be changed'; END IF;
    IF NEW.trip_id<>OLD.trip_id OR NEW.organization_id<>OLD.organization_id OR NEW.reason<>OLD.reason OR NEW.details<>OLD.details
       OR NEW.related_ticket_id IS DISTINCT FROM OLD.related_ticket_id OR NEW.submitted_by<>OLD.submitted_by THEN
      RAISE EXCEPTION 'Only the review of an explanation can be recorded';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM collection_routes WHERE id=NEW.trip_id AND organization_id=NEW.organization_id AND status='completed') THEN
    RAISE EXCEPTION 'Only a completed trip of your company can be explained';
  END IF;
  IF NEW.related_ticket_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM weighbridge_transactions WHERE id=NEW.related_ticket_id AND organization_id=NEW.organization_id AND status='completed') THEN
    RAISE EXCEPTION 'The related ticket must be a completed weighbridge ticket of your company';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_trip_disposal_explanation ON trip_disposal_explanations;
CREATE TRIGGER trg_guard_trip_disposal_explanation BEFORE INSERT OR UPDATE ON trip_disposal_explanations FOR EACH ROW EXECUTE FUNCTION guard_trip_disposal_explanation();

-- One row per completed collection trip with what its disposal state is derived from: the latest live KCCA ticket, the
-- ticket number the company typed itself (when no KCCA ticket is linked) and the latest explanation.
CREATE OR REPLACE VIEW trip_disposal_facts AS
SELECT r.id AS trip_id,r.organization_id,r.trip_number,r.route_date,
  COALESCE(r.completed_at,r.route_date::timestamp+interval '1 day') AS completed_at,
  r.truck_id,t.plate_number,
  w.id AS ticket_id,w.ticket_number,w.status AS ticket_status,w.net_kg,w.facility_code,w.facility,
  CASE WHEN w.id IS NULL THEN r.weighbridge_ticket_number END AS declared_ticket,
  CASE WHEN w.id IS NULL THEN r.verified_weight_kg END AS declared_kg,
  e.id AS explanation_id,e.status AS explanation_status,e.reason AS explanation_reason,e.details AS explanation_details,
  e.review_note AS explanation_review_note
FROM collection_routes r
LEFT JOIN waste_trucks t ON t.id=r.truck_id
LEFT JOIN LATERAL(SELECT * FROM weighbridge_transactions w WHERE w.trip_id=r.id AND w.status<>'voided' ORDER BY w.created_at DESC LIMIT 1) w ON true
LEFT JOIN LATERAL(SELECT * FROM trip_disposal_explanations e WHERE e.trip_id=r.id ORDER BY e.submitted_at DESC LIMIT 1) e ON true
WHERE r.status='completed' AND r.service_route_id IS NOT NULL;

-- Disposal notices are their own notification category.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK(category IN('permit','renewal','returns','compliance','custody','disposal','system'));
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check CHECK(category IN('permit','renewal','returns','compliance','custody','disposal','system'));
