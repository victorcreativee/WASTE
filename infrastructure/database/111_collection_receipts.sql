-- Electronic collection receipts (KCCA receipting mandate; concept note KWMS-CN-001, module 3).
-- Every household stop marked collected gets a server-issued receipt with a serial number, in the same transaction.
-- Receipts, voids and daily exports are append-only: rows can be added but never changed or deleted. Each operator's
-- receipts form a hash chain (each record hash covers the previous one), so any later edit made with the triggers
-- switched off is detectable with verify_collection_receipt_chain(). Receipts copy the names, phone and address at the
-- moment of collection and keep plain ids, so later edits or deletions elsewhere never alter or block a receipt.
-- Receipts start from this migration; past collections are not backfilled. Requires 028, 098 and 108.

-- One platform-wide serial format, set by KCCA. Tokens: {ORG} operator code, {YYYY}/{YY} year, {MM} month, {DD} day,
-- {SEQ4}..{SEQ9} the operator's yearly sequence padded to that many digits. Sequences restart each year, so the year
-- and the operator code must be in the format to keep serials unique.
CREATE TABLE IF NOT EXISTS receipt_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  serial_format VARCHAR(60) NOT NULL DEFAULT '{ORG}-{YYYY}-{SEQ7}'
    CHECK (serial_format LIKE '%{ORG}%' AND serial_format ~ '\{(YYYY|YY)\}' AND serial_format ~ '\{SEQ[4-9]\}'
      AND serial_format ~ '^[A-Za-z0-9{}_-]+$'),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO receipt_settings(id) VALUES (true) ON CONFLICT DO NOTHING;

-- Each operator's receipt code (the {ORG} part) and the head of its hash chain.
CREATE TABLE IF NOT EXISTS receipt_series (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id),
  code VARCHAR(8) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,8}$'),
  last_position BIGINT NOT NULL DEFAULT 0,
  last_hash CHAR(64),
  first_issued_on DATE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receipt_counters (
  organization_id UUID NOT NULL REFERENCES receipt_series(organization_id),
  period_year INTEGER NOT NULL,
  last_number BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, period_year)
);

CREATE TABLE IF NOT EXISTS collection_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  serial_number VARCHAR(60) NOT NULL UNIQUE,
  chain_position BIGINT NOT NULL,
  period_year INTEGER NOT NULL,
  sequence_number BIGINT NOT NULL,
  stop_id UUID NOT NULL UNIQUE,
  collection_job_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  service_location_id UUID NOT NULL,
  collected_by UUID,
  collected_at TIMESTAMPTZ NOT NULL,
  collected_weight_kg NUMERIC(12,2),
  company_name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  location_label TEXT NOT NULL,
  address TEXT NOT NULL,
  zone_name TEXT,
  truck_plate TEXT,
  driver_name TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  previous_hash CHAR(64),
  record_hash CHAR(64) NOT NULL,
  UNIQUE (organization_id, chain_position),
  UNIQUE (organization_id, period_year, sequence_number)
);
CREATE INDEX IF NOT EXISTS collection_receipts_org_issued ON collection_receipts(organization_id, issued_at DESC, id);
CREATE INDEX IF NOT EXISTS collection_receipts_customer ON collection_receipts(customer_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS collection_receipts_issued ON collection_receipts(issued_at);

-- A receipt issued in error stays in the ledger; a void records why it no longer counts.
CREATE TABLE IF NOT EXISTS collection_receipt_voids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id UUID NOT NULL UNIQUE REFERENCES collection_receipts(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
  voided_by UUID NOT NULL,
  voided_by_name TEXT NOT NULL,
  voided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS collection_receipt_voids_org ON collection_receipt_voids(organization_id, voided_at);

-- One signed file per operator per Kampala day: every receipt issued and void recorded that day.
CREATE TABLE IF NOT EXISTS collection_receipt_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  export_date DATE NOT NULL,
  receipt_count INTEGER NOT NULL,
  void_count INTEGER NOT NULL,
  first_serial TEXT,
  last_serial TEXT,
  chain_head_hash CHAR(64),
  content TEXT NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  signature TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  signing_public_key TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, export_date)
);
CREATE INDEX IF NOT EXISTS collection_receipt_exports_date ON collection_receipt_exports(export_date DESC);

