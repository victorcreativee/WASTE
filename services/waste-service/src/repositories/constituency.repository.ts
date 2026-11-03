import { dbPool } from "../config/database";

// Constituency dashboards (migration 118). Every figure is counted at the household's service location: its area gives
// the constituency. Locations whose area KCCA has not assigned yet are shown per division, and locations with no area
// at all are shown apart, so totals always add up to the city.

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const TODAY = "(now() AT TIME ZONE 'Africa/Kampala')::date";

/**
 * Collection, receipt and billing figures per group of service locations between two Kampala days.
 * `key` groups a location (columns of l, a and c are available); `where` narrows the locations.
 */
function metricsSql(key: string, where = "true") {
  return `WITH loc AS (
      SELECT l.id,l.customer_id,l.catalog_area_id,${key} AS key
      FROM customer_service_locations l
      LEFT JOIN kampala_division_areas a ON a.id=l.catalog_area_id
      LEFT JOIN kampala_constituencies c ON c.id=a.constituency_id
      WHERE ${where}
    ),
    -- A household's bills and payments count where its primary (else first) location is.
    home AS (SELECT DISTINCT ON (l.customer_id) l.customer_id,l.key FROM loc l
      JOIN customer_service_locations x ON x.id=l.id ORDER BY l.customer_id,x.is_primary DESC,x.created_at),
    served AS (SELECT l.key,count(DISTINCT l.id)::int locations,count(DISTINCT r.organization_id)::int operators
      FROM loc l JOIN customer_service_relationships r ON r.service_location_id=l.id AND r.status='active' GROUP BY l.key),
    stops AS (SELECT l.key,
        count(*) FILTER (WHERE s.scheduled_date<=${TODAY} AND s.status<>'cancelled')::int due,
        count(*) FILTER (WHERE s.status='completed')::int completed,
        count(*) FILTER (WHERE s.status='skipped' OR (s.status IN('pending','arrived') AND s.scheduled_date<${TODAY}))::int missed
      FROM loc l JOIN customer_collection_stops s ON s.service_location_id=l.id
      WHERE s.scheduled_date BETWEEN $1::date AND $2::date GROUP BY l.key),
    receipts AS (SELECT l.key,count(*)::int receipts,coalesce(sum(r.collected_weight_kg),0)::numeric(14,1) collected_kg
      FROM loc l JOIN collection_receipts r ON r.service_location_id=l.id
      WHERE (r.issued_at AT TIME ZONE 'Africa/Kampala')::date BETWEEN $1::date AND $2::date
        AND NOT EXISTS(SELECT 1 FROM collection_receipt_voids v WHERE v.receipt_id=r.id) GROUP BY l.key),
    billed AS (SELECT h.key,coalesce(sum(i.amount_ugx),0)::bigint billed_ugx,coalesce(sum(i.amount_ugx-i.balance_ugx),0)::bigint settled_ugx FROM home h JOIN customer_invoices i ON i.customer_id=h.customer_id
      WHERE i.status<>'cancelled' AND i.issued_on BETWEEN $1::date AND $2::date GROUP BY h.key),
    paid AS (SELECT h.key,coalesce(sum(p.amount_ugx),0)::bigint paid_ugx FROM home h JOIN customer_payments p ON p.customer_id=h.customer_id
      WHERE p.status='successful' AND (coalesce(p.confirmed_at,p.created_at) AT TIME ZONE 'Africa/Kampala')::date BETWEEN $1::date AND $2::date GROUP BY h.key),
    overdue AS (SELECT h.key,coalesce(sum(x.overdue_ugx),0)::bigint overdue_ugx,count(*) FILTER (WHERE x.overdue_ugx>0)::int households_overdue
      FROM home h JOIN customer_arrears x ON x.customer_id=h.customer_id GROUP BY h.key),
    keys AS (SELECT DISTINCT key FROM loc)
    SELECT k.key,coalesce(sv.locations,0) locations,coalesce(sv.operators,0) operators,
      coalesce(st.due,0) stops_due,coalesce(st.completed,0) stops_completed,coalesce(st.missed,0) stops_missed,
      coalesce(rc.receipts,0) receipts,coalesce(rc.collected_kg,0) collected_kg,
      coalesce(b.billed_ugx,0) billed_ugx,coalesce(b.settled_ugx,0) settled_ugx,coalesce(p.paid_ugx,0) paid_ugx,coalesce(o.overdue_ugx,0) overdue_ugx,coalesce(o.households_overdue,0) households_overdue
    FROM keys k LEFT JOIN served sv USING(key) LEFT JOIN stops st USING(key) LEFT JOIN receipts rc USING(key)
      LEFT JOIN billed b USING(key) LEFT JOIN paid p USING(key) LEFT JOIN overdue o USING(key)`;
}

type Metrics = Record<string, string | number>;
const byKey = (rows: (Metrics & { key: string })[]) => new Map(rows.map(r => [r.key, r]));
const EMPTY = { locations: 0, operators: 0, stops_due: 0, stops_completed: 0, stops_missed: 0, receipts: 0, collected_kg: "0", billed_ugx: "0", settled_ugx: "0", paid_ugx: "0", overdue_ugx: "0", households_overdue: 0 };

