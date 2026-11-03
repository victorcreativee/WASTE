import { dbPool } from "../config/database";

// GPS consent and retention (migration 114). The database refuses positions from drivers without consent to the
// current notice and deletes old positions through purge_expired_gps_points; this module reads and records the rest.

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const RUN_EVERY_HOURS = 20;
const BATCH = 5000;

const latestConsent = (userColumn: string) => `LEFT JOIN LATERAL (SELECT c.decision,c.notice_version,c.decided_at FROM gps_consents c
  WHERE c.user_id=${userColumn} ORDER BY c.decided_at DESC,c.id DESC LIMIT 1) consent ON true`;
const consentState = `CASE WHEN consent.decision IS NULL THEN 'not_asked'
  WHEN consent.decision='granted' AND consent.notice_version<(SELECT max(version) FROM gps_privacy_notices) THEN 'outdated'
  ELSE consent.decision END`;

export async function currentNotice() {
  return (await dbPool.query(`SELECT n.version,n.title,n.body,n.change_summary,n.published_at,s.raw_point_days
   FROM gps_privacy_notices n CROSS JOIN gps_retention_settings s ORDER BY n.version DESC LIMIT 1`)).rows[0];
}

/** What a driver sees about their own location data. */
export async function myGpsStatus(userId: string) {
  const [notice, consent, points, history] = await Promise.all([
    currentNotice(),
    dbPool.query(`SELECT ${consentState} state,consent.notice_version,consent.decided_at FROM (SELECT 1) x ${latestConsent("$1::uuid")}`, [userId]),
    dbPool.query(`SELECT count(*)::int points,min(e.recorded_at) first_at,max(e.recorded_at) last_at,count(DISTINCT e.route_id)::int trips
      FROM vehicle_location_events e JOIN drivers d ON d.id=e.driver_id WHERE d.user_id=$1::uuid`, [userId]),
    dbPool.query("SELECT decision,notice_version,decided_at FROM gps_consents WHERE user_id=$1::uuid ORDER BY decided_at DESC LIMIT 20", [userId]),
  ]);
  return { notice, consent: consent.rows[0], data: points.rows[0], history: history.rows };
}

export async function recordConsent(userId: string, decision: "granted" | "declined" | "withdrawn", noticeVersion: number, ip: string | null, userAgent: string | null) {
  const notice = await currentNotice();
  if (noticeVersion !== notice.version) throw fail(409, "The location notice has changed. Read the new version before answering.");
  const row = (await dbPool.query(`INSERT INTO gps_consents(user_id,organization_id,notice_version,decision,ip,user_agent)
    SELECT id,organization_id,$2,$3,$4,$5 FROM users WHERE id=$1::uuid RETURNING decision,notice_version,decided_at`,
  [userId, noticeVersion, decision, ip, userAgent?.slice(0, 300) ?? null])).rows[0];
  if (!row) throw fail(404, "Account not found");
  return row;
}

/** Every stored position of this driver, for their own copy (right of access). */
export async function exportMyGps(userId: string) {
  return (await dbPool.query(`SELECT e.recorded_at,ST_Y(e.location::geometry) latitude,ST_X(e.location::geometry) longitude,e.accuracy_m,e.speed_kph,
     e.heading_degrees,r.trip_number,t.plate_number
    FROM vehicle_location_events e JOIN drivers d ON d.id=e.driver_id LEFT JOIN collection_routes r ON r.id=e.route_id
    LEFT JOIN waste_trucks t ON t.id=e.truck_id WHERE d.user_id=$1::uuid ORDER BY e.recorded_at LIMIT 500000`, [userId])).rows;
}

/** Policy, notices, consent by operator (or by driver for one company), holds and recent purges. */
export async function gpsOverview(organizationId: string | null) {
  const [notice, notices, consents, drivers, holds, runs, points] = await Promise.all([
    currentNotice(),
    dbPool.query("SELECT version,title,change_summary,published_at,published_by_name FROM gps_privacy_notices ORDER BY version DESC"),
    dbPool.query(`SELECT o.id organization_id,o.name organization_name,count(*)::int drivers,
       count(*) FILTER (WHERE ${consentState}='granted')::int granted,
       count(*) FILTER (WHERE ${consentState} IN ('withdrawn','declined'))::int refused,
       count(*) FILTER (WHERE ${consentState} IN ('not_asked','outdated'))::int waiting
      FROM drivers d JOIN organizations o ON o.id=d.organization_id ${latestConsent("d.user_id")}
      WHERE d.user_id IS NOT NULL AND d.status<>'inactive' AND ($1::uuid IS NULL OR d.organization_id=$1::uuid) GROUP BY o.id ORDER BY o.name`, [organizationId]),
    organizationId ? dbPool.query(`SELECT d.id,d.full_name,d.phone,d.status,${consentState} state,consent.notice_version,consent.decided_at
      FROM drivers d ${latestConsent("d.user_id")} WHERE d.organization_id=$1::uuid AND d.user_id IS NOT NULL ORDER BY d.full_name`, [organizationId]) : null,
    dbPool.query(`SELECT h.id,h.reason,h.placed_by_name,h.placed_by_kcca,h.placed_at,h.released_at,h.released_by_name,h.release_note,
       r.trip_number,r.route_date::text,t.plate_number,o.name organization_name,
       (SELECT count(*)::int FROM vehicle_location_events e WHERE e.route_id=h.route_id) points
      FROM gps_retention_holds h JOIN collection_routes r ON r.id=h.route_id JOIN organizations o ON o.id=h.organization_id
      LEFT JOIN waste_trucks t ON t.id=r.truck_id
      WHERE ($1::uuid IS NULL OR h.organization_id=$1::uuid) ORDER BY h.released_at IS NOT NULL,h.placed_at DESC LIMIT 100`, [organizationId]),
    // Purge totals cover every operator, so only KCCA sees them.
    organizationId ? null : dbPool.query("SELECT ran_at,raw_point_days,cutoff,deleted_points,held_points FROM gps_retention_runs ORDER BY ran_at DESC LIMIT 10"),
    dbPool.query(`SELECT count(*)::int points,min(recorded_at) oldest FROM vehicle_location_events WHERE ($1::uuid IS NULL OR organization_id=$1::uuid)`, [organizationId]),
  ]);
  const settings = (await dbPool.query("SELECT raw_point_days,updated_at,updated_by_name FROM gps_retention_settings")).rows[0];
  return { notice, notices: notices.rows, settings, consents: consents.rows, drivers: drivers?.rows ?? null,
    holds: holds.rows, runs: runs?.rows ?? null, stored: points.rows[0] };
}