CREATE OR REPLACE FUNCTION reject_receipt_ledger_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: receipts, voids and exports cannot be changed or deleted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['collection_receipts','collection_receipt_voids','collection_receipt_exports'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_receipt_ledger_change()', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_no_truncate ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_receipt_ledger_change()', t, t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION format_receipt_serial(p_format TEXT, p_code TEXT, p_at TIMESTAMPTZ, p_sequence BIGINT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE local_time TIMESTAMP := p_at AT TIME ZONE 'Africa/Kampala'; result TEXT := p_format; width INTEGER;
BEGIN
  width := substring(p_format FROM '\{SEQ([4-9])\}')::INTEGER;
  result := replace(result, '{ORG}', p_code);
  result := replace(result, '{YYYY}', to_char(local_time, 'YYYY'));
  result := replace(result, '{YY}', to_char(local_time, 'YY'));
  result := replace(result, '{MM}', to_char(local_time, 'MM'));
  result := replace(result, '{DD}', to_char(local_time, 'DD'));
  RETURN regexp_replace(result, '\{SEQ[4-9]\}', lpad(p_sequence::TEXT, greatest(width, length(p_sequence::TEXT)), '0'));
END $$;

-- The exact text each record hash covers. Changing it would break every existing chain, so it never changes.
CREATE OR REPLACE FUNCTION collection_receipt_payload(r collection_receipts) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT array_to_string(ARRAY[
    r.serial_number, r.organization_id::TEXT, r.chain_position::TEXT, r.stop_id::TEXT, r.collection_job_id::TEXT,
    r.customer_id::TEXT, r.service_location_id::TEXT, COALESCE(r.collected_by::TEXT, ''),
    to_char(r.collected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), COALESCE(r.collected_weight_kg::TEXT, ''),
    r.company_name, r.customer_name, COALESCE(r.customer_phone, ''), r.location_label, r.address, COALESCE(r.zone_name, ''),
    COALESCE(r.truck_plate, ''), COALESCE(r.driver_name, ''), to_char(r.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ], '|');
$$;

CREATE OR REPLACE FUNCTION collection_receipt_hash(p_previous TEXT, p_payload TEXT) RETURNS CHAR(64) LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(COALESCE(p_previous, 'GENESIS') || '|' || p_payload, 'UTF8')), 'hex');
$$;

-- A short code from the company name (initials, else the first letters), made unique with a number when taken.
CREATE OR REPLACE FUNCTION new_receipt_code(p_name TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE words TEXT[]; base TEXT; candidate TEXT; n INTEGER := 1;
BEGIN
  words := ARRAY(SELECT w FROM regexp_split_to_table(upper(regexp_replace(COALESCE(p_name, ''), '[^A-Za-z0-9 ]', ' ', 'g')), '\s+') w
                 WHERE w <> '' AND w NOT IN ('LTD','LIMITED','CO','COMPANY','THE','AND','OF','U','UGANDA','SMC'));
  IF array_length(words, 1) >= 2 THEN base := left(array_to_string(ARRAY(SELECT left(w, 1) FROM unnest(words) w), ''), 5);
  ELSE base := left(COALESCE(words[1], ''), 4); END IF;
  IF length(base) < 2 THEN base := rpad(base, 2, 'X'); END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM receipt_series WHERE code = candidate) LOOP
    n := n + 1; candidate := left(base, 8 - length(n::TEXT)) || n::TEXT;
  END LOOP;
  RETURN candidate;
END $$;

-- Issues the receipt for a completed household stop, or returns the one already issued.
CREATE OR REPLACE FUNCTION issue_collection_receipt(p_stop_id UUID) RETURNS collection_receipts LANGUAGE plpgsql AS $$
DECLARE s RECORD; series receipt_series; fmt TEXT; yr INTEGER; seq BIGINT; r collection_receipts; note_id UUID;
BEGIN
  SELECT * INTO r FROM collection_receipts WHERE stop_id = p_stop_id;
  IF FOUND THEN RETURN r; END IF;

  SELECT st.id, st.organization_id, st.collection_job_id, st.customer_id, st.service_location_id, st.completed_by,
         COALESCE(st.completed_at, CURRENT_TIMESTAMP) AS completed_at, st.collected_weight_kg, o.name AS company_name,
         u.id AS customer_user_id, u.full_name AS customer_name, NULLIF(btrim(u.phone), '') AS customer_phone,
         l.label AS location_label, l.address, wz.name AS zone_name, t.plate_number, d.full_name AS driver_name
    INTO s
    FROM customer_collection_stops st
    JOIN organizations o ON o.id = st.organization_id
    JOIN customer_profiles cp ON cp.id = st.customer_id JOIN users u ON u.id = cp.user_id
    JOIN customer_service_locations l ON l.id = st.service_location_id
    JOIN collection_jobs cj ON cj.id = st.collection_job_id
    LEFT JOIN waste_zones wz ON wz.id = cj.zone_id
    LEFT JOIN waste_trucks t ON t.id = cj.truck_id
    LEFT JOIN drivers d ON d.id = cj.driver_id
   WHERE st.id = p_stop_id AND st.status = 'completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a completed household stop can be receipted'; END IF;

  INSERT INTO receipt_series(organization_id, code) VALUES (s.organization_id, new_receipt_code(s.company_name))
    ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO series FROM receipt_series WHERE organization_id = s.organization_id FOR UPDATE;
  SELECT serial_format INTO fmt FROM receipt_settings;

  yr := extract(YEAR FROM s.completed_at AT TIME ZONE 'Africa/Kampala');
  INSERT INTO receipt_counters(organization_id, period_year, last_number) VALUES (s.organization_id, yr, 1)
    ON CONFLICT (organization_id, period_year) DO UPDATE SET last_number = receipt_counters.last_number + 1
    RETURNING last_number INTO seq;

  r.id := uuid_generate_v4();
  r.organization_id := s.organization_id;
  r.serial_number := format_receipt_serial(fmt, series.code, s.completed_at, seq);
  r.chain_position := series.last_position + 1;
  r.period_year := yr;
  r.sequence_number := seq;
  r.stop_id := s.id;
  r.collection_job_id := s.collection_job_id;
  r.customer_id := s.customer_id;
  r.service_location_id := s.service_location_id;
  r.collected_by := s.completed_by;
  r.collected_at := date_trunc('milliseconds', s.completed_at);
  r.collected_weight_kg := s.collected_weight_kg;
  r.company_name := s.company_name;
  r.customer_name := s.customer_name;
  r.customer_phone := s.customer_phone;
  r.location_label := s.location_label;
  r.address := s.address;
  r.zone_name := s.zone_name;
  r.truck_plate := s.plate_number;
  r.driver_name := s.driver_name;
  r.issued_at := date_trunc('milliseconds', clock_timestamp());
  r.previous_hash := series.last_hash;
  r.record_hash := collection_receipt_hash(series.last_hash, collection_receipt_payload(r));
  INSERT INTO collection_receipts SELECT r.*;

  UPDATE receipt_series SET last_position = r.chain_position, last_hash = r.record_hash,
         first_issued_on = COALESCE(first_issued_on, (r.issued_at AT TIME ZONE 'Africa/Kampala')::DATE), updated_at = CURRENT_TIMESTAMP
   WHERE organization_id = s.organization_id;

  -- The receipt reaches the household on /my and, when it has a phone number, by SMS. Unlike reminders this is not
  -- optional for the company or the household: the mandate is that every collection is receipted to the client.
  INSERT INTO notifications(recipient_user_id, organization_id, category, severity, title, body, link, dedupe_key)
  VALUES (s.customer_user_id, s.organization_id, 'household', 'info', 'Collection receipt',
          left(s.company_name || ': waste collected ' || to_char(r.collected_at AT TIME ZONE 'Africa/Kampala', 'FMDD Mon YYYY HH24:MI')
            || ' at ' || s.location_label || COALESCE(', ' || rtrim(rtrim(to_char(r.collected_weight_kg, 'FM999,990.00'), '0'), '.') || ' kg', '')
            || '. Receipt ' || r.serial_number || '.', 2000),
          '/r/' || r.serial_number, 'collection-receipt:' || r.id)
  ON CONFLICT (recipient_user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO note_id;
  IF note_id IS NOT NULL AND s.customer_phone IS NOT NULL THEN
    INSERT INTO notification_deliveries(notification_id, channel, destination) VALUES (note_id, 'sms', s.customer_phone);
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION issue_receipt_on_collection() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM issue_collection_receipt(NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_issue_collection_receipt ON customer_collection_stops;
CREATE TRIGGER trg_issue_collection_receipt AFTER INSERT OR UPDATE OF status ON customer_collection_stops
  FOR EACH ROW EXECUTE FUNCTION issue_receipt_on_collection();

-- Recomputes an operator's chain. Returns how many receipts were checked and the first one whose hash or link to the
-- previous receipt does not match (NULL when the whole chain is intact).
CREATE OR REPLACE FUNCTION verify_collection_receipt_chain(p_organization_id UUID)
RETURNS TABLE(checked BIGINT, first_broken_serial TEXT, first_broken_position BIGINT) LANGUAGE plpgsql STABLE AS $$
DECLARE r collection_receipts; expected_previous TEXT := NULL; expected_position BIGINT := 0;
BEGIN
  checked := 0;
  FOR r IN SELECT * FROM collection_receipts WHERE organization_id = p_organization_id ORDER BY chain_position LOOP
    expected_position := expected_position + 1;
    IF r.chain_position <> expected_position OR r.previous_hash IS DISTINCT FROM expected_previous
       OR r.record_hash <> collection_receipt_hash(r.previous_hash, collection_receipt_payload(r)) THEN
      first_broken_serial := r.serial_number; first_broken_position := r.chain_position; RETURN NEXT; RETURN;
    END IF;
    expected_previous := r.record_hash;
    checked := checked + 1;
  END LOOP;
  IF expected_previous IS DISTINCT FROM (SELECT last_hash FROM receipt_series WHERE organization_id = p_organization_id)
     AND checked > 0 THEN
    first_broken_serial := 'chain head'; first_broken_position := checked;
  END IF;
  RETURN NEXT;
END $$;
