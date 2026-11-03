import { dbPool } from "../config/database";
import { generateTrackerKey } from "../services/api-keys";

// GPS trackers fitted to trucks (migration 121). Positions are filed by kwms_record_tracker_position, which checks the
// key, finds the truck's trip and applies the driver's location consent.

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const TODAY = "(now() AT TIME ZONE 'Africa/Kampala')::date";

export type TrackerResult = "stored" | "duplicate" | "no_trip" | "no_consent" | "rejected" | "unknown_key";

export async function recordPosition(prefix: string, hash: string, ip: string, p: {
  recordedAt: Date; latitude: number; longitude: number; accuracyM: number | null; speedKph: number | null; heading: number | null;
}): Promise<TrackerResult> {
  return (await dbPool.query("SELECT kwms_record_tracker_position($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result",
    [prefix, hash, ip, p.recordedAt.toISOString(), p.latitude, p.longitude, p.accuracyM, p.speedKph, p.heading])).rows[0].result;
}

export async function listTrackers(organizationId: string) {
  return (await dbPool.query(`SELECT v.id,v.label,v.serial_number,v.key_prefix,v.truck_id,t.plate_number,v.created_by_name,v.created_at,
      v.last_seen_at,v.last_result,v.retired_at,v.retired_by_name,v.retired_reason,
      coalesce(td.stored,0) stored_today,coalesce(td.no_trip,0) no_trip_today,coalesce(td.no_consent,0) no_consent_today,
      coalesce(td.rejected,0) rejected_today,
      coalesce((SELECT sum(d.stored) FROM vehicle_tracker_daily d WHERE d.tracker_id=v.id AND d.day>${TODAY}-7),0)::int stored_7d
    FROM vehicle_trackers v JOIN waste_trucks t ON t.id=v.truck_id
    LEFT JOIN vehicle_tracker_daily td ON td.tracker_id=v.id AND td.day=${TODAY}
    WHERE v.organization_id=$1::uuid ORDER BY v.retired_at IS NOT NULL,t.plate_number,v.created_at DESC`, [organizationId])).rows;
}

/** Trucks that can take a tracker: the company's, without a working one. */
export async function trucksWithoutTracker(organizationId: string) {
  return (await dbPool.query(`SELECT t.id,t.plate_number FROM waste_trucks t WHERE t.organization_id=$1::uuid
      AND NOT EXISTS(SELECT 1 FROM vehicle_trackers v WHERE v.truck_id=t.id AND v.retired_at IS NULL) ORDER BY t.plate_number`, [organizationId])).rows;
}

export async function createTracker(organizationId: string, userId: string, input: { truckId: string; label: string; serialNumber?: string }) {
  const truck = (await dbPool.query("SELECT plate_number FROM waste_trucks WHERE id=$1::uuid AND organization_id=$2::uuid", [input.truckId, organizationId])).rows[0];
  if (!truck) throw fail(404, "Truck not found");
  const { key, prefix, hash } = generateTrackerKey();
  try {
    const row = (await dbPool.query(`INSERT INTO vehicle_trackers(organization_id,truck_id,label,serial_number,key_prefix,secret_hash,created_by,created_by_name)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,(SELECT full_name FROM users WHERE id=$7::uuid)) RETURNING id,label,key_prefix,created_at`,
    [organizationId, input.truckId, input.label, input.serialNumber ?? null, prefix, hash, userId])).rows[0];
    return { ...row, plate_number: truck.plate_number, key };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw fail(409, `${truck.plate_number} already has a working tracker. Retire it first.`);
    throw error;
  }
}

export async function retireTracker(id: string, organizationId: string, userId: string, reason: string) {
  const row = (await dbPool.query(`UPDATE vehicle_trackers SET retired_at=CURRENT_TIMESTAMP,retired_by=$3::uuid,retired_reason=$4,
      retired_by_name=(SELECT full_name FROM users WHERE id=$3::uuid)
    WHERE id=$1::uuid AND organization_id=$2::uuid AND retired_at IS NULL RETURNING id,label`, [id, organizationId, userId, reason])).rows[0];
  if (!row) throw fail(404, "No working tracker with this id");
  return row;
}
