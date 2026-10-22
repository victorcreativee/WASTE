import { notifyRole } from "../services/notify";
import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import {
  NEXT_STATUS,
  PermitAction,
  allowedPermitActions,
  effectivePermitStatus,
  normalizeVerificationCode,
  renewalEligibility,
  validityDateError,
} from "../services/permit-lifecycle.rules";

type ReviewInput = { action: PermitAction; notes: string; validUntil?: string; activityCodes?: string[] };
type RenewalReviewInput = { action: "approve" | "reject"; notes: string; validUntil?: string; activityCodes?: string[] };

const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });

const ACTIVITIES_JSON = `COALESCE((SELECT json_agg(json_build_object('code',t.code,'name',t.name) ORDER BY t.sort_order)
  FROM organization_permit_activities pa JOIN permit_activity_types t ON t.code=pa.activity_code
  WHERE pa.permit_application_id=p.id),'[]'::json)`;

async function today(client: PoolClient | typeof dbPool): Promise<string> {
  return (await client.query("SELECT CURRENT_DATE::text AS today")).rows[0].today;
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

/** Activities must exist, be active and match the kind of organization the permit is for. */
async function validActivityCodes(client: PoolClient, permit: any, codes: string[]): Promise<string[]> {
  const unique = [...new Set(codes)];
  if (!unique.length) throw badRequest("Select at least one authorized activity");
  const organizationType = (await client.query(
    `SELECT COALESCE(o.type,ap.company_type,'waste_collection_company') AS type
     FROM organization_permit_applications p
     LEFT JOIN organizations o ON o.id=p.organization_id
     LEFT JOIN organization_applicant_profiles ap ON ap.user_id=p.applicant_user_id
     WHERE p.id=$1::uuid`, [permit.id])).rows[0]?.type;
  const valid = await client.query(
    "SELECT code FROM permit_activity_types WHERE code=ANY($1::text[]) AND is_active AND organization_type=$2",
    [unique, organizationType]);
  if (valid.rowCount !== unique.length) throw badRequest("One or more selected activities are not available for this type of organization");
  return unique;
}

async function replaceActivities(client: PoolClient, permitId: string, codes: string[], userId: string) {
  await client.query("DELETE FROM organization_permit_activities WHERE permit_application_id=$1::uuid AND NOT (activity_code=ANY($2::text[]))", [permitId, codes]);
  await client.query(
    `INSERT INTO organization_permit_activities(permit_application_id,activity_code,granted_by)
     SELECT $1::uuid,code,$3::uuid FROM unnest($2::text[]) code ON CONFLICT DO NOTHING`, [permitId, codes, userId]);
}

async function activityNames(client: PoolClient, codes: string[]): Promise<string> {
  const rows = (await client.query("SELECT name FROM permit_activity_types WHERE code=ANY($1::text[]) ORDER BY sort_order", [codes])).rows;
  return rows.map(row => row.name.toLowerCase()).join(", ");
}

async function notify(client: PoolClient, permit: any, type: string, message: string, validUntil: string | null = null) {
  await client.query(
    `INSERT INTO permit_lifecycle_notices(permit_application_id,organization_id,notice_type,valid_until,message)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [permit.id, permit.organization_id, type, validUntil, message]);
}

async function history(client: PoolClient, permitId: string, previous: string, next: string, notes: string, userId: string | null) {
  await client.query(
    "INSERT INTO organization_permit_history(application_id,previous_status,new_status,notes,changed_by) VALUES($1,$2,$3,$4,$5)",
    [permitId, previous, next, notes, userId]);
}

/** Extends a permit and everything that depends on it. Shared by direct KCCA renewal and approved renewal requests. */
async function applyRenewal(client: PoolClient, permit: any, userId: string, validUntil: string, notes: string, activityCodes?: string[]) {
  const error = validityDateError(validUntil, permit.valid_until_value, await today(client));
  if (error) throw badRequest(error);
  if (permit.organization_id) {
    const standing = (await client.query(
      `SELECT o.is_active,
         EXISTS(SELECT 1 FROM collector_compliance_cases c WHERE c.organization_id=o.id AND c.severity='critical' AND c.status<>'closed') AS critical_case
       FROM organizations o WHERE o.id=$1::uuid`, [permit.organization_id])).rows[0];
    if (!standing?.is_active) throw conflict("Reactivate the organization before extending its permit");
    if (standing.critical_case) throw conflict("Resolve the organization’s critical compliance case before extending this permit");
  }
  if (activityCodes) await replaceActivities(client, permit.id, await validActivityCodes(client, permit, activityCodes), userId);
  await client.query(
    `UPDATE organization_permit_applications SET status='approved',valid_until=$2::date,review_notes=$3,reviewed_by=$4,reviewed_at=CURRENT_TIMESTAMP,
       renewal_count=renewal_count+1,last_renewed_at=CURRENT_TIMESTAMP,last_renewed_by=$4,suspended_at=NULL,expired_at=NULL,updated_at=CURRENT_TIMESTAMP
     WHERE id=$1::uuid`, [permit.id, validUntil, notes, userId]);
  await client.query(
    `UPDATE organization_division_authorizations SET expires_on=$2::date,status='active',suspended_by_permit=false
     WHERE permit_application_id=$1::uuid AND (status IN('active','expired') OR suspended_by_permit)`, [permit.id, validUntil]);
  await history(client, permit.id, permit.status, "approved", `Permit extended from ${permit.valid_until_value || "no expiry"} to ${validUntil}. ${notes}`, userId);
  await notify(client, permit, "renewed", `KCCA renewed permit ${permit.permit_number}. It is now valid until ${validUntil}.`, validUntil);
}

export async function reviewPermit(id: string, userId: string, data: ReviewInput) {
  return inTransaction(async client => {
    const permit = (await client.query(
      "SELECT *,valid_until::text AS valid_until_value FROM organization_permit_applications WHERE id=$1::uuid FOR UPDATE", [id])).rows[0];
    if (!permit) return null;
    if (!allowedPermitActions(permit.status).includes(data.action)) {
      throw conflict(`Cannot ${data.action.replaceAll("_", " ")} a permit that is ${permit.status.replaceAll("_", " ")}`);
    }
    const next = NEXT_STATUS[data.action];

    switch (data.action) {
      case "approve": {
        if (!data.validUntil) throw badRequest("Permit validity date is required");
        const dateError = validityDateError(data.validUntil, null, await today(client));
        if (dateError) throw badRequest(dateError);
        const codes = await validActivityCodes(client, permit, data.activityCodes ?? []);
        const permitNumber = permit.permit_number || `PERMIT-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;
        await client.query(
          `UPDATE organization_permit_applications SET status='approved',review_notes=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP,
             permit_number=$4,valid_from=COALESCE(valid_from,CURRENT_DATE),valid_until=$5::date,updated_at=CURRENT_TIMESTAMP
           WHERE id=$1::uuid`, [id, data.notes, userId, permitNumber, data.validUntil]);
        await replaceActivities(client, id, codes, userId);
        await history(client, id, permit.status, next, `${data.notes} Authorized activities: ${await activityNames(client, codes)}.`, userId);
        break;
      }
      case "renew": {
        if (!data.validUntil) throw badRequest("Permit validity date is required");
        await applyRenewal(client, permit, userId, data.validUntil, data.notes, data.activityCodes);
        await client.query(
          `UPDATE permit_renewal_requests SET status='approved',granted_valid_until=$2::date,review_notes='Renewed directly by KCCA on the permit record.',
             reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
           WHERE permit_application_id=$1::uuid AND status='submitted'`, [id, data.validUntil, userId]);
        break;
      }
      case "suspend": {
        await client.query(
          `UPDATE organization_permit_applications SET status='suspended',suspended_at=CURRENT_TIMESTAMP,review_notes=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
           WHERE id=$1::uuid`, [id, data.notes, userId]);
        await client.query(
          "UPDATE organization_division_authorizations SET status='suspended',suspended_by_permit=true WHERE permit_application_id=$1::uuid AND status='active'", [id]);
        await history(client, id, permit.status, next, data.notes, userId);
        await notify(client, permit, "suspended", `KCCA suspended permit ${permit.permit_number}: ${data.notes}`);
        break;
      }
      case "reinstate": {
        if (permit.valid_until_value && permit.valid_until_value < await today(client)) {
          throw conflict(`This permit's validity ended on ${permit.valid_until_value}. Renew it with a new validity date instead.`);
        }
        await client.query(
          `UPDATE organization_permit_applications SET status='approved',suspended_at=NULL,review_notes=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
           WHERE id=$1::uuid`, [id, data.notes, userId]);
        await client.query(
          "UPDATE organization_division_authorizations SET status='active',suspended_by_permit=false WHERE permit_application_id=$1::uuid AND suspended_by_permit", [id]);
        await history(client, id, permit.status, next, data.notes, userId);
        await notify(client, permit, "reinstated", `KCCA reinstated permit ${permit.permit_number}: ${data.notes}`);
        break;
      }
      case "update_activities": {
        const codes = await validActivityCodes(client, permit, data.activityCodes ?? []);
        await replaceActivities(client, id, codes, userId);
        await history(client, id, permit.status, permit.status, `Authorized activities changed to: ${await activityNames(client, codes)}. ${data.notes}`, userId);
        break;
      }
      default: {
        await client.query(
          `UPDATE organization_permit_applications SET status=$2,review_notes=$3,reviewed_by=$4,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
           WHERE id=$1::uuid`, [id, next, data.notes, userId]);
        await history(client, id, permit.status, next, data.notes, userId);
      }
    }
    return (await client.query("SELECT * FROM organization_permit_applications WHERE id=$1::uuid", [id])).rows[0];
  });
}

