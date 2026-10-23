import { dbPool } from "../config/database";

/** The household (citizen) account's customer record, primary location and the company that serves it. */
async function householdContext(userId: string) {
  return (await dbPool.query(
    `SELECT cp.id AS customer_id, cp.customer_number, cp.customer_type, cp.service_status, cp.sms_reminders,
            u.full_name, u.phone,
            csl.id AS location_id, csl.label AS location_label, csl.address, csl.location_precise,
            csl.division_id, csl.catalog_area_id,
            wz.name AS zone_name,
            o.id AS organization_id, o.name AS company_name, o.phone AS company_phone, o.email AS company_email,
            rel.status AS relationship_status
       FROM customer_profiles cp
       JOIN users u ON u.id = cp.user_id
       LEFT JOIN customer_service_locations csl ON csl.customer_id = cp.id AND csl.is_primary
       LEFT JOIN waste_zones wz ON wz.id = csl.zone_id
       LEFT JOIN LATERAL (
         SELECT r.organization_id, r.status FROM customer_service_relationships r
          WHERE r.service_location_id = csl.id AND r.status IN ('active','suspended')
          ORDER BY r.created_at DESC LIMIT 1) rel ON true
       LEFT JOIN organizations o ON o.id = rel.organization_id
      WHERE cp.user_id = $1::uuid`,
    [userId]
  )).rows[0] ?? null;
}

const ISO_DAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Everything a household needs on one screen: who serves it, when collection comes, what happened, what it owes. */
export async function householdOverview(userId: string) {
  const context = await householdContext(userId);
  if (!context) return null;
  const [plan, routes, upcoming, recent, invoices, payments, requests] = await Promise.all([
    dbPool.query(
      `SELECT sp.name, sp.fee_ugx, sp.billing_frequency, sp.collections_per_period, cs.status, cs.next_billing_date::text AS next_billing_date
         FROM customer_subscriptions cs JOIN service_plans sp ON sp.id = cs.plan_id
        WHERE cs.customer_id = $1::uuid AND cs.status IN ('active','pending','suspended')
        ORDER BY cs.created_at DESC LIMIT 1`, [context.customer_id]),
    context.location_id ? dbPool.query(
      `SELECT sr.name, sr.operating_days FROM service_route_customers src
         JOIN service_routes sr ON sr.id = src.service_route_id AND sr.is_active
        WHERE src.service_location_id = $1::uuid AND src.is_active`, [context.location_id]) : Promise.resolve({ rows: [] }),
    dbPool.query(
      `SELECT ccs.scheduled_date::text AS scheduled_date, ccs.status
         FROM customer_collection_stops ccs
        WHERE ccs.customer_id = $1::uuid AND ccs.scheduled_date >= CURRENT_DATE AND ccs.status IN ('pending','arrived')
        ORDER BY ccs.scheduled_date LIMIT 5`, [context.customer_id]),
    dbPool.query(
      `SELECT ccs.id, ccs.scheduled_date::text AS scheduled_date, ccs.status, ccs.completed_at, ccs.exception_reason
         FROM customer_collection_stops ccs
        WHERE ccs.customer_id = $1::uuid AND (ccs.scheduled_date < CURRENT_DATE OR ccs.status IN ('completed','skipped'))
        ORDER BY ccs.scheduled_date DESC, ccs.completed_at DESC NULLS LAST LIMIT 10`, [context.customer_id]),
    dbPool.query(
      `SELECT id, invoice_number, amount_ugx, balance_ugx, status, issued_on::text AS issued_on, due_on::text AS due_on,
              billing_period_start::text AS period_start, billing_period_end::text AS period_end
         FROM customer_invoices WHERE customer_id = $1::uuid AND status <> 'cancelled'
        ORDER BY (balance_ugx > 0) DESC, due_on DESC LIMIT 12`, [context.customer_id]),
    dbPool.query(
      `SELECT id, invoice_id, amount_ugx, provider, status, receipt_number, created_at, confirmed_at
         FROM customer_payments WHERE customer_id = $1::uuid ORDER BY created_at DESC LIMIT 8`, [context.customer_id]),
    dbPool.query(
      `SELECT id, category, title, status, created_at, resolved_at, resolution_notes
         FROM citizen_issues WHERE reporter_user_id = $1::uuid ORDER BY created_at DESC LIMIT 8`, [userId]),
  ]);
  // Collection weekdays come from the household's route(s); the next dates are the soonest of planned stops and route days.
  const days = [...new Set(routes.rows.flatMap((route: { operating_days: number[] }) => route.operating_days || []))].sort((a, b) => a - b);
  return {
    household: {
      name: context.full_name, phone: context.phone, customerNumber: context.customer_number, customerType: context.customer_type,
      status: context.service_status, address: context.address, locationLabel: context.location_label, zone: context.zone_name,
      smsReminders: context.sms_reminders, locationPrecise: context.location_precise !== false,
      divisionId: context.division_id, areaId: context.catalog_area_id,
    },
    company: context.organization_id
      ? { name: context.company_name, phone: context.company_phone, email: context.company_email, status: context.relationship_status }
      : null,
    plan: plan.rows[0] ?? null,
    schedule: {
      weekdays: days.map((day) => ISO_DAY[day]),
      routes: routes.rows.map((route: { name: string }) => route.name),
      upcoming: upcoming.rows,
    },
    collections: recent.rows,
    invoices: invoices.rows,
    payments: payments.rows,
    requests: requests.rows,
    messages: await householdMessages(userId),
    // Until a company serves the household: its latest request to a company, if any.
    serviceRequest: context.organization_id ? null : (await dbPool.query(
      `SELECT r.id, r.status, r.review_note, r.created_at, o.name AS company_name, o.phone AS company_phone
         FROM customer_provider_requests r JOIN organizations o ON o.id = r.requested_organization_id
        WHERE r.customer_id = $1::uuid ORDER BY r.created_at DESC LIMIT 1`, [context.customer_id])).rows[0] ?? null,
    balanceUgx: invoices.rows.reduce((sum: number, invoice: { balance_ugx: string }) => sum + Number(invoice.balance_ugx || 0), 0),
  };
}

