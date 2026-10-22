import { dbPool } from "../config/database";
import { loadServiceStandards } from "./service-standards.repository";
import { cityOverview } from "./recycling-oversight.repository";
import { register } from "./regulatory-returns.repository";
import { collectorServiceScore, issueStandardHours, scoreBand, ServiceStandards } from "../services/city-command-center.service";
import { recoveryRate } from "../services/recycling-oversight.rules";
import { RETURNS_FIRST_PERIOD } from "../services/regulatory-returns.rules";
import { Kpis, ReportPeriod, change, generateInsights, issueStandardSummary, resolveReportPeriod, share, trendMonths } from "../services/city-report.rules";

// Composes KCCA's city report for a month or quarter from operational records, and issues frozen snapshots of it.

const num = (value: unknown) => Number(value ?? 0);
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

export async function today(): Promise<string> {
  return (await dbPool.query("SELECT CURRENT_DATE::text AS d")).rows[0].d;
}

function monthsIn(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  while (`${y}-${String(m).padStart(2, "0")}` <= to.slice(0, 7)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m === 13) { m = 1; y++; }
  }
  return months;
}

/** Returns filing for every reporting month in the range that has already fallen due. */
async function returnsFiling(from: string, to: string, dateToday: string) {
  const months = monthsIn(from, to).filter(month => month >= RETURNS_FIRST_PERIOD && month < dateToday.slice(0, 7));
  const registers = await Promise.all(months.map(month => register(month)));
  const rows = registers.map(r => ({
    period: r.period, due_on: r.due_on, required: r.totals.required,
    filed: r.totals.submitted + r.totals.queried + r.totals.accepted, late: r.totals.late, accepted: r.totals.accepted, outstanding: r.totals.due + r.totals.overdue,
  }));
  const required = rows.reduce((n, r) => n + r.required, 0), filed = rows.reduce((n, r) => n + r.filed, 0), late = rows.reduce((n, r) => n + r.late, 0);
  return { months: rows, required, filed, on_time: filed - late, filing_rate: share(filed, required) };
}

async function kpis(from: string, to: string, standards: ServiceStandards, dateToday: string): Promise<Kpis> {
  const [row, resolved, filing] = await Promise.all([
    dbPool.query(
      `SELECT
         (SELECT COUNT(*) FROM collection_jobs WHERE job_date BETWEEN $1 AND $2 AND status<>'cancelled') AS jobs_scheduled,
         (SELECT COUNT(*) FROM collection_jobs WHERE job_date BETWEEN $1 AND $2 AND status='completed') AS jobs_completed,
         (SELECT COUNT(*) FROM collection_jobs WHERE job_date BETWEEN $1 AND $2 AND status='missed') AS jobs_missed,
         (SELECT COUNT(*) FROM collection_routes WHERE route_date BETWEEN $1 AND $2 AND status='completed') AS trips_completed,
         (SELECT COUNT(*) FROM collection_routes WHERE route_date BETWEEN $1 AND $2 AND status='completed' AND weight_verified_at IS NOT NULL) AS trips_verified,
         (SELECT COALESCE(SUM(net_kg),0) FROM weighbridge_transactions WHERE operation_date BETWEEN $1 AND $2 AND status='completed') AS disposed_kg,
         (SELECT COUNT(*) FROM citizen_issues WHERE created_at::date BETWEEN $1 AND $2) AS issues_received,
         (SELECT COALESCE(SUM(l.quantity_kg),0) FROM recycling_material_lots l JOIN organizations o ON o.id=l.organization_id AND o.type='recycling_company'
            WHERE l.origin='purchase' AND l.status<>'rejected' AND l.collected_on BETWEEN $1 AND $2) AS recyclables_kg,
         (SELECT COUNT(*) FROM collector_compliance_cases WHERE created_at::date BETWEEN $1 AND $2) AS cases_opened,
         (SELECT COUNT(*) FROM collector_compliance_cases WHERE closed_at::date BETWEEN $1 AND $2) AS cases_closed`,
      [from, to]),
    dbPool.query(
      `SELECT category,EXTRACT(EPOCH FROM (resolved_at-created_at))/3600 AS hours FROM citizen_issues
       WHERE status='resolved' AND resolved_at IS NOT NULL AND resolved_at::date BETWEEN $1 AND $2`, [from, to]),
    returnsFiling(from, to, dateToday),
  ]);
  const r = row.rows[0], issues = issueStandardSummary(resolved.rows.map(x => ({ category: x.category, hours: num(x.hours) })), standards);
  return {
    jobs_scheduled: num(r.jobs_scheduled), jobs_completed: num(r.jobs_completed), jobs_missed: num(r.jobs_missed),
    completion_rate: share(num(r.jobs_completed), num(r.jobs_scheduled)),
    trips_completed: num(r.trips_completed), trips_verified: num(r.trips_verified), verification_rate: share(num(r.trips_verified), num(r.trips_completed)),
    disposed_kg: num(r.disposed_kg), issues_received: num(r.issues_received), issues_resolved: issues.resolved,
    within_standard_rate: issues.within_standard_rate, median_resolution_hours: issues.median_hours,
    recyclables_kg: num(r.recyclables_kg), recovery_rate: recoveryRate(num(r.recyclables_kg), num(r.disposed_kg)),
    cases_opened: num(r.cases_opened), cases_closed: num(r.cases_closed),
    returns_required: filing.required, returns_filed: filing.filed, returns_on_time: filing.on_time, returns_filing_rate: filing.filing_rate,
  };
}