type IssueInput = {
  registrationNumber: string; contactName: string; email: string; phone: string; address: string;
  serviceDescription: string; validUntil: string; activityCodes: string[]; notes: string;
};

/**
 * Issues a permit directly to an organization already active on the platform: recycling companies (which join with a
 * registration document) and collectors created before permits existed. The permit starts approved and is audited.
 */
export async function issuePermitToOrganization(organizationId: string, userId: string, data: IssueInput) {
  return inTransaction(async client => {
    const organization = (await client.query(
      "SELECT id,name,type,is_active FROM organizations WHERE id=$1::uuid FOR UPDATE", [organizationId])).rows[0];
    if (!organization) throw notFound("Organization not found");
    if (!["waste_collection_company", "recycling_company", "processing_plant"].includes(organization.type)) throw badRequest("Permits are issued to waste collectors, recycling companies and recycling factories only");
    if (!organization.is_active) throw conflict("Reactivate the organization before issuing a permit");
    const current = await client.query(
      "SELECT permit_number,status FROM organization_permit_applications WHERE organization_id=$1::uuid AND status IN('approved','suspended') LIMIT 1", [organizationId]);
    if (current.rowCount) throw conflict(`${organization.name} already holds permit ${current.rows[0].permit_number} (${current.rows[0].status}). Renew or reinstate it instead.`);
    const dateError = validityDateError(data.validUntil, null, await today(client));
    if (dateError) throw badRequest(dateError);
    const types = await client.query(
      "SELECT code FROM permit_activity_types WHERE code=ANY($1::text[]) AND is_active AND organization_type=$2", [[...new Set(data.activityCodes)], organization.type]);
    if (!data.activityCodes.length || types.rowCount !== new Set(data.activityCodes).size) throw badRequest("Select activities that apply to this type of organization");

    const year = new Date().getFullYear(), stamp = String(Date.now());
    let permit;
    try {
      permit = (await client.query(
        `INSERT INTO organization_permit_applications(application_number,organization_id,company_name,registration_number,contact_name,email,phone,address,service_description,
           status,submitted_at,review_notes,permit_number,valid_from,valid_until,reviewed_by,reviewed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',CURRENT_TIMESTAMP,$10,$11,CURRENT_DATE,$12::date,$13,CURRENT_TIMESTAMP)
         RETURNING *`,
        [`KCCA-${year}-${stamp}`, organizationId, organization.name, data.registrationNumber, data.contactName, data.email, data.phone, data.address,
          data.serviceDescription, data.notes, `PERMIT-${year}-${stamp.slice(-7)}`, data.validUntil, userId])).rows[0];
    } catch (error: any) {
      if (error?.code === "23505") throw conflict("Another open permit or application already uses this registration number");
      throw error;
    }
    await replaceActivities(client, permit.id, data.activityCodes, userId);
    await history(client, permit.id, "approved", "approved",
      `Permit issued directly by KCCA to ${organization.name}, already active on the platform. Authorized activities: ${await activityNames(client, data.activityCodes)}. ${data.notes}`, userId);
    return (await client.query("SELECT * FROM organization_permit_applications WHERE id=$1::uuid", [permit.id])).rows[0];
  });
}