/** A household's request goes straight to the company that serves it, so it lands in that company's service issues. */
const REQUESTS = {
  missed_collection: { title: "Missed collection", description: "The household reports that its waste was not collected." },
  pickup_request: { title: "Extra pickup requested", description: "The household asks for an extra pickup." },
  service_complaint: { title: "Complaint", description: "The household has a complaint about the service." },
} as const;
export type HouseholdRequestKind = keyof typeof REQUESTS;

export async function createHouseholdRequest(userId: string, input: { kind: HouseholdRequestKind; note?: string }) {
  const context = await householdContext(userId);
  if (!context?.organization_id) return null;
  const { title } = REQUESTS[input.kind];
  const description = input.note?.trim() || REQUESTS[input.kind].description;
  return (await dbPool.query(
    `INSERT INTO citizen_issues (reporter_user_id, assigned_organization_id, category, title, description, status, address)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'assigned', $6)
     RETURNING id, category, title, status, created_at`,
    [userId, context.organization_id, input.kind, title, description, context.address]
  )).rows[0];
}

const failure = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/**
 * Updates where a household is. Once a company serves it, the household can share its exact position (and correct the
 * address) but not move to another area; before that, and with no request waiting, it can also change division and area.
 */
export async function updateHouseholdPlace(userId: string, input: { address?: string; latitude?: number; longitude?: number; divisionId?: string; areaId?: string | null }) {
  const context = await householdContext(userId);
  if (!context?.location_id) return null;
  const moving = input.divisionId !== undefined && (input.divisionId !== context.division_id || (input.areaId ?? null) !== (context.catalog_area_id ?? null));
  if (moving) {
    if (context.organization_id) throw failure("Your collection company serves this address. Call them to move your service.", 409);
    const waiting = await dbPool.query(
      `SELECT 1 FROM customer_provider_requests WHERE customer_id = $1::uuid AND status IN ('pending_current_provider','pending_new_provider')`,
      [context.customer_id]);
    if (waiting.rowCount) throw failure("Cancel your request to the company before changing your area.", 409);
    const place = await dbPool.query(
      `SELECT 1 FROM kampala_divisions d WHERE d.id = $1::uuid AND d.is_active
          AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM kampala_division_areas a WHERE a.id = $2::uuid AND a.division_id = d.id AND a.is_active))`,
      [input.divisionId, input.areaId ?? null]);
    if (!place.rowCount) throw failure("Choose your division and an area within it.", 400);
  }
  const pinned = input.latitude !== undefined && input.longitude !== undefined;
  // A new area without a new position leaves the old point, which no longer marks the household exactly.
  return (await dbPool.query(
    `UPDATE customer_service_locations SET
        address = COALESCE($2, address),
        location = CASE WHEN $3::float8 IS NULL THEN location ELSE ST_SetSRID(ST_Point($4::float8, $3::float8), 4326)::geography END,
        location_precise = CASE WHEN $3::float8 IS NOT NULL THEN true WHEN $5 THEN false ELSE location_precise END,
        division_id = CASE WHEN $5 THEN $6::uuid ELSE division_id END,
        catalog_area_id = CASE WHEN $5 THEN $7::uuid ELSE catalog_area_id END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::uuid
      RETURNING address, location_precise, division_id, catalog_area_id`,
    [context.location_id, input.address?.trim() || null, pinned ? input.latitude : null, pinned ? input.longitude : null, moving,
     moving ? input.divisionId : null, moving ? input.areaId ?? null : null]
  )).rows[0];
}

export const REMINDER_KINDS = ["collection_tomorrow", "bill_issued", "bill_due", "payment_received", "missed_collection", "request_resolved"] as const;
export type ReminderSettings = Record<(typeof REMINDER_KINDS)[number], boolean>;