async function licensing(period: ReportPeriod) {
  const [counts, unlicensed] = await Promise.all([
    dbPool.query(
      `SELECT
         (SELECT COUNT(*) FROM organization_permit_applications WHERE permit_number IS NOT NULL AND valid_from<=$2 AND (valid_until IS NULL OR valid_until>=$2)
            AND status<>'rejected' AND NOT (status='suspended' AND suspended_at::date<=$2)) AS in_force_at_end,
         (SELECT COUNT(*) FROM organization_permit_history WHERE created_at::date BETWEEN $1 AND $2 AND new_status='approved'
            AND (previous_status='under_review' OR notes LIKE 'Permit issued directly%')) AS issued,
         (SELECT COUNT(*) FROM organization_permit_history WHERE created_at::date BETWEEN $1 AND $2 AND notes LIKE 'Permit extended%') AS renewed,
         (SELECT COUNT(*) FROM organization_permit_history WHERE created_at::date BETWEEN $1 AND $2 AND new_status='suspended' AND previous_status IS DISTINCT FROM 'suspended') AS suspended,
         (SELECT COUNT(*) FROM organization_permit_history WHERE created_at::date BETWEEN $1 AND $2 AND new_status='expired' AND previous_status IS DISTINCT FROM 'expired') AS expired,
         (SELECT COUNT(*) FROM permit_renewal_requests WHERE created_at::date BETWEEN $1 AND $2) AS renewal_requests,
         (SELECT COUNT(*) FROM organization_permit_applications WHERE status='approved' AND valid_until BETWEEN $2::date+1 AND $2::date+60) AS expiring_within_60_days`,
      [period.from, period.to]),
    dbPool.query(
      `SELECT o.name,o.type FROM organizations o WHERE o.type IN('waste_collection_company','recycling_company') AND o.is_active
         AND NOT EXISTS(SELECT 1 FROM organization_permit_applications p WHERE p.organization_id=o.id AND p.permit_number IS NOT NULL) ORDER BY o.name`),
  ]);
  return { ...Object.fromEntries(Object.entries(counts.rows[0]).map(([k, v]) => [k, num(v)])), no_permit_on_record: unlicensed.rows } as Record<string, number> & { no_permit_on_record: Array<{ name: string; type: string }> };
}

async function collectionByDivision(period: ReportPeriod) {
  const { rows } = await dbPool.query(
    `SELECT COALESCE(d.name,'Not linked to a division') AS division,
       COUNT(*) FILTER (WHERE j.status<>'cancelled') AS scheduled,COUNT(*) FILTER (WHERE j.status='completed') AS completed,COUNT(*) FILTER (WHERE j.status='missed') AS missed
     FROM collection_jobs j LEFT JOIN waste_zones z ON z.id=j.zone_id LEFT JOIN kampala_divisions d ON d.id=z.division_id
     WHERE j.job_date BETWEEN $1 AND $2 GROUP BY d.name ORDER BY d.name NULLS LAST`, [period.from, period.to]);
  return rows.map(r => ({ division: r.division, scheduled: num(r.scheduled), completed: num(r.completed), missed: num(r.missed), completion_rate: share(num(r.completed), num(r.scheduled)) }));
}