export async function permitHistory(id: string) {
  return (await dbPool.query(
    `SELECT h.id,h.previous_status,h.new_status,h.notes,h.created_at,COALESCE(u.full_name,'System') AS changed_by_name
     FROM organization_permit_history h LEFT JOIN users u ON u.id=h.changed_by
     WHERE h.application_id=$1::uuid ORDER BY h.created_at DESC,h.id`, [id])).rows;
}

export async function activityTypes() {
  return (await dbPool.query(
    "SELECT code,name,description,organization_type FROM permit_activity_types WHERE is_active ORDER BY sort_order")).rows;
}

// ---------- Company side ----------

async function currentPermit(client: PoolClient | typeof dbPool, organizationId: string, lock = false) {
  return (await client.query(
    `SELECT p.*,p.valid_until::text AS valid_until_value,p.valid_from::text AS valid_from_value
     FROM organization_permit_applications p
     WHERE p.organization_id=$1::uuid AND p.permit_number IS NOT NULL
     ORDER BY (p.status IN('approved','suspended')) DESC,p.valid_until DESC NULLS LAST,p.created_at DESC
     LIMIT 1${lock ? " FOR UPDATE" : ""}`, [organizationId])).rows[0] ?? null;
}

export async function organizationPermitStanding(organizationId: string) {
  const [dateNow, permit, organization] = await Promise.all([
    today(dbPool),
    currentPermit(dbPool, organizationId),
    dbPool.query("SELECT name,type FROM organizations WHERE id=$1::uuid", [organizationId]).then(r => r.rows[0]),
  ]);
  if (!permit) {
    return { organization, permit: null, renewal: renewalEligibility(null, dateNow), requests: [], notices: [], today: dateNow };
  }
  const [activities, divisions, requests, notices] = await Promise.all([
    dbPool.query(
      `SELECT t.code,t.name,t.description FROM organization_permit_activities a JOIN permit_activity_types t ON t.code=a.activity_code
       WHERE a.permit_application_id=$1::uuid ORDER BY t.sort_order`, [permit.id]),
    dbPool.query(
      `SELECT d.name,a.status,a.expires_on::text AS expires_on FROM organization_division_authorizations a JOIN kampala_divisions d ON d.id=a.division_id
       WHERE a.permit_application_id=$1::uuid ORDER BY d.name`, [permit.id]),
    dbPool.query(
      `SELECT r.id,r.request_number,r.status,r.requested_valid_until::text AS requested_valid_until,r.granted_valid_until::text AS granted_valid_until,
         r.statement,r.review_notes,r.created_at,r.reviewed_at,r.evidence_file_name,u.full_name AS requested_by_name
       FROM permit_renewal_requests r JOIN users u ON u.id=r.requested_by
       WHERE r.permit_application_id=$1::uuid ORDER BY r.created_at DESC LIMIT 10`, [permit.id]),
    dbPool.query(
      `SELECT id,notice_type,message,created_at,acknowledged_at FROM permit_lifecycle_notices
       WHERE organization_id=$1::uuid ORDER BY acknowledged_at IS NOT NULL,created_at DESC LIMIT 20`, [organizationId]),
  ]);
  const hasOpenRequest = requests.rows.some(row => row.status === "submitted");
  return {
    organization,
    today: dateNow,
    permit: {
      id: permit.id,
      permit_number: permit.permit_number,
      company_name: permit.company_name,
      status: permit.status,
      effective_status: effectivePermitStatus(permit.status, permit.valid_until_value, dateNow),
      valid_from: permit.valid_from_value,
      valid_until: permit.valid_until_value,
      renewal_count: permit.renewal_count,
      verification_code: permit.verification_code,
      activities: activities.rows,
      divisions: divisions.rows,
    },
    renewal: renewalEligibility({ status: permit.status, validUntil: permit.valid_until_value, hasOpenRequest }, dateNow),
    requests: requests.rows,
    notices: notices.rows,
  };
}

