import { dbPool } from "../config/database";
import { Page, queryPage } from "../utils/pagination";
import { buildExportContent, receiptSigningKey, sha256Hex, signText } from "../services/receipt-signing";

// Electronic collection receipts (migration 111). Receipts are issued by the database when a stop is completed; this
// module reads them, records voids, manages the serial format and operator codes, and produces the signed daily exports.

const KAMPALA = "Africa/Kampala";
const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });

const receiptColumns = `r.id,r.organization_id,r.serial_number,r.chain_position,r.collected_at,r.issued_at,r.collected_weight_kg,
 r.company_name,r.customer_name,r.customer_phone,r.location_label,r.address,r.zone_name,r.truck_plate,r.driver_name,r.record_hash,
 v.reason void_reason,v.voided_at,v.voided_by_name,
 sms.status sms_status,sms.sent_at sms_sent_at,sms.last_error sms_error`;
const receiptJoins = `FROM collection_receipts r
 LEFT JOIN collection_receipt_voids v ON v.receipt_id=r.id
 LEFT JOIN LATERAL (SELECT d.status,d.sent_at,d.last_error FROM notifications n JOIN notification_deliveries d ON d.notification_id=n.id AND d.channel='sms'
   WHERE n.dedupe_key='collection-receipt:'||r.id LIMIT 1) sms ON true`;

export type ReceiptFilter = {
  organizationId: string | null; customerUserId: string | null; from?: string; to?: string; search?: string; status?: "valid" | "voided";
};

export async function listReceipts(filter: ReceiptFilter, page?: Page) {
  return queryPage(`SELECT ${receiptColumns} ${receiptJoins}
   WHERE ($1::uuid IS NULL OR r.organization_id=$1::uuid)
    AND ($2::uuid IS NULL OR r.customer_id=(SELECT id FROM customer_profiles WHERE user_id=$2::uuid))
    AND ($3::date IS NULL OR r.issued_at>=($3::date::timestamp AT TIME ZONE '${KAMPALA}'))
    AND ($4::date IS NULL OR r.issued_at<(($4::date+1)::timestamp AT TIME ZONE '${KAMPALA}'))
    AND ($5::text IS NULL OR r.serial_number ILIKE '%'||$5||'%' OR r.customer_name ILIKE '%'||$5||'%' OR r.location_label ILIKE '%'||$5||'%' OR r.customer_phone ILIKE '%'||$5||'%')
    AND ($6::text IS NULL OR ($6='voided')=(v.id IS NOT NULL))
   ORDER BY r.issued_at DESC,r.id`,
  [filter.organizationId, filter.customerUserId, filter.from ?? null, filter.to ?? null, filter.search?.trim() || null, filter.status ?? null], page);
}

/** What anyone holding a receipt (or its SMS link) may see: no phone number, the household's name shortened. */
export async function findPublicReceipt(serial: string) {
  const row = (await dbPool.query(`SELECT r.serial_number,r.company_name,r.customer_name,r.location_label,r.zone_name,r.collected_at,r.issued_at,
    r.collected_weight_kg,r.truck_plate,v.voided_at,v.reason void_reason,
    r.record_hash=collection_receipt_hash(r.previous_hash,collection_receipt_payload(r)) intact
   FROM collection_receipts r LEFT JOIN collection_receipt_voids v ON v.receipt_id=r.id WHERE r.serial_number=$1`, [serial])).rows[0];
  if (!row) return null;
  const [first, ...rest] = String(row.customer_name).trim().split(/\s+/);
  return { ...row, customer_name: rest.length ? `${first} ${rest.map(part => `${part[0]}.`).join(" ")}` : first, status: row.voided_at ? "voided" : "valid" };
}