async function issuesByCategory(period: ReportPeriod, standards: ServiceStandards) {
  const [received, resolved] = await Promise.all([
    dbPool.query("SELECT category,COUNT(*) AS n FROM citizen_issues WHERE created_at::date BETWEEN $1 AND $2 GROUP BY category", [period.from, period.to]),
    dbPool.query(`SELECT category,EXTRACT(EPOCH FROM (resolved_at-created_at))/3600 AS hours FROM citizen_issues
      WHERE status='resolved' AND resolved_at IS NOT NULL AND resolved_at::date BETWEEN $1 AND $2`, [period.from, period.to]),
  ]);
  const categories = Array.from(new Set([...received.rows.map(r => r.category), ...resolved.rows.map(r => r.category)])).sort();
  return categories.map(category => {
    const summary = issueStandardSummary(resolved.rows.filter(r => r.category === category).map(r => ({ category, hours: num(r.hours) })), standards);
    return { category, standard_hours: issueStandardHours(category, standards), received: num(received.rows.find(r => r.category === category)?.n), ...summary };
  });
}

async function accountability(period: ReportPeriod) {
  const { rows } = await dbPool.query(
    `SELECT category,COUNT(*) FILTER (WHERE created_at::date BETWEEN $1 AND $2) AS opened,COUNT(*) FILTER (WHERE closed_at::date BETWEEN $1 AND $2) AS closed,
       COUNT(*) FILTER (WHERE created_at::date<=$2 AND (closed_at IS NULL OR closed_at::date>$2)) AS open_at_end
     FROM collector_compliance_cases GROUP BY category ORDER BY category`, [period.from, period.to]);
  return rows.map(r => ({ category: r.category, opened: num(r.opened), closed: num(r.closed), open_at_end: num(r.open_at_end) })).filter(r => r.opened || r.closed || r.open_at_end);
}