type RenewalRequestInput = { requestedValidUntil: string; statement: string; evidence?: { fileName: string; mimeType: string; dataUrl: string } };

export async function submitRenewalRequest(organizationId: string, userId: string, data: RenewalRequestInput) {
  return inTransaction(async client => {
    const permit = await currentPermit(client, organizationId, true);
    const dateNow = await today(client);
    const open = permit ? (await client.query("SELECT 1 FROM permit_renewal_requests WHERE permit_application_id=$1::uuid AND status='submitted'", [permit.id])).rowCount : 0;
    const eligibility = renewalEligibility(permit && { status: permit.status, validUntil: permit.valid_until_value, hasOpenRequest: !!open }, dateNow);
    if (!eligibility.eligible) throw conflict(eligibility.opensOn ? `${eligibility.reason} You can apply from ${eligibility.opensOn}.` : eligibility.reason!);
    const effectiveExpiry = permit.valid_until_value && permit.valid_until_value >= dateNow ? permit.valid_until_value : null;
    const dateError = validityDateError(data.requestedValidUntil, effectiveExpiry, dateNow);
    if (dateError) throw badRequest(dateError);
    const number = `RNW-${dateNow.slice(0, 4)}-${String(Date.now()).slice(-7)}`;
    const request = (await client.query(
      `INSERT INTO permit_renewal_requests(request_number,permit_application_id,organization_id,requested_by,requested_valid_until,statement,evidence_file_name,evidence_mime_type,evidence_data_url)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,request_number,status,requested_valid_until::text AS requested_valid_until,created_at`,
      [number, permit.id, organizationId, userId, data.requestedValidUntil, data.statement,
        data.evidence?.fileName ?? null, data.evidence?.mimeType ?? null, data.evidence?.dataUrl ?? null])).rows[0];
    await history(client, permit.id, permit.status, permit.status, `Renewal request ${number} submitted by the company, asking for validity until ${data.requestedValidUntil}.`, userId);
    await notifyRole(client, "kcca_admin", {
      category: "renewal", severity: "info", title: `Renewal request from ${permit.company_name}`,
      body: `${number} asks to extend permit ${permit.permit_number} to ${data.requestedValidUntil}.`, link: "/dashboard/permits", dedupeKey: `renewal-request:${request.id}`,
    }, organizationId);
    return request;
  });
}

