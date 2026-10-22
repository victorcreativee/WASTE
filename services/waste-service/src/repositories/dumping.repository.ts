import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { Page, queryPage } from "../utils/pagination";
import type { Period } from "../services/recycling-oversight.rules";
import {
  DUMPING_RULES, OPEN_STATUSES, SiteStatus, Size, cleanupDaysFor, cleanupDueError, insideKampala, isHotspot, medianDays, reportOutcome,
} from "../services/dumping.rules";
import { notifyOrganization, notifyRole } from "../services/notify";

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const POINT = (lat: string, lng: string) => `ST_SetSRID(ST_MakePoint(${lng}::float8,${lat}::float8),4326)::geography`;
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export type Scope = { userId: string; organizationId: string | null; kind: "kcca" | "company" | "citizen" };

export async function today() {
  return (await dbPool.query("SELECT CURRENT_DATE::text AS d")).rows[0].d as string;
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function log(client: PoolClient, siteId: string, action: string, from: string | null, to: string, note: string | null, actor: string | null) {
  await client.query("INSERT INTO dumping_site_history(site_id,action,from_status,to_status,note,actor_user_id) VALUES($1,$2,$3,$4,$5,$6)",
    [siteId, action, from, to, note, actor]);
}

async function addPhoto(client: PoolClient, siteId: string, reportId: string | null, stage: string, image: string, userId: string) {
  const count = (await client.query("SELECT COUNT(*)::int AS n FROM dumping_photos WHERE site_id=$1", [siteId])).rows[0].n as number;
  if (count >= DUMPING_RULES.maxPhotosPerSite) throw fail(409, `A site can hold at most ${DUMPING_RULES.maxPhotosPerSite} photos`);
  await client.query("INSERT INTO dumping_photos(site_id,report_id,stage,image_data,uploaded_by) VALUES($1,$2,$3,$4,$5)", [siteId, reportId, stage, image, userId]);
}

/** Keeps residents' illegal-dumping issues in step with the site they reported. */
async function syncCitizenIssues(client: PoolClient, siteId: string, status: "triaged" | "in_progress" | "resolved" | "rejected", note: string | null) {
  await client.query(
    `UPDATE citizen_issues SET status=$2::text,resolution_notes=COALESCE($3::text,resolution_notes),
       resolved_at=CASE WHEN $2::text='resolved' THEN COALESCE(resolved_at,CURRENT_TIMESTAMP) ELSE resolved_at END,updated_at=CURRENT_TIMESTAMP
     WHERE id IN(SELECT citizen_issue_id FROM dumping_reports WHERE site_id=$1 AND citizen_issue_id IS NOT NULL) AND status NOT IN('resolved','rejected')`,
    [siteId, status, note]);
}

export async function divisions() {
  return (await dbPool.query("SELECT id,name FROM kampala_divisions WHERE is_active ORDER BY name")).rows;
}

// ---------- Reports ----------

export type ReportInput = {
  userId: string; source: "resident" | "kcca_officer" | "collector"; organizationId: string | null; latitude: number; longitude: number;
  landmark?: string | null; divisionId?: string | null; description: string; photo?: string | null; citizenIssueId?: string | null;
};

/**
 * Records a report. Within the merge radius of an open site it joins that site; at a site cleared recently it brings the
 * site back (a recurrence); otherwise it starts a new site. Pass the caller's client to run inside its transaction.
 */
export async function createReport(input: ReportInput, client?: PoolClient) {
  if (!insideKampala(input.latitude, input.longitude)) throw fail(400, "The location must be within Kampala");
  const work = async (c: PoolClient) => {
    const lat = String(input.latitude), lng = String(input.longitude);
    const nearby = (await c.query(
      `SELECT id,site_number,status,landmark,division_id,recurrence_count,
         CASE WHEN cleared_at IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM CURRENT_TIMESTAMP-cleared_at)/86400 END AS cleared_days_ago
       FROM dumping_sites WHERE status<>'dismissed' AND ST_DWithin(location,${POINT("$1", "$2")},$3)
       ORDER BY (status=ANY($4::text[])) DESC,ST_Distance(location,${POINT("$1", "$2")}) LIMIT 1 FOR UPDATE`,
      [lat, lng, DUMPING_RULES.mergeRadiusM, OPEN_STATUSES])).rows[0];
    const outcome = reportOutcome(nearby ? { status: nearby.status, cleared_days_ago: nearby.cleared_days_ago === null ? null : Number(nearby.cleared_days_ago) } : null);
    let site: { id: string; site_number: string; status: string; recurrence_count: number; landmark: string | null };
    if (outcome === "new_site") {
      site = (await c.query(
        `INSERT INTO dumping_sites(location,landmark,division_id) VALUES(${POINT("$1", "$2")},$3,$4) RETURNING id,site_number,status,recurrence_count,landmark`,
        [lat, lng, input.landmark || null, input.divisionId || null])).rows[0];
      await log(c, site.id, "reported", null, "reported", null, input.userId);
    } else if (outcome === "additional_report") {
      site = (await c.query(
        `UPDATE dumping_sites SET last_reported_at=CURRENT_TIMESTAMP,landmark=COALESCE(landmark,$2),division_id=COALESCE(division_id,$3)
         WHERE id=$1 RETURNING id,site_number,status,recurrence_count,landmark`, [nearby.id, input.landmark || null, input.divisionId || null])).rows[0];
      await log(c, site.id, "additional_report", site.status, site.status, null, input.userId);
    } else {
      site = (await c.query(
        `UPDATE dumping_sites SET status='reported',recurrence_count=recurrence_count+1,last_reported_at=CURRENT_TIMESTAMP,
           cleanup_organization_id=NULL,cleanup_due_on=NULL,verified_at=NULL,cleanup_ordered_at=NULL,cleanup_reported_at=NULL
         WHERE id=$1 RETURNING id,site_number,status,recurrence_count,landmark`, [nearby.id])).rows[0];
      await log(c, site.id, "recurred", "cleared", "reported", null, input.userId);
    }
    const report = (await c.query(
      `INSERT INTO dumping_reports(site_id,source,reporter_user_id,reporter_organization_id,citizen_issue_id,location,description)
       VALUES($1,$2,$3,$4,$5,${POINT("$6", "$7")},$8) RETURNING id`,
      [site.id, input.source, input.userId, input.organizationId, input.citizenIssueId || null, lat, lng, input.description.trim()])).rows[0];
    if (input.photo) await addPhoto(c, site.id, report.id, "report", input.photo, input.userId);
    const where = site.landmark ? ` at ${site.landmark}` : "";
    if (outcome === "new_site") {
      await notifyRole(c, "kcca_admin", { category: "dumping", severity: "info", title: `Illegal dumping reported${where}`,
        body: `${site.site_number}: ${input.description.trim().slice(0, 200)}. Inspect it in Illegal dumping.`, link: "/dashboard/dumping", dedupeKey: `dumping-site:${site.id}` });
    } else if (outcome === "recurred") {
      await notifyRole(c, "kcca_admin", { category: "dumping", severity: "warning", title: `Dumping is back${where}`,
        body: `${site.site_number} was cleared and has been reported again (${site.recurrence_count} time${site.recurrence_count === 1 ? "" : "s"}).`,
        link: "/dashboard/dumping", dedupeKey: `dumping-recurred:${site.id}:${site.recurrence_count}` });
    }
    return { site_id: site.id, site_number: site.site_number, status: site.status, outcome, report_id: report.id as string };
  };
  return client ? work(client) : inTransaction(work);
}

// ---------- Reading ----------

const SITE_COLUMNS = `s.id,s.site_number,ST_Y(s.location::geometry) AS latitude,ST_X(s.location::geometry) AS longitude,s.landmark,s.division_id,d.name AS division_name,
  s.status,s.size,s.waste_types,s.hazardous,s.responsible_organization_id,ro.name AS responsible_organization_name,s.responsibility_basis,
  s.cleanup_organization_id,co.name AS cleanup_organization_name,s.cleanup_due_on::text AS cleanup_due_on,s.recurrence_count,
  s.first_reported_at,s.last_reported_at,s.verified_at,s.cleanup_ordered_at,s.cleanup_reported_at,s.cleared_at,s.closed_reason,
  (SELECT COUNT(*)::int FROM dumping_reports r WHERE r.site_id=s.id) AS report_count,
  (SELECT COUNT(*)::int FROM dumping_photos p WHERE p.site_id=s.id) AS photo_count,
  (s.status IN('cleanup_ordered','cleanup_reported') AND s.cleanup_due_on<CURRENT_DATE) AS overdue`;
const SITE_FROM = `FROM dumping_sites s LEFT JOIN kampala_divisions d ON d.id=s.division_id
  LEFT JOIN organizations ro ON ro.id=s.responsible_organization_id LEFT JOIN organizations co ON co.id=s.cleanup_organization_id`;

const withHotspot = <T extends { report_count: number; recurrence_count: number }>(row: T) => ({ ...row, hotspot: isHotspot(row) });

export type SiteFilter = { status: string | null; divisionId: string | null; cleanupOrganizationId: string | null; responsibleOrganizationId: string | null };

export async function listSites(filter: SiteFilter, page?: Page) {
  const status = filter.status;
  const result = await queryPage<{ report_count: number; recurrence_count: number }>(
    `SELECT ${SITE_COLUMNS} ${SITE_FROM}
     WHERE ($1::text IS NULL OR ($1='open' AND s.status=ANY($5::text[])) OR ($1='overdue' AND s.status IN('cleanup_ordered','cleanup_reported') AND s.cleanup_due_on<CURRENT_DATE) OR s.status=$1)
       AND ($2::uuid IS NULL OR s.division_id=$2::uuid) AND ($3::uuid IS NULL OR s.cleanup_organization_id=$3::uuid)
       AND ($4::uuid IS NULL OR s.responsible_organization_id=$4::uuid)
     ORDER BY (s.status IN('cleanup_ordered','cleanup_reported') AND s.cleanup_due_on<CURRENT_DATE) DESC,s.hazardous DESC,
       CASE s.status WHEN 'reported' THEN 0 WHEN 'cleanup_reported' THEN 1 WHEN 'verified' THEN 2 WHEN 'cleanup_ordered' THEN 3 ELSE 4 END,s.last_reported_at DESC,s.id`,
    [status, filter.divisionId, filter.cleanupOrganizationId, filter.responsibleOrganizationId, OPEN_STATUSES], page);
  return { ...result, rows: result.rows.map(withHotspot) };
}

/** Throws 404 unless the caller may see the site: KCCA always; a company when it cleans up, is held responsible or reported it; a resident who reported it. */
async function visibleSite(client: PoolClient | typeof dbPool, id: string, scope: Scope, lock = false) {
  const row = (await client.query(
    `SELECT ${SITE_COLUMNS} ${SITE_FROM} WHERE s.id=$1::uuid AND ($2='kcca'
       OR ($2='company' AND ($3::uuid IN(s.cleanup_organization_id,s.responsible_organization_id) OR EXISTS(SELECT 1 FROM dumping_reports r WHERE r.site_id=s.id AND r.reporter_organization_id=$3::uuid)))
       OR ($2='citizen' AND EXISTS(SELECT 1 FROM dumping_reports r WHERE r.site_id=s.id AND r.reporter_user_id=$4::uuid)))${lock ? " FOR UPDATE OF s" : ""}`,
    [id, scope.kind, scope.organizationId, scope.userId])).rows[0];
  if (!row) throw fail(404, "Dumping site not found");
  return row;
}

export async function siteDetail(id: string, scope: Scope) {
  const site = await visibleSite(dbPool, id, scope);
  const [reports, photos, history] = await Promise.all([
    dbPool.query(
      `SELECT r.id,r.source,r.description,r.created_at,r.citizen_issue_id,ST_Y(r.location::geometry) AS latitude,ST_X(r.location::geometry) AS longitude,
         CASE WHEN $2='kcca' OR r.reporter_user_id=$3::uuid THEN u.full_name END AS reporter_name,o.name AS reporter_organization_name
       FROM dumping_reports r JOIN users u ON u.id=r.reporter_user_id LEFT JOIN organizations o ON o.id=r.reporter_organization_id
       WHERE r.site_id=$1 ORDER BY r.created_at,r.id`, [id, scope.kind, scope.userId]),
    dbPool.query("SELECT id,stage,report_id,created_at FROM dumping_photos WHERE site_id=$1 ORDER BY created_at,id", [id]),
    dbPool.query(
      `SELECT h.action,h.from_status,h.to_status,h.note,h.created_at,CASE WHEN $2='kcca' THEN u.full_name END AS actor_name
       FROM dumping_site_history h LEFT JOIN users u ON u.id=h.actor_user_id WHERE h.site_id=$1 ORDER BY h.created_at,h.id`, [id, scope.kind]),
  ]);
  return { ...withHotspot(site), rules: { cleanup_days: cleanupDaysFor(site.size ?? "small", site.hazardous) }, reports: reports.rows, photos: photos.rows, history: history.rows };
}

export async function photo(id: string, scope: Scope) {
  const row = (await dbPool.query("SELECT site_id,image_data FROM dumping_photos WHERE id=$1::uuid", [id])).rows[0];
  if (!row) throw fail(404, "Photo not found");
  await visibleSite(dbPool, row.site_id, scope);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/s.exec(row.image_data);
  if (!match) throw fail(500, "Stored photo is unreadable");
  return { mimeType: match[1], data: Buffer.from(match[2], "base64") };
}

export async function myReports(userId: string, page?: Page) {
  return queryPage(
    `SELECT r.id,r.description,r.created_at,s.id AS site_id,s.site_number,s.status,s.landmark,s.cleared_at,s.closed_reason
     FROM dumping_reports r JOIN dumping_sites s ON s.id=r.site_id WHERE r.reporter_user_id=$1::uuid ORDER BY r.created_at DESC,r.id`, [userId], page);
}

// ---------- KCCA decisions ----------

export async function verifySite(id: string, userId: string, input: { divisionId?: string; size: Size; wasteTypes: string[]; hazardous: boolean; note: string; photo?: string }) {
  return inTransaction(async c => {
    const site = await visibleSite(c, id, { userId, organizationId: null, kind: "kcca" }, true);
    if (site.status !== "reported") throw fail(409, "Only a newly reported site can be verified");
    const divisionId = input.divisionId || site.division_id;
    if (!divisionId) throw fail(400, "Choose the division");
    const hazardous = input.hazardous || input.wasteTypes.includes("hazardous");
    await c.query("UPDATE dumping_sites SET status='verified',division_id=$2,size=$3,waste_types=$4,hazardous=$5,verified_at=CURRENT_TIMESTAMP WHERE id=$1",
      [id, divisionId, input.size, input.wasteTypes, hazardous]);
    if (input.photo) await addPhoto(c, id, null, "inspection", input.photo, userId);
    await log(c, id, "verified", "reported", "verified", input.note, userId);
    await syncCitizenIssues(c, id, "triaged", null);
    return { id, status: "verified" };
  });
}

export async function dismissSite(id: string, userId: string, reason: string) {
  return inTransaction(async c => {
    const site = await visibleSite(c, id, { userId, organizationId: null, kind: "kcca" }, true);
    if (!["reported", "verified"].includes(site.status)) throw fail(409, "Only a site that is not yet being cleaned up can be dismissed");
    await c.query("UPDATE dumping_sites SET status='dismissed',closed_reason=$2 WHERE id=$1", [id, reason]);
    await log(c, id, "dismissed", site.status, "dismissed", reason, userId);
    await syncCitizenIssues(c, id, "rejected", `KCCA closed the report: ${reason}`);
    return { id, status: "dismissed" };
  });
}

export async function setResponsibility(id: string, userId: string, input: { organizationId: string | null; basis?: string }) {
  return inTransaction(async c => {
    const site = await visibleSite(c, id, { userId, organizationId: null, kind: "kcca" }, true);
    if (site.status === "dismissed") throw fail(409, "This site was dismissed");
    if (input.organizationId && (input.basis?.trim().length ?? 0) < 10) throw fail(400, "Describe the evidence for holding this company responsible");
    if (input.organizationId === site.responsible_organization_id) throw fail(409, "That company is already held responsible");
    await c.query("UPDATE dumping_sites SET responsible_organization_id=$2,responsibility_basis=$3 WHERE id=$1",
      [id, input.organizationId, input.organizationId ? input.basis!.trim() : null]);
    await log(c, id, input.organizationId ? "responsibility_set" : "responsibility_cleared", site.status, site.status, input.organizationId ? input.basis!.trim() : null, userId);
    if (input.organizationId) {
      await notifyOrganization(c, input.organizationId, ["company_admin"], {
        category: "dumping", severity: "warning", title: `KCCA holds your company responsible for dumping: ${site.site_number}`,
        body: `${site.landmark || "Dumping site"}. Evidence: ${input.basis!.trim()}`, link: "/dashboard/cleanup-orders", dedupeKey: `dumping-responsible:${id}:${input.organizationId}`,
      });
    }
    return { id, responsible_organization_id: input.organizationId };
  });
}

export async function orderCleanup(id: string, userId: string, input: { organizationId: string | null; dueOn?: string; note?: string }) {
  return inTransaction(async c => {
    const site = await visibleSite(c, id, { userId, organizationId: null, kind: "kcca" }, true);
    if (site.status !== "verified") throw fail(409, "Verify the site before ordering its cleanup");
    const day = (await c.query("SELECT CURRENT_DATE::text AS d")).rows[0].d as string;
    const dueOn = input.dueOn || new Date(Date.parse(`${day}T00:00:00Z`) + cleanupDaysFor(site.size, site.hazardous) * 86400000).toISOString().slice(0, 10);
    const problem = cleanupDueError(dueOn, day, site.size, site.hazardous);
    if (problem) throw fail(400, problem);
    await c.query("UPDATE dumping_sites SET status='cleanup_ordered',cleanup_organization_id=$2,cleanup_due_on=$3,cleanup_ordered_at=CURRENT_TIMESTAMP WHERE id=$1",
      [id, input.organizationId, dueOn]);
    await log(c, id, "cleanup_ordered", "verified", "cleanup_ordered", [input.organizationId ? null : "KCCA crew", `Due ${dueOn}`, input.note].filter(Boolean).join(". "), userId);
    await syncCitizenIssues(c, id, "in_progress", null);
    if (input.organizationId) {
      await notifyOrganization(c, input.organizationId, ["company_admin", "supervisor"], {
        category: "dumping", severity: site.hazardous ? "critical" : "warning", title: `Cleanup ordered: ${site.site_number}${site.hazardous ? " (hazardous)" : ""}`,
        body: `${site.landmark || "Dumping site"}, ${site.division_name}. Clear it by ${dayLabel(dueOn)} and report it with a photo.${input.note ? ` KCCA: ${input.note}` : ""}`,
        link: "/dashboard/cleanup-orders", dedupeKey: `dumping-order:${id}:${dueOn}:${input.organizationId}`,
      });
    }
    return { id, status: "cleanup_ordered", cleanup_due_on: dueOn };
  });
}

export async function confirmCleared(id: string, userId: string, input: { note: string; photo?: string }) {
  return inTransaction(async c => {
    const site = await visibleSite(c, id, { userId, organizationId: null, kind: "kcca" }, true);
    if (site.status === "cleanup_ordered" && site.cleanup_organization_id) throw fail(409, "Wait for the company to report the cleanup");
    if (!["cleanup_ordered", "cleanup_reported"].includes(site.status)) throw fail(409, "Only a site being cleaned up can be confirmed as cleared");
    await c.query("UPDATE dumping_sites SET status='cleared',cleared_at=CURRENT_TIMESTAMP WHERE id=$1", [id]);
    if (input.photo) await addPhoto(c, id, null, "verification", input.photo, userId);
    await log(c, id, "cleared", site.status, "cleared", input.note, userId);
    await syncCitizenIssues(c, id, "resolved", `KCCA confirmed the site was cleared: ${input.note}`);
    if (site.cleanup_organization_id) {
      await notifyOrganization(c, site.cleanup_organization_id, ["company_admin", "supervisor"], {
        category: "dumping", severity: "info", title: `Cleanup confirmed: ${site.site_number}`, body: `KCCA confirmed ${site.landmark || "the site"} is clear.`,
        link: "/dashboard/cleanup-orders", dedupeKey: `dumping-cleared:${id}:${site.recurrence_count}`,
      });
    }
    const reporters = (await c.query("SELECT DISTINCT reporter_user_id FROM dumping_reports WHERE site_id=$1 AND source='resident'", [id])).rows;
    for (const reporter of reporters) {
      await c.query("SELECT notify_user($1,NULL,'dumping','info',$2,$3,'/dashboard/citizen-issues',$4)",
        [reporter.reporter_user_id, "The dumping you reported has been cleared", `${site.landmark || site.site_number} was cleared. Thank you for reporting it.`, `dumping-cleared-reporter:${id}:${site.recurrence_count}`]);
    }
    return { id, status: "cleared" };
  });
}

export async function rejectCleanup(id: string, userId: string, input: { reason: string; dueOn?: string }) {
  return inTransaction(async c => {
    const site = await visibleSite(c, id, { userId, organizationId: null, kind: "kcca" }, true);
    if (site.status !== "cleanup_reported") throw fail(409, "Only a reported cleanup can be sent back");
    const day = (await c.query("SELECT CURRENT_DATE::text AS d")).rows[0].d as string;
    const dueOn = input.dueOn || site.cleanup_due_on;
    if (input.dueOn) { const problem = cleanupDueError(input.dueOn, day, site.size, site.hazardous); if (problem) throw fail(400, problem); }
    await c.query("UPDATE dumping_sites SET status='cleanup_ordered',cleanup_due_on=$2,cleanup_reported_at=NULL WHERE id=$1", [id, dueOn]);
    await log(c, id, "cleanup_rejected", "cleanup_reported", "cleanup_ordered", input.reason, userId);
    if (site.cleanup_organization_id) {
      await notifyOrganization(c, site.cleanup_organization_id, ["company_admin", "supervisor"], {
        category: "dumping", severity: "warning", title: `Cleanup not accepted: ${site.site_number}`,
        body: `KCCA: ${input.reason}. Finish the cleanup by ${dayLabel(dueOn)} and report it again.`, link: "/dashboard/cleanup-orders",
        dedupeKey: `dumping-rejected:${id}:${Date.now()}`,
      });
    }
    return { id, status: "cleanup_ordered", cleanup_due_on: dueOn };
  });
}

// ---------- Company ----------

export async function reportCleanup(id: string, userId: string, organizationId: string, input: { note: string; photo: string }) {
  return inTransaction(async c => {
    const site = await visibleSite(c, id, { userId, organizationId, kind: "company" }, true);
    if (site.cleanup_organization_id !== organizationId) throw fail(403, "KCCA did not order this cleanup from your company");
    if (site.status !== "cleanup_ordered") throw fail(409, site.status === "cleanup_reported" ? "This cleanup was already reported" : "This site has no open cleanup order");
    await c.query("UPDATE dumping_sites SET status='cleanup_reported',cleanup_reported_at=CURRENT_TIMESTAMP WHERE id=$1", [id]);
    await addPhoto(c, id, null, "cleanup", input.photo, userId);
    await log(c, id, "cleanup_reported", "cleanup_ordered", "cleanup_reported", input.note, userId);
    await notifyRole(c, "kcca_admin", { category: "dumping", severity: "info", title: `Cleanup reported: ${site.site_number}`,
      body: `${site.cleanup_organization_name} reports ${site.landmark || "the site"} cleared. Confirm it in Illegal dumping.`, link: "/dashboard/dumping",
      dedupeKey: `dumping-cleanup-reported:${id}:${Date.now()}` }, organizationId);
    return { id, status: "cleanup_reported" };
  });
}

export async function companyOverview(organizationId: string) {
  const row = (await dbPool.query(
    `SELECT COUNT(*) FILTER(WHERE cleanup_organization_id=$1 AND status='cleanup_ordered')::int AS open_orders,
       COUNT(*) FILTER(WHERE cleanup_organization_id=$1 AND status IN('cleanup_ordered','cleanup_reported') AND cleanup_due_on<CURRENT_DATE)::int AS overdue_orders,
       COUNT(*) FILTER(WHERE cleanup_organization_id=$1 AND status='cleanup_reported')::int AS awaiting_kcca,
       COUNT(*) FILTER(WHERE cleanup_organization_id=$1 AND status='cleared' AND cleared_at>CURRENT_TIMESTAMP-interval '90 days')::int AS cleared_90d,
       COUNT(*) FILTER(WHERE responsible_organization_id=$1 AND first_reported_at>CURRENT_TIMESTAMP-make_interval(days=>$2))::int AS attributed_recent
     FROM dumping_sites`, [organizationId, DUMPING_RULES.repeatWindowDays])).rows[0];
  return { ...row, repeat_offender: row.attributed_recent >= DUMPING_RULES.repeatOffences, rules: { repeat_offences: DUMPING_RULES.repeatOffences, repeat_window_days: DUMPING_RULES.repeatWindowDays } };
}

// ---------- KCCA overview ----------

export async function cityOverview(period: Period) {
  const [totals, cleared, divisions, companies, points] = await Promise.all([
    dbPool.query(
      `SELECT COUNT(*) FILTER(WHERE status=ANY($3::text[]))::int AS open,
         COUNT(*) FILTER(WHERE status='reported')::int AS reported,COUNT(*) FILTER(WHERE status='verified')::int AS verified,
         COUNT(*) FILTER(WHERE status='cleanup_ordered')::int AS cleanup_ordered,COUNT(*) FILTER(WHERE status='cleanup_reported')::int AS cleanup_reported,
         COUNT(*) FILTER(WHERE status IN('cleanup_ordered','cleanup_reported') AND cleanup_due_on<CURRENT_DATE)::int AS overdue,
         COUNT(*) FILTER(WHERE status=ANY($3::text[]) AND hazardous)::int AS hazardous_open,
         COUNT(*) FILTER(WHERE first_reported_at::date BETWEEN $1::date AND $2::date)::int AS new_sites,
         COALESCE(SUM(recurrence_count) FILTER(WHERE last_reported_at::date BETWEEN $1::date AND $2::date),0)::int AS recurrences,
         COUNT(*) FILTER(WHERE status='cleared' AND cleared_at::date BETWEEN $1::date AND $2::date)::int AS cleared,
         COUNT(*) FILTER(WHERE status='dismissed' AND updated_at::date BETWEEN $1::date AND $2::date)::int AS dismissed
       FROM dumping_sites`, [period.from, period.to, OPEN_STATUSES]),
    dbPool.query(`SELECT EXTRACT(EPOCH FROM cleared_at-first_reported_at)/86400 AS days FROM dumping_sites WHERE status='cleared' AND cleared_at::date BETWEEN $1::date AND $2::date`, [period.from, period.to]),
    dbPool.query(
      `SELECT d.id,d.name,COUNT(s.id) FILTER(WHERE s.status=ANY($3::text[]))::int AS open,
         COUNT(s.id) FILTER(WHERE s.status='cleared' AND s.cleared_at::date BETWEEN $1::date AND $2::date)::int AS cleared,
         COUNT(s.id) FILTER(WHERE s.status IN('cleanup_ordered','cleanup_reported') AND s.cleanup_due_on<CURRENT_DATE)::int AS overdue
       FROM kampala_divisions d LEFT JOIN dumping_sites s ON s.division_id=d.id WHERE d.is_active GROUP BY d.id,d.name ORDER BY d.name`, [period.from, period.to, OPEN_STATUSES]),
    dbPool.query(
      `SELECT o.id,o.name,
         COUNT(s.id) FILTER(WHERE s.responsible_organization_id=o.id AND s.first_reported_at>CURRENT_TIMESTAMP-make_interval(days=>$1))::int AS attributed_recent,
         COUNT(s.id) FILTER(WHERE s.cleanup_organization_id=o.id AND s.status IN('cleanup_ordered','cleanup_reported'))::int AS open_orders,
         COUNT(s.id) FILTER(WHERE s.cleanup_organization_id=o.id AND s.status IN('cleanup_ordered','cleanup_reported') AND s.cleanup_due_on<CURRENT_DATE)::int AS overdue_orders,
         COUNT(s.id) FILTER(WHERE s.cleanup_organization_id=o.id AND s.status='cleared' AND s.cleared_at::date BETWEEN $2::date AND $3::date)::int AS cleared
       FROM organizations o JOIN dumping_sites s ON o.id IN(s.responsible_organization_id,s.cleanup_organization_id)
       GROUP BY o.id,o.name ORDER BY attributed_recent DESC,overdue_orders DESC,o.name`, [DUMPING_RULES.repeatWindowDays, period.from, period.to]),
    dbPool.query(
      `SELECT s.id,s.site_number,s.status,s.hazardous,s.landmark,s.recurrence_count,ST_Y(s.location::geometry) AS latitude,ST_X(s.location::geometry) AS longitude,
         (SELECT COUNT(*)::int FROM dumping_reports r WHERE r.site_id=s.id) AS report_count,
         (s.status IN('cleanup_ordered','cleanup_reported') AND s.cleanup_due_on<CURRENT_DATE) AS overdue
       FROM dumping_sites s WHERE s.status=ANY($3::text[]) OR (s.status='cleared' AND s.cleared_at::date BETWEEN $1::date AND $2::date)
       ORDER BY s.last_reported_at DESC LIMIT 1000`, [period.from, period.to, OPEN_STATUSES]),
  ]);
  return {
    period, rules: DUMPING_RULES,
    totals: { ...totals.rows[0], median_days_to_clear: medianDays(cleared.rows.map(row => Number(row.days))), hotspots: points.rows.filter(p => OPEN_STATUSES.includes(p.status as SiteStatus) && isHotspot(p)).length },
    divisions: divisions.rows,
    companies: companies.rows.map(row => ({ ...row, repeat_offender: row.attributed_recent >= DUMPING_RULES.repeatOffences })),
    sites: points.rows.map(withHotspot),
  };
}

// ---------- Scheduled check ----------

/** Overdue cleanups: the company that was ordered to clean up, and KCCA, are told once per deadline. */
export async function notifyOverdueCleanups(client: PoolClient) {
  const overdue = (await client.query(
    `SELECT s.id,s.site_number,s.landmark,s.cleanup_organization_id,s.cleanup_due_on::text AS due,o.name AS company
     FROM dumping_sites s LEFT JOIN organizations o ON o.id=s.cleanup_organization_id
     WHERE s.status='cleanup_ordered' AND s.cleanup_due_on<CURRENT_DATE`)).rows;
  for (const site of overdue) {
    const key = `dumping-overdue:${site.id}:${site.due}`;
    if (site.cleanup_organization_id) {
      await notifyOrganization(client, site.cleanup_organization_id, ["company_admin", "supervisor"], {
        category: "dumping", severity: "warning", title: `Cleanup overdue: ${site.site_number}`,
        body: `${site.landmark || "The dumping site"} was due to be cleared by ${dayLabel(site.due)}. Clear it and report it with a photo.`, link: "/dashboard/cleanup-orders", dedupeKey: key,
      });
    }
    await notifyRole(client, "kcca_admin", {
      category: "dumping", severity: "warning", title: `Cleanup overdue: ${site.site_number}`,
      body: `${site.company || "The KCCA crew"} has not cleared ${site.landmark || "the site"}, due ${dayLabel(site.due)}.`, link: "/dashboard/dumping", dedupeKey: key,
    }, site.cleanup_organization_id);
  }
  return overdue.length;
}
