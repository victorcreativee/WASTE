-- Module 7: notifications — an in-app notification for each recipient, and an outbox of email/SMS deliveries sent by the
-- waste service's delivery worker. Additive and idempotent. Requires 092–097.

CREATE TABLE IF NOT EXISTS notifications(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 organization_id UUID REFERENCES organizations(id),
 category TEXT NOT NULL CHECK(category IN('permit','renewal','returns','compliance','custody','system')),
 severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN('info','warning','critical')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 link TEXT CHECK(link IS NULL OR link ~ '^/[A-Za-z0-9/_?=&.-]*$'),
 dedupe_key TEXT,
 read_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS one_notification_per_event ON notifications(recipient_user_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(recipient_user_id) WHERE read_at IS NULL;

-- Per-person channel choices by category: each flag allows or blocks a channel. Severity still decides whether a channel is
-- used at all (email for warnings and critical items, SMS for critical only). Without a row both channels are allowed.
CREATE TABLE IF NOT EXISTS notification_preferences(
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN('permit','renewal','returns','compliance','custody','system')),
 email BOOLEAN NOT NULL,
 sms BOOLEAN NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,category)
);

CREATE TABLE IF NOT EXISTS notification_deliveries(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN('email','sms')),
 destination TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','failed','skipped')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_error TEXT,
 provider TEXT,
 provider_message_id TEXT,
 sent_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(notification_id,channel)
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due ON notification_deliveries(next_attempt_at) WHERE status='pending';

-- Creates one notification (and its deliveries) for a user. Returns the notification id, or NULL when the same event was
-- already notified to that user (dedupe_key) or the user is not active.
CREATE OR REPLACE FUNCTION notify_user(p_user_id UUID,p_organization_id UUID,p_category TEXT,p_severity TEXT,p_title TEXT,p_body TEXT,p_link TEXT,p_dedupe_key TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE recipient RECORD; pref RECORD; new_id UUID; wants_email BOOLEAN; wants_sms BOOLEAN;
BEGIN
  SELECT id,email,phone,status INTO recipient FROM users WHERE id=p_user_id;
  IF NOT FOUND OR recipient.status<>'active' THEN RETURN NULL; END IF;
  INSERT INTO notifications(recipient_user_id,organization_id,category,severity,title,body,link,dedupe_key)
  VALUES(p_user_id,p_organization_id,p_category,p_severity,left(p_title,200),left(p_body,2000),p_link,p_dedupe_key)
  ON CONFLICT (recipient_user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO new_id;
  IF new_id IS NULL THEN RETURN NULL; END IF;
  SELECT email,sms INTO pref FROM notification_preferences WHERE user_id=p_user_id AND category=p_category;
  wants_email := COALESCE(pref.email,true) AND p_severity IN('warning','critical');
  wants_sms := COALESCE(pref.sms,true) AND p_severity='critical';
  IF wants_email AND recipient.email IS NOT NULL AND recipient.email<>'' THEN
    INSERT INTO notification_deliveries(notification_id,channel,destination) VALUES(new_id,'email',recipient.email);
  END IF;
  IF wants_sms AND recipient.phone IS NOT NULL AND recipient.phone<>'' THEN
    INSERT INTO notification_deliveries(notification_id,channel,destination) VALUES(new_id,'sms',recipient.phone);
  END IF;
  RETURN new_id;
END $$;

-- Notifies the active members of an organization who hold one of the given roles. Returns how many were notified.
CREATE OR REPLACE FUNCTION notify_organization(p_organization_id UUID,p_roles TEXT[],p_category TEXT,p_severity TEXT,p_title TEXT,p_body TEXT,p_link TEXT,p_dedupe_key TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE member RECORD; sent INTEGER := 0;
BEGIN
  IF p_organization_id IS NULL THEN RETURN 0; END IF;
  FOR member IN
    SELECT DISTINCT u.id FROM users u
    JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=p_organization_id AND m.status='active'
    JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
    WHERE u.organization_id=p_organization_id AND u.status='active' AND r.name=ANY(p_roles)
  LOOP
    IF notify_user(member.id,p_organization_id,p_category,p_severity,p_title,p_body,p_link,p_dedupe_key) IS NOT NULL THEN sent := sent+1; END IF;
  END LOOP;
  RETURN sent;
END $$;

-- Notifies every active user holding a platform role such as kcca_admin. Returns how many were notified.
CREATE OR REPLACE FUNCTION notify_role(p_role TEXT,p_category TEXT,p_severity TEXT,p_title TEXT,p_body TEXT,p_link TEXT,p_dedupe_key TEXT,p_organization_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE person RECORD; sent INTEGER := 0;
BEGIN
  FOR person IN SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name=p_role AND u.status='active' LOOP
    IF notify_user(person.id,p_organization_id,p_category,p_severity,p_title,p_body,p_link,p_dedupe_key) IS NOT NULL THEN sent := sent+1; END IF;
  END LOOP;
  RETURN sent;
END $$;

-- Every permit lifecycle notice (reminders, expiry, suspension, reinstatement, renewal decisions) reaches the company's
-- administrators; expiry and suspension also reach supervisors because operations stop.
CREATE OR REPLACE FUNCTION notify_permit_lifecycle_notice() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE titles JSONB := '{"expiry_60":"Permit expires in about two months","expiry_30":"Permit expires within 30 days","expiry_7":"Permit expires within 7 days","expired":"Permit expired","suspended":"Permit suspended","reinstated":"Permit reinstated","renewed":"Permit renewed","renewal_rejected":"Renewal request not approved"}';
  severity TEXT; roles TEXT[];
BEGIN
  severity := CASE NEW.notice_type WHEN 'expired' THEN 'critical' WHEN 'suspended' THEN 'critical' WHEN 'expiry_7' THEN 'critical'
    WHEN 'expiry_30' THEN 'warning' WHEN 'renewal_rejected' THEN 'warning' ELSE 'info' END;
  roles := CASE WHEN NEW.notice_type IN('expired','suspended') THEN ARRAY['company_admin','supervisor'] ELSE ARRAY['company_admin'] END;
  PERFORM notify_organization(NEW.organization_id,roles,CASE WHEN NEW.notice_type IN('renewed','renewal_rejected') THEN 'renewal' ELSE 'permit' END,
    severity,titles->>NEW.notice_type,NEW.message,'/dashboard/permit','permit-notice:'||NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_permit_notice ON permit_lifecycle_notices;
CREATE TRIGGER trg_notify_permit_notice AFTER INSERT ON permit_lifecycle_notices FOR EACH ROW EXECUTE FUNCTION notify_permit_lifecycle_notice();

-- Keeps the tables small: read notifications and finished deliveries older than 180 days are removed.
CREATE OR REPLACE FUNCTION prune_notifications() RETURNS INTEGER LANGUAGE sql AS $$
  WITH removed AS (DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at<CURRENT_TIMESTAMP-interval '180 days' RETURNING 1)
  SELECT count(*)::int FROM removed
$$;