export async function withdrawRenewalRequest(organizationId: string, userId: string, requestId: string) {
  return inTransaction(async client => {
    const request = (await client.query(
      `UPDATE permit_renewal_requests SET status='withdrawn',reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP,review_notes='Withdrawn by the company',updated_at=CURRENT_TIMESTAMP
       WHERE id=$1::uuid AND organization_id=$2::uuid AND status='submitted' RETURNING id,request_number,permit_application_id`,
      [requestId, organizationId, userId])).rows[0];
    if (!request) throw notFound("No open renewal request was found for your organization");
    const status = (await client.query("SELECT status FROM organization_permit_applications WHERE id=$1::uuid", [request.permit_application_id])).rows[0].status;
    await history(client, request.permit_application_id, status, status, `Renewal request ${request.request_number} withdrawn by the company.`, userId);
    return { id: request.id, status: "withdrawn" };
  });
}

export async function acknowledgeNotice(organizationId: string, userId: string, noticeId: string) {
  const result = await dbPool.query(
    `UPDATE permit_lifecycle_notices SET acknowledged_at=COALESCE(acknowledged_at,CURRENT_TIMESTAMP),acknowledged_by=COALESCE(acknowledged_by,$3::uuid)
     WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING id,acknowledged_at`, [noticeId, organizationId, userId]);
  if (!result.rowCount) throw notFound("Notice not found");
  return result.rows[0];
}

