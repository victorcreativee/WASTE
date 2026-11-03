import { dbPool } from "../config/database";
import { Page, queryPage } from "../utils/pagination";

// The audit log (migration 113) is written by database triggers, never by the services, and cannot be changed.
// Row-level security already limits a company to its own entries; the filters here narrow what is shown.

const KAMPALA = "Africa/Kampala";

export type AuditFilter = {
  organizationId: string | null; from?: string; to?: string; table?: string; action?: string; actorId?: string;
  recordId?: string; origin?: "app" | "direct"; search?: string;
};

const columns = `a.id::text,a.occurred_at,a.organization_id,o.name organization_name,a.actor_id,u.full_name actor_name,u.email actor_email,
 a.actor_roles,a.actor_scope,a.ip,a.request_id,a.request_path,a.source,a.db_user,a.table_name,a.record_id,a.action,a.changed_fields`;
const joins = `FROM audit_log a LEFT JOIN organizations o ON o.id=a.organization_id LEFT JOIN users u ON u.id=a.actor_id`;

export async function listAudit(filter: AuditFilter, page: Page) {
  return queryPage(`SELECT ${columns} ${joins}
   WHERE ($1::uuid IS NULL OR a.organization_id=$1::uuid)
    AND ($2::date IS NULL OR a.occurred_at>=($2::date::timestamp AT TIME ZONE '${KAMPALA}'))
    AND ($3::date IS NULL OR a.occurred_at<(($3::date+1)::timestamp AT TIME ZONE '${KAMPALA}'))
    AND ($4::text IS NULL OR a.table_name=$4)
    AND ($5::text IS NULL OR a.action=$5)
    AND ($6::uuid IS NULL OR a.actor_id=$6::uuid)
    AND ($7::text IS NULL OR a.record_id=$7)
    AND ($8::text IS NULL OR ($8='direct')=(a.actor_scope IS NULL))
    AND ($9::text IS NULL OR a.ip ILIKE $9||'%' OR a.request_id=$9 OR u.full_name ILIKE '%'||$9||'%' OR u.email ILIKE '%'||$9||'%')
   ORDER BY a.occurred_at DESC,a.id DESC`,
  [filter.organizationId, filter.from ?? null, filter.to ?? null, filter.table ?? null, filter.action ?? null, filter.actorId ?? null,
    filter.recordId || null, filter.origin ?? null, filter.search || null], page);
}

export async function findAuditEntry(id: string, organizationId: string | null) {
  return (await dbPool.query(`SELECT ${columns},a.before_state,a.after_state ${joins}
   WHERE a.id=$1::bigint AND ($2::uuid IS NULL OR a.organization_id=$2::uuid)`, [id, organizationId])).rows[0] ?? null;
}

/** Record types that appear in the log, and for KCCA the organizations to filter by. */
export async function auditFilterOptions(organizationId: string | null) {
  const [tables, organizations] = await Promise.all([
    dbPool.query(`SELECT DISTINCT table_name FROM audit_log WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) ORDER BY 1`, [organizationId]),
    organizationId ? null : dbPool.query("SELECT id,name FROM organizations ORDER BY name"),
  ]);
  return { tables: tables.rows.map(row => row.table_name as string), organizations: organizations?.rows ?? [] };
}

/** Whether the database is enforcing tenant isolation for this service right now, and on which tables. */
export async function isolationStatus() {
  const client = await dbPool.connect();
  try {
    const session = (await client.query(`SELECT current_user AS database_role, r.rolsuper AS superuser, r.rolbypassrls AS bypasses_row_security,
       current_setting('app.scope', true) AS scope FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
    const tables = (await client.query("SELECT * FROM kwms_row_security_report()")).rows;
    const log = (await client.query(`SELECT count(*)::int entries, min(occurred_at) since,
       count(*) FILTER (WHERE actor_scope IS NULL AND occurred_at>now()-interval '30 days')::int direct_changes_30_days FROM audit_log`)).rows[0];
    return { ...session, enforced: !session.superuser && !session.bypasses_row_security, tables, log };
  } finally {
    client.release();
  }
}
