import { dbPool } from "../config/database";

/** The household (citizen) account's customer record, primary location and the company that serves it. */
async function householdContext(userId: string) {
  return (await dbPool.query(
    `SELECT cp.id AS customer_id, cp.customer_number, cp.customer_type, cp.service_status,
            u.full_name, u.phone,
            csl.id AS location_id, csl.label AS location_label, csl.address,
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
    balanceUgx: invoices.rows.reduce((sum: number, invoice: { balance_ugx: string }) => sum + Number(invoice.balance_ugx || 0), 0),
  };
}

/** A household's request goes straight to the company that serves it, so it lands in that company's service issues. */
export async function createHouseholdRequest(userId: string, input: { kind: "missed_collection" | "pickup_request"; note?: string }) {
  const context = await householdContext(userId);
  if (!context?.organization_id) return null;
  const title = input.kind === "missed_collection" ? "Missed collection" : "Extra pickup requested";
  const description = input.note?.trim() || (input.kind === "missed_collection" ? "The household reports that its waste was not collected." : "The household asks for an extra pickup.");
  return (await dbPool.query(
    `INSERT INTO citizen_issues (reporter_user_id, assigned_organization_id, category, title, description, status, address)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'assigned', $6)
     RETURNING id, category, title, status, created_at`,
    [userId, context.organization_id, input.kind, title, description, context.address]
  )).rows[0];
}