export async function voidReceipt(id: string, organizationId: string, userId: string, reason: string) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const receipt = (await client.query("SELECT id,serial_number FROM collection_receipts WHERE id=$1::uuid AND organization_id=$2::uuid", [id, organizationId])).rows[0];
    if (!receipt) throw notFound("Receipt not found in your organization");
    const inserted = await client.query(
      `INSERT INTO collection_receipt_voids(receipt_id,organization_id,reason,voided_by,voided_by_name)
       SELECT $1,$2,$3,u.id,u.full_name FROM users u WHERE u.id=$4::uuid ON CONFLICT(receipt_id) DO NOTHING RETURNING *`,
      [id, organizationId, reason.trim(), userId]);
    if (!inserted.rows[0]) throw conflict(`Receipt ${receipt.serial_number} is already voided`);
    await client.query("COMMIT");
    return { ...inserted.rows[0], serial_number: receipt.serial_number };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function receiptSummary(organizationId: string) {
  const [counts, series, lastExport] = await Promise.all([
    dbPool.query(`SELECT
      count(*) FILTER (WHERE (r.issued_at AT TIME ZONE '${KAMPALA}')::date=(now() AT TIME ZONE '${KAMPALA}')::date)::int today,
      count(*) FILTER (WHERE r.issued_at>=date_trunc('month',now() AT TIME ZONE '${KAMPALA}') AT TIME ZONE '${KAMPALA}')::int this_month,
      count(v.id) FILTER (WHERE v.voided_at>=date_trunc('month',now() AT TIME ZONE '${KAMPALA}') AT TIME ZONE '${KAMPALA}')::int voided_this_month,
      count(*) FILTER (WHERE r.customer_phone IS NULL AND r.issued_at>=now()-interval '30 days')::int without_phone_30d,
      count(*) FILTER (WHERE sms.status='failed' AND r.issued_at>=now()-interval '30 days')::int sms_failed_30d
     ${receiptJoins} WHERE r.organization_id=$1::uuid`, [organizationId]),
    dbPool.query("SELECT code,last_position,first_issued_on::text FROM receipt_series WHERE organization_id=$1::uuid", [organizationId]),
    dbPool.query("SELECT export_date::text,generated_at FROM collection_receipt_exports WHERE organization_id=$1::uuid ORDER BY export_date DESC LIMIT 1", [organizationId]),
  ]);
  return { ...counts.rows[0], series: series.rows[0] ?? null, last_export: lastExport.rows[0] ?? null };
}

/** KCCA's view: one row per operator that has issued receipts, with gaps in the daily exports. */
export async function cityReceiptOperators() {
  return (await dbPool.query(`SELECT s.organization_id,o.name organization_name,s.code,s.first_issued_on::text,s.last_position total_receipts,
    (SELECT count(*)::int FROM collection_receipts r WHERE r.organization_id=s.organization_id AND r.issued_at>=now()-interval '7 days') receipts_7d,
    (SELECT count(*)::int FROM collection_receipt_voids v WHERE v.organization_id=s.organization_id AND v.voided_at>=now()-interval '30 days') voids_30d,
    (SELECT max(export_date)::text FROM collection_receipt_exports e WHERE e.organization_id=s.organization_id) last_export_date,
    GREATEST(0,((now() AT TIME ZONE '${KAMPALA}')::date-s.first_issued_on)
      -(SELECT count(*) FROM collection_receipt_exports e WHERE e.organization_id=s.organization_id))::int missing_exports
   FROM receipt_series s JOIN organizations o ON o.id=s.organization_id
   ORDER BY o.name`)).rows;
}

export async function getReceiptSettings() {
  const settings = (await dbPool.query(`SELECT s.serial_format,s.updated_at,u.full_name updated_by_name FROM receipt_settings s
    LEFT JOIN users u ON u.id=s.updated_by`)).rows[0];
  const key = receiptSigningKey();
  return { ...settings, signing_key_id: key.keyId, signing_public_key: key.publicKeyPem, development_key: key.development };
}

export async function updateSerialFormat(format: string, userId: string) {
  return (await dbPool.query("UPDATE receipt_settings SET serial_format=$1,updated_by=$2,updated_at=CURRENT_TIMESTAMP RETURNING serial_format,updated_at", [format, userId])).rows[0];
}

/** Sets an operator's code; receipts already issued keep their serials. Creates the series when none exists yet. */
export async function setOperatorCode(organizationId: string, code: string, userId: string) {
  try {
    const row = (await dbPool.query(`INSERT INTO receipt_series(organization_id,code,updated_by) SELECT id,$2,$3 FROM organizations
      WHERE id=$1::uuid AND type='waste_collection_company'
      ON CONFLICT(organization_id) DO UPDATE SET code=EXCLUDED.code,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP
      RETURNING organization_id,code`, [organizationId, code, userId])).rows[0];
    if (!row) throw notFound("Collection company not found");
    return row;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw conflict(`Code ${code} is already used by another operator`);
    throw error;
  }
}

export async function verifyChain(organizationId: string) {
  const result = (await dbPool.query("SELECT * FROM verify_collection_receipt_chain($1::uuid)", [organizationId])).rows[0];
  return { checked: Number(result.checked), intact: !result.first_broken_serial, first_broken_serial: result.first_broken_serial, checked_at: new Date().toISOString() };
}

