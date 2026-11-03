import { dbPool } from "../config/database";

// Waste point registry (migration 119). A company sees and profiles its own collection points; KCCA sees the city.
// Field verification replaces a point's position with a GPS fix taken on site.

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
export const MAX_ACCURACY_M = 50;
/** Greater Kampala, generously: a fix outside it is a device or input error. */
export const KAMPALA_BOUNDS = { south: 0.1, north: 0.6, west: 32.3, east: 32.9 };

export const STATUSES = {
  all: "true",
  unverified: "r.verified_at IS NULL",
  verified: "r.verified_at IS NOT NULL",
  imprecise: "NOT r.location_precise AND r.verified_at IS NULL",
  tariff_mismatch: "r.tariff_mismatch",
  no_category: "r.point_category IS NULL",
  no_area: "r.catalog_area_id IS NULL",
  not_collected: "r.service_status='active' AND (r.last_collected_at IS NULL OR r.last_collected_at<now()-interval '30 days')",
} as const;
export type RegistryStatus = keyof typeof STATUSES;

export async function registrySummary(organizationId: string | null) {
  const scope = "($1::uuid IS NULL OR r.organization_id=$1::uuid)";
  const [totals, categories, divisions] = await Promise.all([
    dbPool.query(`SELECT count(*)::int points,count(*) FILTER (WHERE ${STATUSES.verified})::int verified,
        count(*) FILTER (WHERE ${STATUSES.imprecise})::int imprecise,count(*) FILTER (WHERE ${STATUSES.tariff_mismatch})::int tariff_mismatch,
        count(*) FILTER (WHERE ${STATUSES.no_category})::int no_category,count(*) FILTER (WHERE ${STATUSES.no_area})::int no_area,
        count(*) FILTER (WHERE ${STATUSES.not_collected})::int not_collected,coalesce(sum(r.estimated_kg_week),0)::numeric(14,1) estimated_kg_week
      FROM waste_point_registry r WHERE ${scope}`, [organizationId]),
    dbPool.query(`SELECT coalesce(r.point_category,'none') category,count(*)::int points,coalesce(sum(r.estimated_kg_week),0)::numeric(14,1) estimated_kg_week,
        count(*) FILTER (WHERE ${STATUSES.verified})::int verified
      FROM waste_point_registry r WHERE ${scope} GROUP BY 1 ORDER BY 2 DESC`, [organizationId]),
    dbPool.query(`SELECT coalesce(r.division,'No division') division,count(*)::int points,count(*) FILTER (WHERE ${STATUSES.verified})::int verified,
        count(DISTINCT r.organization_id)::int operators
      FROM waste_point_registry r WHERE ${scope} GROUP BY 1 ORDER BY 1`, [organizationId]),
  ]);
  return { ...totals.rows[0], categories: categories.rows, divisions: divisions.rows };
}

export async function listPoints(organizationId: string | null, input: { status: RegistryStatus; category?: string; search?: string; page: number; pageSize: number }) {
  const { rows } = await dbPool.query(`SELECT r.id,r.point_number,r.point_category,r.estimated_kg_week,r.label,r.address,r.customer_name,r.customer_type,
      r.organization_name,r.division,r.area,r.constituency,r.tariff_band,r.plan_customer_type,r.expected_customer_type,r.tariff_mismatch,
      r.location_precise,r.verified_at,r.verified_by_name,r.last_collected_at,r.service_status,count(*) OVER() AS total_rows
    FROM waste_point_registry r
    WHERE ($1::uuid IS NULL OR r.organization_id=$1::uuid) AND ${STATUSES[input.status]}
      AND ($2::text IS NULL OR coalesce(r.point_category,'none')=$2)
      AND ($3::text IS NULL OR r.point_number ILIKE '%'||$3||'%' OR r.customer_name ILIKE '%'||$3||'%' OR r.address ILIKE '%'||$3||'%'
        OR r.label ILIKE '%'||$3||'%' OR r.area ILIKE '%'||$3||'%')
    ORDER BY r.point_number LIMIT $4 OFFSET $5`,
  [organizationId, input.category ?? null, input.search || null, input.pageSize, (input.page - 1) * input.pageSize]);
  const total = rows.length ? Number(rows[0].total_rows) : 0;
  return { rows: rows.map(({ total_rows: _, ...row }) => row), page: input.page, pageSize: input.pageSize, total };
}

