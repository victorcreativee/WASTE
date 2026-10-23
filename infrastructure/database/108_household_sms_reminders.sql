-- Household reminders by SMS. Each reminder also appears on the household's /my page. A collection company chooses which
-- reminders it pays to send (all off until it switches them on); a household can turn SMS off for itself.
-- Events are notified where they happen (triggers below), so a reminder exists exactly when the event does; the
-- scheduler adds "collection tomorrow" and "bill due soon". Requires 098 and 106.

CREATE TABLE IF NOT EXISTS household_sms_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  collection_tomorrow BOOLEAN NOT NULL DEFAULT false,
  bill_issued BOOLEAN NOT NULL DEFAULT false,
  bill_due BOOLEAN NOT NULL DEFAULT false,
  payment_received BOOLEAN NOT NULL DEFAULT false,
  missed_collection BOOLEAN NOT NULL DEFAULT false,
  request_resolved BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS sms_reminders BOOLEAN NOT NULL DEFAULT true;

-- Household reminders use their own category so staff notification preferences never apply to them.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('permit','renewal','returns','compliance','custody','disposal','dumping','penalties','billing','system','household'));

-- One household reminder: always on /my; by SMS when the company has switched this kind on, the household has not turned
-- SMS off and has a phone number. Returns the notification id, or NULL when this event was already notified.
CREATE OR REPLACE FUNCTION notify_household(p_customer_id UUID, p_organization_id UUID, p_kind TEXT, p_title TEXT, p_body TEXT, p_dedupe_key TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE household RECORD; company_wants BOOLEAN; new_id UUID;
BEGIN
  SELECT u.id AS user_id, u.phone, u.status, cp.sms_reminders INTO household
    FROM customer_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.id = p_customer_id;
  IF NOT FOUND OR household.status <> 'active' THEN RETURN NULL; END IF;
  INSERT INTO notifications(recipient_user_id, organization_id, category, severity, title, body, link, dedupe_key)
  VALUES (household.user_id, p_organization_id, 'household', 'info', left(p_title, 200), left(p_body, 2000), '/my', p_dedupe_key)
  ON CONFLICT (recipient_user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO new_id;
  IF new_id IS NULL THEN RETURN NULL; END IF;
  SELECT CASE p_kind
           WHEN 'collection_tomorrow' THEN s.collection_tomorrow WHEN 'bill_issued' THEN s.bill_issued
           WHEN 'bill_due' THEN s.bill_due WHEN 'payment_received' THEN s.payment_received
           WHEN 'missed_collection' THEN s.missed_collection WHEN 'request_resolved' THEN s.request_resolved END
    INTO company_wants FROM household_sms_settings s WHERE s.organization_id = p_organization_id;
  IF COALESCE(company_wants, false) AND household.sms_reminders AND COALESCE(household.phone, '') <> '' THEN
    INSERT INTO notification_deliveries(notification_id, channel, destination) VALUES (new_id, 'sms', household.phone);
  END IF;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION household_company_name(p_organization_id UUID) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT name FROM organizations WHERE id = p_organization_id), 'Your collection company');
$$;
CREATE OR REPLACE FUNCTION household_money(p_amount NUMERIC) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'UGX ' || to_char(round(p_amount), 'FM999,999,999,999');
$$;

-- A new bill.
CREATE OR REPLACE FUNCTION notify_household_bill_issued() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'cancelled' AND NEW.amount_ugx > 0 THEN
    PERFORM notify_household(NEW.customer_id, NEW.organization_id, 'bill_issued', 'New bill',
      household_company_name(NEW.organization_id) || ': your bill of ' || household_money(NEW.amount_ugx) || ' is due on '
        || to_char(NEW.due_on, 'FMDD Mon') || '. Pay by mobile money on your household page.',
      'household-bill:' || NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_household_bill_issued ON customer_invoices;
CREATE TRIGGER trg_notify_household_bill_issued AFTER INSERT ON customer_invoices
  FOR EACH ROW EXECUTE FUNCTION notify_household_bill_issued();

-- A payment the company has confirmed (recorded as successful, or confirmed later).
CREATE OR REPLACE FUNCTION notify_household_payment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'successful' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'successful') THEN
    PERFORM notify_household(NEW.customer_id, NEW.organization_id, 'payment_received', 'Payment received',
      household_company_name(NEW.organization_id) || ': we received ' || household_money(NEW.amount_ugx)
        || COALESCE(' (receipt ' || NEW.receipt_number || ')', '') || '. Thank you.',
      'household-payment:' || NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_household_payment ON customer_payments;
CREATE TRIGGER trg_notify_household_payment AFTER INSERT OR UPDATE OF status ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION notify_household_payment();

-- A collection marked not done, and later its new date when the stop is rescheduled.
CREATE OR REPLACE FUNCTION notify_household_missed_collection() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE new_date DATE;
BEGIN
  IF NEW.status = 'skipped' AND OLD.status IS DISTINCT FROM 'skipped' THEN
    PERFORM notify_household(NEW.customer_id, NEW.organization_id, 'missed_collection', 'Collection missed',
      household_company_name(NEW.organization_id) || ': we could not collect your waste on ' || to_char(NEW.scheduled_date, 'FMDay DD Mon')
        || '. We will let you know the new date. Sorry for the inconvenience.',
      'household-missed:' || NEW.id);
  END IF;
  IF NEW.rescheduled_to_stop_id IS NOT NULL AND OLD.rescheduled_to_stop_id IS DISTINCT FROM NEW.rescheduled_to_stop_id THEN
    SELECT scheduled_date INTO new_date FROM customer_collection_stops WHERE id = NEW.rescheduled_to_stop_id;
    IF new_date IS NOT NULL THEN
      PERFORM notify_household(NEW.customer_id, NEW.organization_id, 'missed_collection', 'New collection date',
        household_company_name(NEW.organization_id) || ': your missed collection is now on ' || to_char(new_date, 'FMDay DD Mon') || '.',
        'household-rescheduled:' || NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_household_missed ON customer_collection_stops;
CREATE TRIGGER trg_notify_household_missed AFTER UPDATE OF status, rescheduled_to_stop_id ON customer_collection_stops
  FOR EACH ROW EXECUTE FUNCTION notify_household_missed_collection();

-- A household's request resolved by its company.
CREATE OR REPLACE FUNCTION notify_household_request_resolved() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE customer UUID;
BEGIN
  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' AND NEW.assigned_organization_id IS NOT NULL THEN
    SELECT id INTO customer FROM customer_profiles WHERE user_id = NEW.reporter_user_id;
    IF customer IS NOT NULL THEN
      PERFORM notify_household(customer, NEW.assigned_organization_id, 'request_resolved', 'Request resolved',
        household_company_name(NEW.assigned_organization_id) || ': your request "' || NEW.title || '" has been resolved.'
          || COALESCE(' ' || NULLIF(left(NEW.resolution_notes, 120), ''), ''),
        'household-request:' || NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_household_request ON citizen_issues;
CREATE TRIGGER trg_notify_household_request AFTER UPDATE OF status ON citizen_issues
  FOR EACH ROW EXECUTE FUNCTION notify_household_request_resolved();
