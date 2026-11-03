import { dbPool } from "../config/database";
import { effectivePermitStatus } from "../services/permit-lifecycle.rules";
import { generateApiKey } from "../services/api-keys";

// Open API (migration 116): key management for company and KCCA administrators, and the read-only data behind
// /api/v1. Every data query is narrowed to the key's company here as well as by row-level security, because some
// tables (the weighbridge, organizations) are shared by design.

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
export type ApiKey = { id: string; organization_id: string | null; name: string; holder_name: string | null; scopes: string[]; rate_limit_per_minute: number; expires_at: string };
export type Paging = { page: number; pageSize: number };

const KEY_COLUMNS = `k.id,k.organization_id,o.name organization_name,k.name,k.holder_name,k.contact_email,k.purpose,k.key_prefix,k.scopes,
  k.rate_limit_per_minute,k.expires_at,k.created_by_name,k.created_at,k.last_used_at,k.last_used_ip,k.revoked_at,k.revoked_by_name,k.revoked_reason`;

// ---- Keys -----------------------------------------------------------------------------------------

export async function authenticateKey(prefix: string, hash: string, ip: string | null): Promise<ApiKey | null> {
  return (await dbPool.query("SELECT * FROM kwms_authenticate_api_key($1,$2,$3)", [prefix, hash, ip ?? ""])).rows[0] ?? null;
}

export async function recordUsage(key: ApiKey, endpoint: string, refused: boolean) {
  await dbPool.query(`INSERT INTO api_key_usage(key_id,organization_id,day,endpoint,requests,refused)
    VALUES($1::uuid,$2::uuid,(now() AT TIME ZONE 'Africa/Kampala')::date,$3,1,$4)
    ON CONFLICT(key_id,day,endpoint) DO UPDATE SET requests=api_key_usage.requests+1,refused=api_key_usage.refused+EXCLUDED.refused`,
  [key.id, key.organization_id, endpoint, refused ? 1 : 0]);
}

/** Keys the caller may see: a company its own, KCCA and system administrators every key. */
export async function listKeys(organizationId: string | null) {
  return (await dbPool.query(`SELECT ${KEY_COLUMNS},
      coalesce((SELECT sum(u.requests) FROM api_key_usage u WHERE u.key_id=k.id AND u.day>CURRENT_DATE-30),0)::int requests_30d
    FROM api_keys k LEFT JOIN organizations o ON o.id=k.organization_id
    WHERE ($1::uuid IS NULL OR k.organization_id=$1::uuid)
    ORDER BY k.revoked_at IS NOT NULL,k.created_at DESC`, [organizationId])).rows;
}

export async function createKey(input: {
  organizationId: string | null; name: string; scopes: string[]; expiresInDays: number; rateLimitPerMinute: number;
  holderName?: string; contactEmail?: string; purpose?: string;
}, userId: string) {
  if (input.organizationId) {
    const org = (await dbPool.query("SELECT type,is_active FROM organizations WHERE id=$1::uuid", [input.organizationId])).rows[0];
    if (!org?.is_active || org.type !== "waste_collection_company") throw fail(403, "API keys are available to licensed waste collection companies");
  }
  const { key, prefix, hash } = generateApiKey();
  const row = (await dbPool.query(`INSERT INTO api_keys(organization_id,name,holder_name,contact_email,purpose,key_prefix,secret_hash,scopes,
      rate_limit_per_minute,expires_at,created_by,created_by_name)
    VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8::text[],$9,CURRENT_TIMESTAMP+make_interval(days=>$10),$11::uuid,(SELECT full_name FROM users WHERE id=$11::uuid))
    RETURNING id,key_prefix,name,scopes,expires_at`,
  [input.organizationId, input.name, input.holderName ?? null, input.contactEmail ?? null, input.purpose ?? null, prefix, hash,
    input.scopes, input.rateLimitPerMinute, input.expiresInDays, userId])).rows[0];
  return { ...row, key };
}

export async function revokeKey(id: string, organizationId: string | null, reason: string, userId: string) {
  const row = (await dbPool.query(`UPDATE api_keys SET revoked_at=CURRENT_TIMESTAMP,revoked_by=$3::uuid,revoked_reason=$4,
      revoked_by_name=(SELECT full_name FROM users WHERE id=$3::uuid)
    WHERE id=$1::uuid AND revoked_at IS NULL AND ($2::uuid IS NULL OR organization_id=$2::uuid) RETURNING id,name,revoked_at`,
  [id, organizationId, userId, reason])).rows[0];
  if (!row) throw fail(404, "No active key with this id");
  return row;
}

export async function keyUsage(id: string, organizationId: string | null) {
  const key = (await dbPool.query("SELECT id FROM api_keys WHERE id=$1::uuid AND ($2::uuid IS NULL OR organization_id=$2::uuid)", [id, organizationId])).rows[0];
  if (!key) throw fail(404, "Key not found");
  return (await dbPool.query(`SELECT day::text AS day,endpoint,requests,refused FROM api_key_usage
    WHERE key_id=$1::uuid AND day>CURRENT_DATE-30 ORDER BY day DESC,endpoint`, [id])).rows;
}