/** The company's SMS reminder switches (all off until it turns them on) and how many SMS reminders went out in 30 days. */
export async function reminderSettings(organizationId: string) {
  const [settings, usage] = await Promise.all([
    dbPool.query(`SELECT ${REMINDER_KINDS.join(",")}, updated_at FROM household_sms_settings WHERE organization_id = $1::uuid`, [organizationId]),
    dbPool.query(
      `SELECT COUNT(*) FILTER (WHERE d.status = 'sent')::int AS sent, COUNT(*) FILTER (WHERE d.status IN ('pending','sending'))::int AS waiting,
              COUNT(*) FILTER (WHERE d.status IN ('failed','skipped'))::int AS not_sent
         FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id
        WHERE n.category = 'household' AND n.organization_id = $1::uuid AND d.channel = 'sms' AND d.created_at > CURRENT_TIMESTAMP - interval '30 days'`,
      [organizationId]),
  ]);
  const row = settings.rows[0] ?? {};
  return {
    settings: Object.fromEntries(REMINDER_KINDS.map((kind) => [kind, Boolean(row[kind])])) as ReminderSettings,
    updatedAt: row.updated_at ?? null,
    last30Days: usage.rows[0],
  };
}

export async function saveReminderSettings(organizationId: string, userId: string, settings: ReminderSettings) {
  await dbPool.query(
    `INSERT INTO household_sms_settings(organization_id, ${REMINDER_KINDS.join(",")}, updated_by)
     VALUES ($1::uuid, ${REMINDER_KINDS.map((_, index) => `$${index + 2}`).join(",")}, $${REMINDER_KINDS.length + 2}::uuid)
     ON CONFLICT (organization_id) DO UPDATE SET ${REMINDER_KINDS.map((kind) => `${kind} = EXCLUDED.${kind}`).join(",")},
       updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [organizationId, ...REMINDER_KINDS.map((kind) => settings[kind]), userId]
  );
  return reminderSettings(organizationId);
}

/** A household turns its own SMS reminders on or off (reminders still appear on /my). */
export async function setHouseholdSms(userId: string, enabled: boolean) {
  return (await dbPool.query(`UPDATE customer_profiles SET sms_reminders = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1::uuid RETURNING sms_reminders`, [userId, enabled])).rows[0] ?? null;
}

/** The household's recent reminders, shown on /my. */
export async function householdMessages(userId: string) {
  return (await dbPool.query(
    `SELECT id, title, body, created_at FROM notifications WHERE recipient_user_id = $1::uuid AND category = 'household'
      ORDER BY created_at DESC LIMIT 10`, [userId])).rows;
}

/**
 * Scheduled household reminders, run hourly. "Collection tomorrow" goes out from 17:00 Kampala time to households whose
 * route runs tomorrow or who have a planned stop tomorrow; "bill due" goes out three days before an unpaid bill is due.
 * Each is created once (the notification key), so hourly runs never repeat a reminder.
 */
export async function runHouseholdReminders() {
  const local = (await dbPool.query(
    `SELECT EXTRACT(HOUR FROM now() AT TIME ZONE 'Africa/Kampala')::int AS hour,
            ((now() AT TIME ZONE 'Africa/Kampala')::date + 1) AS tomorrow`)).rows[0];
  let collection = 0;
  if (local.hour >= 17) {
    collection = (await dbPool.query(
      `SELECT notify_household(h.customer_id, h.organization_id, 'collection_tomorrow', 'Collection tomorrow',
                household_company_name(h.organization_id) || ': we collect your waste tomorrow, ' || to_char($1::date, 'FMDay DD Mon')
                  || '. Please put it out in the morning.',
                'household-collect:' || h.customer_id || ':' || $1::date) AS id
         FROM (
           SELECT DISTINCT cp.id AS customer_id, rel.organization_id
             FROM customer_profiles cp
             JOIN customer_service_locations csl ON csl.customer_id = cp.id AND csl.is_primary
             JOIN customer_service_relationships rel ON rel.service_location_id = csl.id AND rel.status = 'active'
             JOIN users u ON u.id = cp.user_id AND u.status = 'active'
            WHERE cp.service_status = 'active' AND (
              EXISTS (SELECT 1 FROM service_route_customers src JOIN service_routes sr ON sr.id = src.service_route_id AND sr.is_active
                       WHERE src.service_location_id = csl.id AND src.is_active AND sr.organization_id = rel.organization_id
                         AND EXTRACT(ISODOW FROM $1::date)::smallint = ANY(sr.operating_days))
              OR EXISTS (SELECT 1 FROM customer_collection_stops ccs WHERE ccs.customer_id = cp.id AND ccs.scheduled_date = $1::date AND ccs.status = 'pending'))
         ) h`, [local.tomorrow])).rows.filter((row: { id: string | null }) => row.id).length;
  }
  const due = (await dbPool.query(
    `SELECT notify_household(i.customer_id, i.organization_id, 'bill_due', 'Bill due soon',
              household_company_name(i.organization_id) || ': ' || household_money(i.balance_ugx) || ' is due on '
                || to_char(i.due_on, 'FMDay DD Mon') || '. Pay by mobile money on your household page.',
              'household-due:' || i.id) AS id
       FROM customer_invoices i
      WHERE i.balance_ugx > 0 AND i.status IN ('issued','partially_paid') AND i.due_on = (now() AT TIME ZONE 'Africa/Kampala')::date + 3`)).rows
    .filter((row: { id: string | null }) => row.id).length;
  return { collection, due };
}