export async function setRetention(days: number, userId: string) {
  return (await dbPool.query(`UPDATE gps_retention_settings SET raw_point_days=$1,updated_at=CURRENT_TIMESTAMP,updated_by=u.id,updated_by_name=u.full_name
    FROM users u WHERE u.id=$2::uuid RETURNING raw_point_days,updated_at,updated_by_name`, [days, userId])).rows[0];
}

/** A new notice version: every driver must agree again before their position is accepted. */
export async function publishNotice(input: { title: string; body: string; changeSummary: string }, userId: string) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE gps_privacy_notices IN EXCLUSIVE MODE");
    const row = (await client.query(`INSERT INTO gps_privacy_notices(version,title,body,change_summary,published_by,published_by_name)
      SELECT (SELECT max(version)+1 FROM gps_privacy_notices),$1,$2,$3,u.id,u.full_name FROM users u WHERE u.id=$4::uuid
      RETURNING version,title,published_at`, [input.title.trim(), input.body.trim(), input.changeSummary.trim(), userId])).rows[0];
    await client.query(`INSERT INTO notifications(recipient_user_id,organization_id,category,severity,title,body,link,dedupe_key)
      SELECT d.user_id,d.organization_id,'system','warning','Location notice updated',
        'KCCA updated the notice on sharing your location during trips. Read it and answer in the driver app; location sharing is paused until you do.',
        '/dashboard/driver-mobile','gps-notice:'||$1||':'||d.user_id
      FROM drivers d WHERE d.user_id IS NOT NULL AND d.status<>'inactive' ON CONFLICT DO NOTHING`, [row.version]);
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function placeHold(tripNumber: string, reason: string, user: { userId: string; organizationId: string | null; kcca: boolean }) {
  const trip = (await dbPool.query("SELECT id,organization_id FROM collection_routes WHERE trip_number=$1 AND ($2::uuid IS NULL OR organization_id=$2::uuid)",
    [tripNumber.trim(), user.kcca ? null : user.organizationId])).rows[0];
  if (!trip) throw fail(404, `Trip ${tripNumber} not found`);
  try {
    return (await dbPool.query(`INSERT INTO gps_retention_holds(route_id,organization_id,reason,placed_by,placed_by_name,placed_by_kcca)
      SELECT $1,$2,$3,u.id,u.full_name,$5 FROM users u WHERE u.id=$4::uuid RETURNING id,placed_at`,
    [trip.id, trip.organization_id, reason.trim(), user.userId, user.kcca])).rows[0];
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw fail(409, `Trip ${tripNumber} is already on hold`);
    throw error;
  }
}

export async function releaseHold(id: string, note: string, user: { userId: string; organizationId: string | null; kcca: boolean }) {
  const hold = (await dbPool.query("SELECT organization_id,placed_by_kcca,released_at FROM gps_retention_holds WHERE id=$1::uuid", [id])).rows[0];
  if (!hold || (!user.kcca && hold.organization_id !== user.organizationId)) throw fail(404, "Hold not found");
  if (hold.released_at) throw fail(409, "This hold was already released");
  if (hold.placed_by_kcca && !user.kcca) throw fail(403, "KCCA placed this hold; only KCCA can release it");
  return (await dbPool.query(`UPDATE gps_retention_holds SET released_at=CURRENT_TIMESTAMP,released_by=u.id,released_by_name=u.full_name,release_note=$2
    FROM users u WHERE gps_retention_holds.id=$1::uuid AND u.id=$3::uuid RETURNING gps_retention_holds.id,released_at`, [id, note.trim(), user.userId])).rows[0];
}

/** Deletes positions past the retention period, at most once every 20 hours unless forced. */
export async function runGpsRetention(force = false) {
  const last = (await dbPool.query("SELECT max(ran_at) last FROM gps_retention_runs")).rows[0].last as Date | null;
  if (!force && last && Date.now() - last.getTime() < RUN_EVERY_HOURS * 3_600_000) return null;
  const { raw_point_days: days } = (await dbPool.query("SELECT raw_point_days FROM gps_retention_settings")).rows[0];
  const cutoff = new Date(Date.now() - days * 86_400_000);
  let deleted = 0;
  for (;;) {
    const n = (await dbPool.query("SELECT purge_expired_gps_points($1,$2) n", [cutoff, BATCH])).rows[0].n as number;
    deleted += n;
    if (n < BATCH) break;
  }
  const held = (await dbPool.query("SELECT count(*)::int n FROM vehicle_location_events WHERE recorded_at<$1", [cutoff])).rows[0].n as number;
  return (await dbPool.query(`INSERT INTO gps_retention_runs(raw_point_days,cutoff,deleted_points,held_points) VALUES($1,$2,$3,$4)
    RETURNING ran_at,raw_point_days,cutoff,deleted_points,held_points`, [days, cutoff, deleted, held])).rows[0];
}