/** Collector league table using the command centre's transparent service score, over the report period. */
async function collectors(period: ReportPeriod, standards: ServiceStandards) {
  const [rows, issues] = await Promise.all([
    dbPool.query(
      `SELECT o.id,o.name,o.is_active,
         (SELECT COUNT(*) FROM collection_jobs j WHERE j.organization_id=o.id AND j.job_date BETWEEN $1 AND $2 AND j.status<>'cancelled') AS jobs,
         (SELECT COUNT(*) FROM collection_jobs j WHERE j.organization_id=o.id AND j.job_date BETWEEN $1 AND $2 AND j.status='completed') AS completed_jobs,
         (SELECT COUNT(*) FROM collection_jobs j WHERE j.organization_id=o.id AND j.job_date BETWEEN $1 AND $2 AND j.status='missed') AS missed_jobs,
         (SELECT COUNT(*) FROM collection_routes r WHERE r.organization_id=o.id AND r.route_date BETWEEN $1 AND $2 AND r.status='completed') AS completed_trips,
         (SELECT COUNT(*) FROM collection_routes r WHERE r.organization_id=o.id AND r.route_date BETWEEN $1 AND $2 AND r.status='completed' AND r.weight_verified_at IS NULL) AS unverified_trips,
         (SELECT COALESCE(SUM(net_kg),0) FROM weighbridge_transactions w WHERE w.organization_id=o.id AND w.status='completed' AND w.operation_date BETWEEN $1 AND $2) AS disposed_kg,
         (SELECT COUNT(*) FROM collector_compliance_cases c WHERE c.organization_id=o.id AND c.created_at::date<=$2 AND (c.closed_at IS NULL OR c.closed_at::date>$2)) AS open_cases,
         (SELECT COUNT(*) FROM collector_compliance_cases c WHERE c.organization_id=o.id AND c.severity='critical' AND c.created_at::date<=$2 AND (c.closed_at IS NULL OR c.closed_at::date>$2)) AS critical_cases,
         permit.permit_number,permit.status AS permit_status,permit.valid_until::text AS permit_valid_until,permit.suspended_on
       FROM organizations o
       LEFT JOIN LATERAL (SELECT p.permit_number,p.status,p.valid_until,p.suspended_at::date AS suspended_on FROM organization_permit_applications p
         WHERE p.organization_id=o.id AND p.permit_number IS NOT NULL AND p.valid_from<=$2
         ORDER BY (p.status IN('approved','suspended')) DESC,p.valid_until DESC NULLS LAST LIMIT 1) permit ON true
       WHERE o.type='waste_collection_company'
       ORDER BY o.name`, [period.from, period.to]),
    dbPool.query(
      `SELECT assigned_organization_id AS organization_id,category,
         EXTRACT(EPOCH FROM (COALESCE(resolved_at,LEAST(now(),($2::date+1)::timestamp))-created_at))/3600 AS hours
       FROM citizen_issues WHERE assigned_organization_id IS NOT NULL AND status<>'rejected' AND created_at::date BETWEEN $1 AND $2`, [period.from, period.to]),
  ]);
  return rows.rows.map(r => {
    const mine = issues.rows.filter(i => i.organization_id === r.id);
    const overdue = mine.filter(i => num(i.hours) > issueStandardHours(i.category, standards)).length;
    const complianceState = !r.is_active ? "suspended" : !r.permit_number ? "permit_missing"
      : r.permit_status === "suspended" && r.suspended_on && r.suspended_on <= period.to ? "suspended"
      : r.permit_status === "expired" || (r.permit_valid_until && r.permit_valid_until < period.to) ? "permit_expired" : "compliant";
    const input = {
      jobs: num(r.jobs), completed_jobs: num(r.completed_jobs), missed_jobs: num(r.missed_jobs), completed_trips: num(r.completed_trips),
      unverified_trips: num(r.unverified_trips), open_issues: mine.length, overdue_issues: overdue,
      open_compliance_cases: num(r.open_cases), critical_compliance_cases: num(r.critical_cases), compliance_state: complianceState,
    };
    const score = collectorServiceScore(input);
    return {
      id: r.id, name: r.name, is_active: r.is_active, permit_number: r.permit_number, ...input, disposed_kg: num(r.disposed_kg),
      completion_rate: share(input.completed_jobs, input.jobs), verification_rate: share(input.completed_trips - input.unverified_trips, input.completed_trips),
      service_score: score, band: scoreBand(score),
    };
  }).filter(c => c.is_active || c.jobs || c.completed_trips || c.disposed_kg)
    .sort((a, b) => (b.service_score ?? -1) - (a.service_score ?? -1) || a.name.localeCompare(b.name));
}

async function trend(period: ReportPeriod) {
  const months = trendMonths(period.to);
  const { rows } = await dbPool.query(
    `SELECT to_char(m,'YYYY-MM') AS month,
       (SELECT COUNT(*) FROM collection_jobs WHERE job_date>=m AND job_date<m+interval '1 month' AND status<>'cancelled') AS scheduled,
       (SELECT COUNT(*) FROM collection_jobs WHERE job_date>=m AND job_date<m+interval '1 month' AND status='completed') AS completed,
       (SELECT COALESCE(SUM(net_kg),0) FROM weighbridge_transactions WHERE operation_date>=m AND operation_date<m+interval '1 month' AND status='completed') AS disposed_kg,
       (SELECT COUNT(*) FROM citizen_issues WHERE created_at>=m AND created_at<m+interval '1 month') AS issues,
       (SELECT COALESCE(SUM(l.quantity_kg),0) FROM recycling_material_lots l JOIN organizations o ON o.id=l.organization_id AND o.type='recycling_company'
          WHERE l.origin='purchase' AND l.status<>'rejected' AND l.collected_on>=m AND l.collected_on<m+interval '1 month') AS recyclables_kg
     FROM unnest($1::date[]) m ORDER BY m`, [months.map(month => `${month}-01`)]);
  return rows.map(r => ({ month: r.month, completion_rate: share(num(r.completed), num(r.scheduled)), disposed_kg: num(r.disposed_kg), issues: num(r.issues), recyclables_kg: num(r.recyclables_kg) }));
}

