-- Module 10: fines and penalties — a published penalty schedule, penalty notices to licensed companies (linked to the
-- dumping site, compliance case or monthly return they arise from), one appeal per notice, payment submitted by the
-- company and confirmed by KCCA, and escalation to permit suspension. Additive and idempotent. Requires 092–100.

-- Amounts are placeholders until KCCA confirms its schedule; KCCA can change them (each change is recorded).
CREATE TABLE IF NOT EXISTS penalty_schedule(
 code TEXT PRIMARY KEY CHECK(code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 200),
 description TEXT NOT NULL,
 amount_ugx BIGINT NOT NULL CHECK(amount_ugx>0),
 repeat_amount_ugx BIGINT NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT true,
 updated_by UUID REFERENCES users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(repeat_amount_ugx>=amount_ugx)
);
INSERT INTO penalty_schedule(code,title,description,amount_ugx,repeat_amount_ugx) VALUES
 ('DUMPING_ATTRIBUTED','Illegal dumping by a licensed operator','Waste dumped at an unauthorized site, attributed to the company on evidence recorded by KCCA.',2000000,5000000),
 ('CLEANUP_NOT_DONE','Cleanup order not met','A dumping cleanup ordered by KCCA was not completed by its deadline.',1000000,2500000),
 ('RETURN_LATE','Monthly return not filed on time','The statutory monthly return was not filed by the 15th of the following month.',200000,500000),
 ('UNVERIFIED_DISPOSAL','Collection trips without verified disposal','Completed collection trips not weighed at a KCCA facility nor explained to KCCA''s satisfaction.',500000,1500000),
 ('COMPLIANCE_UNANSWERED','Compliance notice not acted on','The required action in a KCCA compliance notice was not taken by its due date.',750000,2000000),
 ('OPERATING_OUTSIDE_PERMIT','Operating outside the permit','Services provided outside the activities or divisions the KCCA permit authorizes.',3000000,7500000)
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS penalty_schedule_history(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 code TEXT NOT NULL REFERENCES penalty_schedule(code),
 amount_ugx BIGINT NOT NULL,
 repeat_amount_ugx BIGINT NOT NULL,
 is_active BOOLEAN NOT NULL,
 changed_by UUID REFERENCES users(id),
 changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE IF NOT EXISTS penalty_notice_number_seq;

CREATE TABLE IF NOT EXISTS penalty_notices(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 notice_number TEXT NOT NULL UNIQUE DEFAULT ('PN-'||to_char(CURRENT_DATE,'YYYY')||'-'||lpad(nextval('penalty_notice_number_seq')::text,5,'0')),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 schedule_code TEXT NOT NULL REFERENCES penalty_schedule(code),
 offence_number INTEGER NOT NULL DEFAULT 1 CHECK(offence_number>=1),
 original_amount_ugx BIGINT NOT NULL CHECK(original_amount_ugx>0),
 amount_ugx BIGINT NOT NULL CHECK(amount_ugx>0),
 grounds TEXT NOT NULL CHECK(length(grounds) BETWEEN 20 AND 4000),
 compliance_case_id UUID REFERENCES collector_compliance_cases(id),
 dumping_site_id UUID REFERENCES dumping_sites(id) ON DELETE SET NULL,
 return_period TEXT CHECK(return_period IS NULL OR return_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN('issued','appealed','payment_submitted','paid','waived')),
 issued_by UUID NOT NULL REFERENCES users(id),
 issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 appeal_deadline DATE NOT NULL,
 due_on DATE NOT NULL,
 payment_reference TEXT,
 paid_on DATE,
 payment_submitted_by UUID REFERENCES users(id),
 payment_submitted_at TIMESTAMPTZ,
 payment_confirmed_by UUID REFERENCES users(id),
 payment_confirmed_at TIMESTAMPTZ,
 waived_reason TEXT,
 escalated_at TIMESTAMPTZ,
 escalated_by UUID REFERENCES users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(amount_ugx<=original_amount_ugx),
 CHECK(status NOT IN('payment_submitted','paid') OR (payment_reference IS NOT NULL AND paid_on IS NOT NULL)),
 CHECK(status<>'paid' OR payment_confirmed_at IS NOT NULL),
 CHECK(status<>'waived' OR length(waived_reason)>=10)
);
CREATE INDEX IF NOT EXISTS idx_penalty_notices_org ON penalty_notices(organization_id,issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_penalty_notices_open ON penalty_notices(status,due_on) WHERE status IN('issued','appealed','payment_submitted');
-- The same offence is not fined twice (a withdrawn notice does not count).
CREATE UNIQUE INDEX IF NOT EXISTS one_penalty_per_dumping_site ON penalty_notices(schedule_code,dumping_site_id,organization_id) WHERE dumping_site_id IS NOT NULL AND status<>'waived';
CREATE UNIQUE INDEX IF NOT EXISTS one_penalty_per_return ON penalty_notices(organization_id,schedule_code,return_period) WHERE return_period IS NOT NULL AND status<>'waived';
CREATE UNIQUE INDEX IF NOT EXISTS one_penalty_per_compliance_case ON penalty_notices(schedule_code,compliance_case_id) WHERE compliance_case_id IS NOT NULL AND status<>'waived';

CREATE TABLE IF NOT EXISTS penalty_appeals(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 notice_id UUID NOT NULL UNIQUE REFERENCES penalty_notices(id) ON DELETE CASCADE,
 grounds TEXT NOT NULL CHECK(length(grounds) BETWEEN 20 AND 4000),
 submitted_by UUID NOT NULL REFERENCES users(id),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 decision TEXT CHECK(decision IN('upheld','reduced','withdrawn')),
 decision_note TEXT,
 decided_by UUID REFERENCES users(id),
 decided_at TIMESTAMPTZ,
 CHECK((decision IS NULL)=(decided_at IS NULL)),
 CHECK(decision IS NULL OR length(decision_note)>=10)
);

CREATE TABLE IF NOT EXISTS penalty_history(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 notice_id UUID NOT NULL REFERENCES penalty_notices(id) ON DELETE CASCADE,
 action TEXT NOT NULL CHECK(action IN('issued','appealed','appeal_upheld','appeal_reduced','appeal_withdrawn','payment_submitted','payment_rejected','paid','waived','escalated')),
 from_status TEXT,
 to_status TEXT NOT NULL,
 note TEXT,
 actor_user_id UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_penalty_history_notice ON penalty_history(notice_id,created_at);

CREATE OR REPLACE FUNCTION block_penalty_history_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Penalty history cannot be changed'; END $$;
DROP TRIGGER IF EXISTS trg_block_penalty_history_update ON penalty_history;
CREATE TRIGGER trg_block_penalty_history_update BEFORE UPDATE ON penalty_history FOR EACH ROW EXECUTE FUNCTION block_penalty_history_update();

-- Status moves follow the process; a paid or withdrawn notice is final; the company, offence and grounds never change;
-- the amount only goes down (an appeal reduction).
CREATE OR REPLACE FUNCTION guard_penalty_notice() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE allowed JSONB := '{"issued":["appealed","payment_submitted","paid","waived"],"appealed":["issued","waived"],"payment_submitted":["paid","issued"],"paid":[],"waived":[]}';
BEGIN
  IF NEW.status<>OLD.status AND NOT (allowed->OLD.status) ? NEW.status THEN
    RAISE EXCEPTION 'A penalty notice that is % cannot become %',replace(OLD.status,'_',' '),replace(NEW.status,'_',' ');
  END IF;
  IF NEW.organization_id<>OLD.organization_id OR NEW.schedule_code<>OLD.schedule_code OR NEW.grounds<>OLD.grounds
     OR NEW.original_amount_ugx<>OLD.original_amount_ugx OR NEW.issued_at<>OLD.issued_at THEN
    RAISE EXCEPTION 'The company, offence and grounds of a penalty notice cannot be changed';
  END IF;
  IF NEW.amount_ugx>OLD.amount_ugx THEN RAISE EXCEPTION 'A penalty can only be reduced'; END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_penalty_notice ON penalty_notices;
CREATE TRIGGER trg_guard_penalty_notice BEFORE UPDATE ON penalty_notices FOR EACH ROW EXECUTE FUNCTION guard_penalty_notice();

-- Penalty notices are their own notification category.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK(category IN('permit','renewal','returns','compliance','custody','disposal','dumping','penalties','system'));
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check CHECK(category IN('permit','renewal','returns','compliance','custody','disposal','dumping','penalties','system'));