/** Every constituency, then each division's unassigned areas, then locations with no area. */
export async function constituencyOverview(from: string, to: string) {
  const [metrics, constituencies, unassigned, areas] = await Promise.all([
    dbPool.query(metricsSql("coalesce(c.id::text,'division:'||coalesce(a.division_id,l.division_id)::text,'none')"), [from, to]),
    dbPool.query(`SELECT c.id,c.code,c.name,d.name division,c.sort_order FROM kampala_constituencies c JOIN kampala_divisions d ON d.id=c.division_id ORDER BY c.sort_order`),
    dbPool.query(`SELECT d.id,d.name,count(a.id) FILTER (WHERE a.is_active AND a.constituency_id IS NULL)::int unassigned_areas
      FROM kampala_divisions d LEFT JOIN kampala_division_areas a ON a.division_id=d.id GROUP BY d.id,d.name ORDER BY d.name`),
    // Areas with no household served by any operator: the coverage gaps.
    dbPool.query(`SELECT a.constituency_id,count(*)::int areas,count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM customer_service_locations l
        JOIN customer_service_relationships r ON r.service_location_id=l.id AND r.status='active' WHERE l.catalog_area_id=a.id))::int areas_unserved
      FROM kampala_division_areas a WHERE a.is_active GROUP BY a.constituency_id`),
  ]);
  const m = byKey(metrics.rows), coverage = new Map(areas.rows.map(r => [r.constituency_id ?? "none", r]));
  return {
    constituencies: constituencies.rows.map(c => ({ ...c, ...EMPTY, ...m.get(c.id), key: c.id,
      areas: coverage.get(c.id)?.areas ?? 0, areas_unserved: coverage.get(c.id)?.areas_unserved ?? 0 })),
    unassigned: unassigned.rows.filter(d => d.unassigned_areas > 0 || m.has(`division:${d.id}`))
      .map(d => ({ division_id: d.id, division: d.name, unassigned_areas: d.unassigned_areas, ...EMPTY, ...m.get(`division:${d.id}`) })),
    noArea: { ...EMPTY, ...m.get("none") },
  };
}

/** One constituency: its areas and the operators serving it. */
export async function constituencyDetail(id: string, from: string, to: string) {
  const constituency = (await dbPool.query(`SELECT c.id,c.code,c.name,d.name division FROM kampala_constituencies c
    JOIN kampala_divisions d ON d.id=c.division_id WHERE c.id::text=$1 OR c.code=$1`, [id])).rows[0];
  if (!constituency) throw fail(404, "No such constituency");
  const [areas, areaMetrics, operators] = await Promise.all([
    dbPool.query("SELECT id,name FROM kampala_division_areas WHERE constituency_id=$1::uuid AND is_active ORDER BY name", [constituency.id]),
    dbPool.query(metricsSql("l.catalog_area_id::text", "a.constituency_id=$3::uuid"), [from, to, constituency.id]),
    // Operator scorecards inside the constituency: the same figures, counted only for each operator's own households.
    dbPool.query(`SELECT o.id,o.name,
        count(DISTINCT r.service_location_id)::int locations,
        count(s.id) FILTER (WHERE s.scheduled_date<=${TODAY} AND s.status<>'cancelled')::int stops_due,
        count(s.id) FILTER (WHERE s.status='completed')::int stops_completed,
        count(s.id) FILTER (WHERE s.status='skipped' OR (s.status IN('pending','arrived') AND s.scheduled_date<${TODAY}))::int stops_missed,
        (SELECT count(*) FROM collection_receipts rc JOIN customer_service_locations l2 ON l2.id=rc.service_location_id
           JOIN kampala_division_areas a2 ON a2.id=l2.catalog_area_id
          WHERE rc.organization_id=o.id AND a2.constituency_id=$3::uuid
            AND (rc.issued_at AT TIME ZONE 'Africa/Kampala')::date BETWEEN $1::date AND $2::date)::int receipts
      FROM customer_service_relationships r
      JOIN customer_service_locations l ON l.id=r.service_location_id
      JOIN kampala_division_areas a ON a.id=l.catalog_area_id AND a.constituency_id=$3::uuid
      JOIN organizations o ON o.id=r.organization_id
      LEFT JOIN customer_collection_stops s ON s.service_location_id=l.id AND s.organization_id=o.id AND s.scheduled_date BETWEEN $1::date AND $2::date
      WHERE r.status='active' GROUP BY o.id,o.name ORDER BY locations DESC`, [from, to, constituency.id]),
  ]);
  const m = byKey(areaMetrics.rows);
  return { constituency, areas: areas.rows.map(a => ({ ...a, ...EMPTY, ...m.get(a.id) })), operators: operators.rows };
}

/** The area catalogue with each area's constituency, for KCCA to assign. */
export async function areaAssignments() {
  const [constituencies, areas] = await Promise.all([
    dbPool.query("SELECT id,name,division_id FROM kampala_constituencies ORDER BY sort_order"),
    dbPool.query(`SELECT a.id,a.name,a.division_id,d.name division,a.constituency_id,a.constituency_assigned_at,u.full_name assigned_by,
        (SELECT count(*) FROM customer_service_locations l WHERE l.catalog_area_id=a.id)::int locations
      FROM kampala_division_areas a JOIN kampala_divisions d ON d.id=a.division_id LEFT JOIN users u ON u.id=a.constituency_assigned_by
      WHERE a.is_active ORDER BY d.name,a.name`),
  ]);
  return { constituencies: constituencies.rows, areas: areas.rows };
}

export async function assignArea(areaId: string, constituencyId: string | null, userId: string) {
  try {
    const row = (await dbPool.query(`UPDATE kampala_division_areas SET constituency_id=$2::uuid,constituency_assigned_by=$3::uuid,
        constituency_assigned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid RETURNING id,name,constituency_id`,
    [areaId, constituencyId, userId])).rows[0];
    if (!row) throw fail(404, "No such area");
    return row;
  } catch (error) {
    if ((error as { code?: string }).code === "KW400") throw fail(400, (error as Error).message);
    throw error;
  }
}