export async function listExports(organizationId: string | null, page?: Page) {
  return queryPage(`SELECT e.id,e.organization_id,o.name organization_name,e.export_date::text,e.receipt_count,e.void_count,e.first_serial,e.last_serial,
    e.content_sha256,e.signing_key_id,e.generated_at
   FROM collection_receipt_exports e JOIN organizations o ON o.id=e.organization_id
   WHERE ($1::uuid IS NULL OR e.organization_id=$1::uuid) ORDER BY e.export_date DESC,o.name,e.id`, [organizationId], page);
}

export async function findExport(id: string, organizationId: string | null) {
  return (await dbPool.query(`SELECT e.*,e.export_date::text export_date,o.name organization_name FROM collection_receipt_exports e JOIN organizations o ON o.id=e.organization_id
   WHERE e.id=$1::uuid AND ($2::uuid IS NULL OR e.organization_id=$2::uuid)`, [id, organizationId])).rows[0] ?? null;
}

/** Builds and stores the signed export for one operator and one finished Kampala day. Returns null when it already exists. */
export async function generateExport(organizationId: string, date: string) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`receipt-export:${organizationId}:${date}`]);
    if ((await client.query("SELECT 1 FROM collection_receipt_exports WHERE organization_id=$1::uuid AND export_date=$2::date", [organizationId, date])).rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    const organization = (await client.query("SELECT o.id,o.name,s.code FROM organizations o JOIN receipt_series s ON s.organization_id=o.id WHERE o.id=$1::uuid", [organizationId])).rows[0];
    if (!organization) throw notFound("This operator has not issued receipts");
    const dayStart = `($2::date::timestamp AT TIME ZONE '${KAMPALA}')`, dayEnd = `(($2::date+1)::timestamp AT TIME ZONE '${KAMPALA}')`;
    const receipts = (await client.query(`SELECT * FROM collection_receipts WHERE organization_id=$1::uuid AND issued_at>=${dayStart} AND issued_at<${dayEnd} ORDER BY chain_position`, [organizationId, date])).rows;
    const voids = (await client.query(`SELECT r.serial_number,v.reason,v.voided_by_name,v.voided_at FROM collection_receipt_voids v JOIN collection_receipts r ON r.id=v.receipt_id
      WHERE v.organization_id=$1::uuid AND v.voided_at>=${dayStart} AND v.voided_at<${dayEnd} ORDER BY v.voided_at,r.serial_number`, [organizationId, date])).rows;
    const head = (await client.query(`SELECT record_hash FROM collection_receipts WHERE organization_id=$1::uuid AND issued_at<${dayEnd} ORDER BY chain_position DESC LIMIT 1`, [organizationId, date])).rows[0];
    const content = buildExportContent({ organization, date, receipts, voids, chainHeadHash: head?.record_hash ?? null });
    const key = receiptSigningKey();
    const row = (await client.query(`INSERT INTO collection_receipt_exports(organization_id,export_date,receipt_count,void_count,first_serial,last_serial,
       chain_head_hash,content,content_sha256,signature,signing_key_id,signing_public_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,organization_id,export_date::text,receipt_count,void_count`,
      [organizationId, date, receipts.length, voids.length, receipts[0]?.serial_number ?? null, receipts.at(-1)?.serial_number ?? null,
        head?.record_hash ?? null, content, sha256Hex(content), signText(content, key), key.keyId, key.publicKeyPem])).rows[0];
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Every finished Kampala day since each operator's first receipt that has no export yet, oldest first. */
export async function generateDueExports(limit = 200) {
  const due = (await dbPool.query(`SELECT s.organization_id,d::date::text export_date FROM receipt_series s
    CROSS JOIN LATERAL generate_series(s.first_issued_on,(now() AT TIME ZONE '${KAMPALA}')::date-1,interval '1 day') d
    WHERE s.first_issued_on IS NOT NULL AND NOT EXISTS (SELECT 1 FROM collection_receipt_exports e WHERE e.organization_id=s.organization_id AND e.export_date=d::date)
    ORDER BY d,s.organization_id LIMIT $1`, [limit])).rows as { organization_id: string; export_date: string }[];
  let generated = 0;
  for (const item of due) if (await generateExport(item.organization_id, item.export_date)) generated++;
  return generated;
}