// ---- Data for /api/v1 -----------------------------------------------------------------------------

async function page<T>(sql: string, params: unknown[], paging: Paging) {
  const { rows } = await dbPool.query(`SELECT *,count(*) OVER() AS total_rows FROM (${sql}) q LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paging.pageSize, (paging.page - 1) * paging.pageSize]);
  const total = rows.length ? Number(rows[0].total_rows) : 0;
  return { data: rows.map(({ total_rows: _, ...row }) => row as T), meta: { page: paging.page, pageSize: paging.pageSize, total } };
}

export async function operators(organizationId: string | null) {
  const rows = (await dbPool.query(`SELECT o.id,o.name,p.permit_number,p.status,p.valid_from::text AS valid_from,p.valid_until::text AS valid_until,
      CURRENT_DATE::text AS today,
      coalesce((SELECT json_agg(d.name ORDER BY d.name) FROM organization_division_authorizations a JOIN kampala_divisions d ON d.id=a.division_id
        WHERE a.permit_application_id=p.id AND a.status='active'),'[]'::json) AS divisions
    FROM organizations o
    LEFT JOIN LATERAL(SELECT * FROM organization_permit_applications p WHERE p.organization_id=o.id AND p.permit_number IS NOT NULL
      ORDER BY p.valid_until DESC NULLS LAST,p.created_at DESC LIMIT 1) p ON true
    WHERE o.type='waste_collection_company' AND o.is_active AND ($1::uuid IS NULL OR o.id=$1::uuid)
    ORDER BY o.name`, [organizationId])).rows;
  return rows.map(({ today, status, ...row }) => ({ ...row, permit_status: row.permit_number ? effectivePermitStatus(status, row.valid_until, today) : "none" }));
}

export async function tonnage(organizationId: string | null, from: string, to: string) {
  return (await dbPool.query(`SELECT w.operation_date::text AS date,w.organization_id AS operator_id,o.name AS operator,w.facility_code AS facility,
      coalesce(d.kind,'landfill') AS facility_kind,count(*)::int AS loads,sum(w.net_kg)::numeric(14,2) AS net_kg
    FROM weighbridge_transactions w JOIN organizations o ON o.id=w.organization_id LEFT JOIN disposal_facilities d ON d.code=w.facility_code
    WHERE w.status='completed' AND w.operation_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR w.organization_id=$3::uuid)
    GROUP BY 1,2,3,4,5 ORDER BY 1,3,4`, [from, to, organizationId])).rows;
}

export async function certificates(organizationId: string | null, from: string, to: string, paging: Paging) {
  return page(`SELECT c.certificate_number,c.verification_code,c.organization_id AS operator_id,o.name AS operator,c.ticket_number,
      c.facility_code AS facility,c.facility_kind,c.registration,c.operation_date::text AS date,c.gross_kg,c.tare_kg,c.net_kg,c.issued_at,
      c.revoked_at,c.revoked_reason,c.record_hash,lc.method AS composition_method,lc.shares AS composition
    FROM load_certificates c JOIN organizations o ON o.id=c.organization_id LEFT JOIN load_compositions lc ON lc.ticket_id=c.ticket_id
    WHERE c.operation_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR c.organization_id=$3::uuid)
    ORDER BY c.operation_date,c.certificate_number`, [from, to, organizationId], paging);
}

export async function carbonBaseline(organizationId: string | null, from: string, to: string) {
  return (await dbPool.query(`SELECT to_char(b.month,'YYYY-MM') AS month,b.organization_id AS operator_id,o.name AS operator,b.destination,
      b.stream_code AS stream,b.loads,b.tonnes,coalesce(b.measured_tonnes,0) AS measured_tonnes,b.ch4_tonnes,b.co2e_tonnes,b.factor_version
    FROM carbon_baseline b JOIN organizations o ON o.id=b.organization_id
    WHERE b.month BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR b.organization_id=$3::uuid)
    ORDER BY b.month,o.name,b.destination,b.stream_code`, [`${from}-01`, `${to}-01`, organizationId])).rows;
}

/** One Kampala day of a company's own receipts. Phone numbers and street addresses are left out. */
export async function receipts(organizationId: string, date: string, paging: Paging) {
  return page(`SELECT r.serial_number,r.chain_position,r.issued_at,r.collected_at,r.customer_name,r.location_label,r.zone_name,
      r.collected_weight_kg,r.truck_plate,r.driver_name,r.previous_hash,r.record_hash,(v.id IS NOT NULL) AS voided,v.reason AS void_reason,v.voided_at
    FROM collection_receipts r LEFT JOIN collection_receipt_voids v ON v.receipt_id=r.id
    WHERE r.organization_id=$1::uuid AND (r.issued_at AT TIME ZONE 'Africa/Kampala')::date=$2::date
    ORDER BY r.chain_position`, [organizationId, date], paging);
}