// ---------- KCCA side ----------

export async function renewalRequests(status?: string) {
  return (await dbPool.query(
    `SELECT r.id,r.request_number,r.status,r.requested_valid_until::text AS requested_valid_until,r.granted_valid_until::text AS granted_valid_until,
       r.statement,r.review_notes,r.created_at,r.reviewed_at,r.evidence_file_name,(r.evidence_data_url IS NOT NULL) AS has_evidence,
       p.id AS permit_id,p.permit_number,p.company_name,p.status AS permit_status,p.valid_until::text AS current_valid_until,
       (p.valid_until-CURRENT_DATE)::int AS days_left,u.full_name AS requested_by_name,rv.full_name AS reviewed_by_name,
       ${ACTIVITIES_JSON} AS activities
     FROM permit_renewal_requests r
     JOIN organization_permit_applications p ON p.id=r.permit_application_id
     JOIN users u ON u.id=r.requested_by
     LEFT JOIN users rv ON rv.id=r.reviewed_by
     WHERE ($1::text IS NULL OR r.status=$1)
     ORDER BY (r.status='submitted') DESC,p.valid_until NULLS LAST,r.created_at DESC
     LIMIT 500`, [status || null])).rows;
}

export async function renewalEvidence(requestId: string) {
  return (await dbPool.query(
    "SELECT evidence_file_name,evidence_mime_type,evidence_data_url FROM permit_renewal_requests WHERE id=$1::uuid AND evidence_data_url IS NOT NULL", [requestId])).rows[0] ?? null;
}

export async function reviewRenewalRequest(requestId: string, userId: string, data: RenewalReviewInput) {
  return inTransaction(async client => {
    const request = (await client.query("SELECT *,requested_valid_until::text AS requested_valid_until_value FROM permit_renewal_requests WHERE id=$1::uuid FOR UPDATE", [requestId])).rows[0];
    if (!request) throw notFound("Renewal request not found");
    if (request.status !== "submitted") throw conflict(`This renewal request is already ${request.status}`);
    const permit = (await client.query(
      "SELECT *,valid_until::text AS valid_until_value FROM organization_permit_applications WHERE id=$1::uuid FOR UPDATE", [request.permit_application_id])).rows[0];

    if (data.action === "reject") {
      await client.query(
        `UPDATE permit_renewal_requests SET status='rejected',review_notes=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid`,
        [requestId, data.notes, userId]);
      await history(client, permit.id, permit.status, permit.status, `Renewal request ${request.request_number} rejected. ${data.notes}`, userId);
      await notify(client, permit, "renewal_rejected", `KCCA did not approve renewal request ${request.request_number}: ${data.notes}`);
      return { id: requestId, status: "rejected" };
    }

    if (permit.status === "suspended") throw conflict("The permit is suspended. Reinstate it or reject this request.");
    if (!["approved", "expired"].includes(permit.status)) throw conflict(`A ${permit.status.replaceAll("_", " ")} permit cannot be renewed`);
    const validUntil = data.validUntil || request.requested_valid_until_value;
    await applyRenewal(client, permit, userId, validUntil, `Renewal request ${request.request_number} approved. ${data.notes}`, data.activityCodes);
    await client.query(
      `UPDATE permit_renewal_requests SET status='approved',granted_valid_until=$2::date,review_notes=$3,reviewed_by=$4,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid`,
      [requestId, validUntil, data.notes, userId]);
    return { id: requestId, status: "approved", granted_valid_until: validUntil };
  });
}

