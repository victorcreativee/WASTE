import { dbPool } from "../config/database";

/**
 * Requests that wait on a city administrator's decision, one row per queue. Each queue lists who can decide it and
 * which page it is decided on; a queue is shown only to a role that has that page.
 */
const QUEUES = [
  { key: "account_applications", label: "Company account requests", action: "Verify and approve", href: "/dashboard/account-applications", roles: ["system_admin"],
    sql: `SELECT created_at AS at FROM organization_account_applications WHERE status IN('submitted','under_review')` },
  { key: "permit_applications", label: "Permit applications", action: "Review documents", href: "/dashboard/permits", roles: ["kcca_admin", "system_admin"],
    sql: `SELECT COALESCE(submitted_at,created_at) AS at FROM organization_permit_applications WHERE status IN('submitted','under_review')` },
  // A collector with a current permit but no division cannot create zones, routes or trips until KCCA assigns one.
  { key: "divisions_to_assign", label: "Collectors waiting for divisions", action: "Assign divisions", href: "/dashboard/organizations", roles: ["kcca_admin"],
    sql: `SELECT COALESCE(p.approved_at,o.created_at) AS at FROM organizations o JOIN LATERAL (SELECT max(COALESCE(pa.reviewed_at,pa.updated_at)) approved_at FROM organization_permit_applications pa WHERE pa.organization_id=o.id AND pa.status='approved' AND pa.valid_until>=CURRENT_DATE) p ON p.approved_at IS NOT NULL
      WHERE o.type='waste_collection_company' AND o.is_active AND NOT EXISTS(SELECT 1 FROM organization_division_authorizations a WHERE a.organization_id=o.id AND a.status='active')` },
  { key: "permit_renewals", label: "Permit renewal requests", action: "Decide renewals", href: "/dashboard/permits", roles: ["kcca_admin", "system_admin"],
    sql: `SELECT created_at AS at FROM permit_renewal_requests WHERE status='submitted'` },
  { key: "monthly_returns", label: "Monthly returns to review", action: "Open returns register", href: "/dashboard/returns-register", roles: ["kcca_admin"],
    sql: `SELECT submitted_at AS at FROM regulatory_returns WHERE status='submitted'` },
  { key: "penalty_appeals", label: "Penalty appeals", action: "Decide appeals", href: "/dashboard/penalties", roles: ["kcca_admin", "system_admin"],
    sql: `SELECT COALESCE((SELECT max(a.submitted_at) FROM penalty_appeals a WHERE a.notice_id=n.id),n.updated_at) AS at FROM penalty_notices n WHERE n.status='appealed'` },
  { key: "penalty_payments", label: "Penalty payments to confirm", action: "Confirm payments", href: "/dashboard/penalties", roles: ["kcca_admin", "system_admin"],
    sql: `SELECT COALESCE(payment_submitted_at,updated_at) AS at FROM penalty_notices WHERE status='payment_submitted'` },
  { key: "disposal_explanations", label: "Disposal explanations", action: "Accept or reject", href: "/dashboard/disposal-oversight", roles: ["kcca_admin", "system_admin"],
    sql: `SELECT submitted_at AS at FROM trip_disposal_explanations WHERE status='submitted'` },
  { key: "dumping_reports", label: "New illegal dumping reports", action: "Inspect sites", href: "/dashboard/dumping", roles: ["kcca_admin", "system_admin"],
    sql: `SELECT COALESCE(last_reported_at,created_at) AS at FROM dumping_sites WHERE status='reported'` },
  { key: "cleanups_reported", label: "Cleanups to confirm", action: "Confirm cleanups", href: "/dashboard/dumping", roles: ["kcca_admin", "system_admin"],
    sql: `SELECT cleanup_reported_at AS at FROM dumping_sites WHERE status='cleanup_reported'` },
  { key: "compliance_responses", label: "Compliance responses", action: "Close or reopen cases", href: "/dashboard/compliance", roles: ["kcca_admin"],
    sql: `SELECT COALESCE(responded_at,updated_at) AS at FROM collector_compliance_cases WHERE status='remediation_submitted'` },
] as const;

export type RequestQueue = { key: string; label: string; action: string; href: string; waiting: number; arrivedToday: number; oldestAt: string | null; newestAt: string | null };

/** Something that arrived in the last 24 hours is marked as new. */
export async function pendingRequests(roles: string[]): Promise<RequestQueue[]> {
  const queues = QUEUES.filter(queue => queue.roles.some(role => roles.includes(role)));
  if (!queues.length) return [];
  const union = queues.map((queue, index) =>
    `SELECT ${index} AS i,COUNT(*)::int AS waiting,COUNT(*) FILTER(WHERE at>CURRENT_TIMESTAMP-interval '24 hours')::int AS arrived_today,min(at) AS oldest_at,max(at) AS newest_at FROM (${queue.sql}) q${index}`).join(" UNION ALL ");
  const rows = (await dbPool.query(union)).rows as Array<{ i: number; waiting: number; arrived_today: number; oldest_at: Date | null; newest_at: Date | null }>;
  return rows.sort((a, b) => a.i - b.i).map(row => {
    const { key, label, action, href } = queues[row.i];
    return { key, label, action, href, waiting: row.waiting, arrivedToday: row.arrived_today, oldestAt: row.oldest_at?.toISOString() ?? null, newestAt: row.newest_at?.toISOString() ?? null };
  });
}
