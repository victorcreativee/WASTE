import { dbPool } from "../config/database";
import { ISSUE_SERVICE_STANDARDS_HOURS, ServiceStandards } from "../services/city-command-center.service";

/** KCCA's current standards. Falls back to code defaults until migration 091 has been applied. */
export async function loadServiceStandards(): Promise<ServiceStandards> {
  try {
    const result = await dbPool.query(`SELECT issue_category, response_hours FROM kcca_service_standards`);
    if (!result.rowCount) return { ...ISSUE_SERVICE_STANDARDS_HOURS };
    return { ...ISSUE_SERVICE_STANDARDS_HOURS, ...Object.fromEntries(result.rows.map((row) => [row.issue_category, Number(row.response_hours)])) };
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return { ...ISSUE_SERVICE_STANDARDS_HOURS };
    throw error;
  }
}

export async function serviceStandardsOverview() {
  const [standards, history] = await Promise.all([
    dbPool.query(
      `SELECT s.issue_category, s.response_hours, s.updated_at, u.full_name AS updated_by_name
       FROM kcca_service_standards s LEFT JOIN users u ON u.id = s.updated_by
       ORDER BY s.response_hours, s.issue_category`
    ),
    dbPool.query(
      `SELECT h.id, h.issue_category, h.previous_hours, h.new_hours, h.reason, h.created_at, u.full_name AS changed_by_name
       FROM kcca_service_standard_history h JOIN users u ON u.id = h.changed_by
       ORDER BY h.created_at DESC LIMIT 20`
    ),
  ]);
  return { standards: standards.rows, history: history.rows };
}

/** Change one or more standards in one audited transaction. Unchanged values are ignored. */
export async function updateServiceStandards(
  userId: string,
  changes: Array<{ category: string; responseHours: number }>,
  reason: string
) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT issue_category, response_hours FROM kcca_service_standards
       WHERE issue_category = ANY($1::text[]) FOR UPDATE`,
      [changes.map((change) => change.category)]
    );
    const before = new Map(current.rows.map((row) => [row.issue_category, Number(row.response_hours)]));
    let changed = 0;
    for (const change of changes) {
      const previous = before.get(change.category);
      if (previous === undefined) throw Object.assign(new Error(`Unknown issue category: ${change.category}`), { statusCode: 400 });
      if (previous === change.responseHours) continue;
      await client.query(
        `UPDATE kcca_service_standards SET response_hours = $2, updated_by = $3::uuid, updated_at = CURRENT_TIMESTAMP
         WHERE issue_category = $1`,
        [change.category, change.responseHours, userId]
      );
      await client.query(
        `INSERT INTO kcca_service_standard_history (issue_category, previous_hours, new_hours, reason, changed_by)
         VALUES ($1, $2, $3, $4, $5::uuid)`,
        [change.category, previous, change.responseHours, reason, userId]
      );
      changed++;
    }
    if (!changed) throw Object.assign(new Error("No standard was changed"), { statusCode: 409 });
    await client.query("COMMIT");
    return changed;
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "42P01") {
      throw Object.assign(new Error("Service standards are not set up yet. Apply database migration 091."), { statusCode: 503 });
    }
    throw error;
  } finally {
    client.release();
  }
}