export async function lifecycleOverview() {
  const [counts, unlicensed] = await Promise.all([
    dbPool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status='approved' AND (valid_until IS NULL OR valid_until>=CURRENT_DATE))::int AS active,
         COUNT(*) FILTER (WHERE status='approved' AND valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE+60)::int AS expiring_60,
         COUNT(*) FILTER (WHERE status='expired' OR (status='approved' AND valid_until<CURRENT_DATE))::int AS expired,
         COUNT(*) FILTER (WHERE status='suspended')::int AS suspended,
         COUNT(*) FILTER (WHERE status IN('submitted','under_review','information_required'))::int AS in_review,
         (SELECT COUNT(*) FROM permit_renewal_requests WHERE status='submitted')::int AS renewals_waiting
       FROM organization_permit_applications WHERE permit_number IS NOT NULL OR status IN('submitted','under_review','information_required')`),
    dbPool.query(
      `SELECT o.id,o.name,o.type,o.email,o.phone,o.address,o.created_at FROM organizations o
       WHERE o.type IN('waste_collection_company','recycling_company','processing_plant') AND o.is_active
         AND NOT EXISTS(SELECT 1 FROM organization_permit_applications p WHERE p.organization_id=o.id AND p.permit_number IS NOT NULL)
       ORDER BY o.name`),
  ]);
  return { ...counts.rows[0], no_permit_on_record: unlicensed.rows };
}

/** Runs expiry and reminders. Returns null if migration 092 has not been applied yet. */
export async function runLifecycle(): Promise<{ expired: number; reminders: number } | null> {
  const client = await dbPool.connect();
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('permit-lifecycle')) AS locked");
    if (!lock.rows[0].locked) return { expired: 0, reminders: 0 };
    try {
      const expired = (await client.query("SELECT expire_lapsed_permits() AS n")).rows[0].n;
      const reminders = (await client.query("SELECT issue_permit_expiry_reminders() AS n")).rows[0].n;
      return { expired, reminders };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('permit-lifecycle'))");
    }
  } catch (error: any) {
    if (error?.code === "42883") return null;
    throw error;
  } finally {
    client.release();
  }
}

// ---------- Public verification ----------

export async function verifyCertificate(input: string) {
  const code = normalizeVerificationCode(input);
  if (!code) return null;
  const permit = (await dbPool.query(
    `SELECT p.id,p.company_name,p.permit_number,p.status,p.valid_from::text AS valid_from,p.valid_until::text AS valid_until,CURRENT_DATE::text AS today,
       ${ACTIVITIES_JSON} AS activities,
       COALESCE((SELECT json_agg(d.name ORDER BY d.name) FROM organization_division_authorizations a JOIN kampala_divisions d ON d.id=a.division_id
         WHERE a.permit_application_id=p.id AND a.status='active'),'[]'::json) AS divisions
     FROM organization_permit_applications p WHERE p.verification_code=$1 AND p.permit_number IS NOT NULL`, [code])).rows[0];
  if (!permit) return null;
  return {
    verification_code: code,
    company_name: permit.company_name,
    permit_number: permit.permit_number,
    status: effectivePermitStatus(permit.status, permit.valid_until, permit.today),
    valid_from: permit.valid_from,
    valid_until: permit.valid_until,
    activities: (permit.activities as Array<{ name: string }>).map(activity => activity.name),
    divisions: permit.divisions,
    checked_on: permit.today,
  };
}