export async function buildCityReport(periodKey: string) {
  const dateToday = await today();
  const period = resolveReportPeriod(periodKey, dateToday);
  const standards = await loadServiceStandards();
  const [current, previous, licence, byDivision, issues, cases, league, months, recycling, filing] = await Promise.all([
    kpis(period.from, period.to, standards, dateToday),
    kpis(period.previous.from, period.previous.to, standards, dateToday),
    licensing(period),
    collectionByDivision(period),
    issuesByCategory(period, standards),
    accountability(period),
    collectors(period, standards),
    trend(period),
    cityOverview({ from: period.from, to: period.to, label: period.label }),
    returnsFiling(period.from, period.to, dateToday),
  ]);
  const changes = Object.fromEntries(Object.keys(current).map(key => [key, change((current as any)[key], (previous as any)[key])]));
  const insights = generateInsights({
    current, previous, collectors: league,
    expiringPermits: licence.expiring_within_60_days, unlicensedCompanies: licence.no_permit_on_record.length,
    recyclersNeedingAction: recycling.totals.needing_action,
  });
  return {
    period, generated_at: new Date().toISOString(), standards,
    headline: { current, previous, change: changes },
    insights,
    licensing: licence,
    collection: { by_division: byDivision },
    issues: { by_category: issues },
    recycling: { totals: recycling.totals, categories: recycling.categories, industries: recycling.industries.slice(0, 5), factories: recycling.factories.totals },
    accountability: { cases, returns: filing },
    collectors: league,
    trend: months,
  };
}

// ---------- Issued reports ----------

export async function issueCityReport(periodKey: string, userId: string, commentary: string | undefined, replaceReason: string | undefined) {
  const report = await buildCityReport(periodKey);
  if (!report.period.complete) throw badRequest("Only a completed period can be issued. View it as a draft until it ends.");
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`city-report:${report.period.key}`]);
    const existing = (await client.query("SELECT id,report_number FROM city_reports WHERE period_key=$1 AND status='issued' FOR UPDATE", [report.period.key])).rows[0];
    if (existing && !replaceReason) throw conflict(`${existing.report_number} is already issued for ${report.period.label}. Give a reason to issue a replacement.`);
    const count = num((await client.query("SELECT COUNT(*) AS n FROM city_reports WHERE period_key=$1", [report.period.key])).rows[0].n);
    const number = `KCCA-CR-${report.period.key}${count ? `-R${count}` : ""}`;
    // The replacement's id is reserved first so the old report can point to it; the link is checked at commit.
    const id = (await client.query("SELECT uuid_generate_v4() AS id")).rows[0].id;
    if (existing) {
      await client.query("UPDATE city_reports SET status='superseded',superseded_by=$2,superseded_reason=$3,superseded_at=CURRENT_TIMESTAMP WHERE id=$1",
        [existing.id, id, replaceReason]);
    }
    const row = (await client.query(
      `INSERT INTO city_reports(id,report_number,period_type,period_key,period_from,period_to,title,data,commentary,issued_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,report_number,period_key,title,status,issued_at`,
      [id, number, report.period.type, report.period.key, report.period.from, report.period.to, `Kampala waste services report — ${report.period.label}`,
        JSON.stringify(report), commentary || null, userId])).rows[0];
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listCityReports() {
  return (await dbPool.query(
    `SELECT r.id,r.report_number,r.period_type,r.period_key,r.title,r.status,r.issued_at,u.full_name AS issued_by_name,
       r.superseded_reason,r.superseded_at,n.report_number AS superseded_by_number
     FROM city_reports r JOIN users u ON u.id=r.issued_by LEFT JOIN city_reports n ON n.id=r.superseded_by
     ORDER BY r.period_from DESC,r.issued_at DESC LIMIT 200`)).rows;
}

export async function getCityReport(id: string) {
  return (await dbPool.query(
    `SELECT r.*,r.period_from::text AS period_from,r.period_to::text AS period_to,u.full_name AS issued_by_name,n.report_number AS superseded_by_number
     FROM city_reports r JOIN users u ON u.id=r.issued_by LEFT JOIN city_reports n ON n.id=r.superseded_by WHERE r.id=$1::uuid`, [id])).rows[0] ?? null;
}