async function point(organizationId: string | null, id: string) {
  const row = (await dbPool.query("SELECT * FROM waste_point_registry r WHERE r.id=$1::uuid AND ($2::uuid IS NULL OR r.organization_id=$2::uuid)",
    [id, organizationId])).rows[0];
  if (!row) throw fail(404, "No such collection point");
  return row;
}

/** A point with its service history: collections, receipts and the household's bills. */
export async function pointDetail(organizationId: string | null, id: string) {
  const p = await point(organizationId, id);
  const [stops, receipts, bills] = await Promise.all([
    dbPool.query(`SELECT s.scheduled_date::text AS scheduled_date,s.status,s.completed_at,s.collected_weight_kg,s.exception_reason,o.name organization
      FROM customer_collection_stops s JOIN organizations o ON o.id=s.organization_id
      WHERE s.service_location_id=$1::uuid AND ($2::uuid IS NULL OR s.organization_id=$2::uuid) ORDER BY s.scheduled_date DESC LIMIT 30`, [id, organizationId]),
    dbPool.query(`SELECT r.serial_number,r.issued_at,r.collected_weight_kg,EXISTS(SELECT 1 FROM collection_receipt_voids v WHERE v.receipt_id=r.id) voided
      FROM collection_receipts r WHERE r.service_location_id=$1::uuid AND ($2::uuid IS NULL OR r.organization_id=$2::uuid) ORDER BY r.issued_at DESC LIMIT 10`, [id, organizationId]),
    dbPool.query(`SELECT count(*)::int bills,coalesce(sum(amount_ugx),0)::bigint billed_ugx,coalesce(sum(balance_ugx) FILTER (WHERE status<>'cancelled'),0)::bigint open_ugx
      FROM customer_invoices WHERE customer_id=$1::uuid AND ($2::uuid IS NULL OR organization_id=$2::uuid) AND status<>'cancelled'`, [p.customer_id, organizationId]),
  ]);
  const due = stops.rows.filter(s => s.status !== "cancelled" && s.scheduled_date <= new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala" }).format(new Date()));
  return { point: p, stops: stops.rows, receipts: receipts.rows, billing: bills.rows[0],
    service: { due: due.length, completed: due.filter(s => s.status === "completed").length } };
}

export async function updateProfile(organizationId: string | null, id: string, input: { pointCategory?: string; estimatedKgWeek?: number | null }) {
  await point(organizationId, id);
  return (await dbPool.query(`UPDATE customer_service_locations SET
      point_category=CASE WHEN $2::boolean THEN $3 ELSE point_category END,
      estimated_kg_week=CASE WHEN $4::boolean THEN $5::numeric ELSE estimated_kg_week END,updated_at=CURRENT_TIMESTAMP
    WHERE id=$1::uuid RETURNING id,point_number,point_category,estimated_kg_week`,
  [id, input.pointCategory !== undefined, input.pointCategory ?? null, input.estimatedKgWeek !== undefined, input.estimatedKgWeek ?? null])).rows[0];
}

/** Records a field visit: the GPS fix taken at the point becomes its position. */
export async function verifyPoint(organizationId: string | null, id: string, input: { latitude: number; longitude: number; accuracyM: number; note?: string }, userId: string) {
  await point(organizationId, id);
  return (await dbPool.query(`UPDATE customer_service_locations SET
      verification_moved_m=CASE WHEN location IS NULL THEN NULL ELSE round(ST_Distance(location,ST_SetSRID(ST_MakePoint($3,$2),4326)::geography)::numeric,1) END,
      location=ST_SetSRID(ST_MakePoint($3,$2),4326)::geography,location_precise=true,
      verified_at=CURRENT_TIMESTAMP,verified_by=$5::uuid,verified_by_name=(SELECT full_name FROM users WHERE id=$5::uuid),
      verification_accuracy_m=$4,verification_note=$6,updated_at=CURRENT_TIMESTAMP
    WHERE id=$1::uuid RETURNING id,point_number,verified_at,verification_accuracy_m,verification_moved_m`,
  [id, input.latitude, input.longitude, input.accuracyM, userId, input.note || null])).rows[0];
}
