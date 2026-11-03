import { dbPool } from "../config/database";

// Landfill and tipping (migration 115). Certificates are issued by the database when a ticket completes; this module
// records composition, publishes methane factors, refreshes the monthly carbon baseline and reads it back.

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
/** The migration's own refusals (KW400 bad input, KW409 immutable) become 400/409 with their message. */
const database = (error: unknown): never => {
  const e = error as { code?: string; message?: string };
  if (e.code === "KW400") throw fail(400, e.message ?? "Invalid input");
  if (e.code === "KW409") throw fail(409, e.message ?? "Conflict");
  throw error;
};
const REFRESH_EVERY_HOURS = 20;
const DIVERTED = "destination IN ('composting','materials_recovery','recycling')";

export async function streamsAndFactors() {
  const [streams, sets] = await Promise.all([
    dbPool.query(`SELECT s.code,s.name,f.doc,f.default_share_pct FROM waste_streams s
      LEFT JOIN carbon_factor_streams f ON f.stream_code=s.code AND f.version=(SELECT max(version) FROM carbon_factor_sets)
      ORDER BY s.sort_order`),
    dbPool.query(`SELECT version,methodology,docf,mcf,methane_fraction,oxidation,gwp_ch4,change_summary,published_by_name,published_at
      FROM carbon_factor_sets ORDER BY version DESC`),
  ]);
  return { streams: streams.rows, current: sets.rows[0], versions: sets.rows };
}

/** Totals, months, streams and (for KCCA) operators between two months, from the baseline the caller may see. */
export async function landfillOverview(organizationId: string | null, from: string, to: string) {
  const range = [`${from}-01`, `${to}-01`, organizationId];
  const where = "month BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR organization_id=$3::uuid)";
  const sums = `coalesce(sum(tonnes) FILTER (WHERE NOT ${DIVERTED}),0) landfilled_t,
    coalesce(sum(tonnes) FILTER (WHERE ${DIVERTED}),0) diverted_t,
    coalesce(sum(measured_tonnes) FILTER (WHERE destination<>'recycling'),0) measured_t,
    coalesce(sum(tonnes) FILTER (WHERE destination<>'recycling'),0) weighed_t,
    coalesce(sum(co2e_tonnes) FILTER (WHERE NOT ${DIVERTED}),0) landfilled_co2e_t,
    coalesce(sum(co2e_tonnes) FILTER (WHERE ${DIVERTED}),0) avoided_co2e_t`;
  const [totals, months, streams, operators, refreshed, certificates] = await Promise.all([
    dbPool.query(`SELECT ${sums} FROM carbon_baseline WHERE ${where}`, range),
    dbPool.query(`SELECT to_char(month,'YYYY-MM') AS month,${sums} FROM carbon_baseline WHERE ${where} GROUP BY month ORDER BY month`, range),
    dbPool.query(`SELECT s.code,s.name,${sums} FROM carbon_baseline b JOIN waste_streams s ON s.code=b.stream_code
      WHERE ${where} GROUP BY s.code,s.name,s.sort_order ORDER BY s.sort_order`, range),
    organizationId ? Promise.resolve({ rows: [] }) : dbPool.query(`SELECT o.id,o.name,o.type,${sums} FROM carbon_baseline b
      JOIN organizations o ON o.id=b.organization_id WHERE ${where} GROUP BY o.id,o.name,o.type ORDER BY sum(tonnes) DESC`, range),
    dbPool.query("SELECT refreshed_at,factor_version,trigger_source FROM carbon_baseline_refreshes ORDER BY id DESC LIMIT 1"),
    dbPool.query(`SELECT count(*)::int issued,count(*) FILTER (WHERE revoked_at IS NOT NULL)::int revoked FROM load_certificates
      WHERE operation_date>=$1::date AND operation_date<($2::date+interval '1 month') AND ($3::uuid IS NULL OR organization_id=$3::uuid)`, range),
  ]);
  return { totals: totals.rows[0], months: months.rows, streams: streams.rows, operators: operators.rows,
    refreshed: refreshed.rows[0] ?? null, certificates: certificates.rows[0] };
}

/** Completed and voided weighbridge loads with their composition and certificate. */
export async function listLoads(organizationId: string | null, input: { from: string; to: string; composition: "all" | "missing" | "recorded" }) {
  return (await dbPool.query(`SELECT w.id,w.ticket_number,w.operation_date::text operation_date,w.registration,w.status,w.net_kg,
      w.facility_code,coalesce(d.name,w.facility) facility_name,coalesce(d.kind,'landfill') facility_kind,o.name organization_name,
      lc.method composition_method,lc.shares,lc.sample_kg,lc.notes composition_notes,lc.recorded_at composition_recorded_at,
      c.id certificate_id,c.certificate_number,c.verification_code,c.revoked_at
    FROM weighbridge_transactions w JOIN organizations o ON o.id=w.organization_id
    LEFT JOIN disposal_facilities d ON d.code=w.facility_code
    LEFT JOIN load_compositions lc ON lc.ticket_id=w.id
    LEFT JOIN load_certificates c ON c.ticket_id=w.id
    WHERE w.status IN ('completed','voided') AND w.operation_date BETWEEN $1::date AND $2::date
      AND ($3::uuid IS NULL OR w.organization_id=$3::uuid)
      AND ($4='all' OR ($4='missing' AND lc.id IS NULL AND w.status='completed') OR ($4='recorded' AND lc.id IS NOT NULL))
    ORDER BY w.operation_date DESC,w.arrival_at DESC LIMIT 500`, [input.from, input.to, organizationId, input.composition])).rows;
}

export async function recordComposition(ticketId: string, input: { method: string; sampleKg?: number; notes?: string; shares: Record<string, number> }, userId: string) {
  try {
    const row = (await dbPool.query(`INSERT INTO load_compositions(ticket_id,organization_id,method,shares,sample_kg,notes,recorded_by)
      SELECT $1::uuid,organization_id,$2,$3::jsonb,$4,$5,$6::uuid FROM weighbridge_transactions WHERE id=$1::uuid
      ON CONFLICT(ticket_id) DO UPDATE SET method=EXCLUDED.method,shares=EXCLUDED.shares,sample_kg=EXCLUDED.sample_kg,
        notes=EXCLUDED.notes,recorded_by=EXCLUDED.recorded_by
      RETURNING ticket_id,method,shares,sample_kg,recorded_at`,
    [ticketId, input.method, JSON.stringify(input.shares), input.method === "sample_sort" ? input.sampleKg : null, input.notes || null, userId])).rows[0];
    if (!row) throw fail(404, "Weighbridge ticket not found");
    return row;
  } catch (error) { return database(error); }
}

const certificateColumns = `c.*,c.operation_date::text operation_date,o.name organization_name,lc.method composition_method,
  (SELECT json_agg(json_build_object('name',s.name,'share_pct',(lc.shares->>s.code)::numeric) ORDER BY s.sort_order)
     FROM waste_streams s WHERE lc.shares ? s.code) composition,
  load_certificate_hash(c)=c.record_hash intact`;

export async function certificateById(id: string, organizationId: string | null) {
  return (await dbPool.query(`SELECT ${certificateColumns} FROM load_certificates c JOIN organizations o ON o.id=c.organization_id
    LEFT JOIN load_compositions lc ON lc.ticket_id=c.ticket_id WHERE c.id=$1::uuid AND ($2::uuid IS NULL OR c.organization_id=$2::uuid)`,
  [id, organizationId])).rows[0] ?? null;
}

/** What anyone holding the code may see: the weighed load, never people or prices. */
export async function publicCertificate(code: string) {
  const row = (await dbPool.query(`SELECT ${certificateColumns} FROM load_certificates c JOIN organizations o ON o.id=c.organization_id
    LEFT JOIN load_compositions lc ON lc.ticket_id=c.ticket_id WHERE c.verification_code=$1`, [code])).rows[0];
  if (!row) return null;
  const { certificate_number, verification_code, organization_name, ticket_number, facility_name, facility_kind, registration, operation_date,
    gross_kg, tare_kg, net_kg, issued_at, revoked_at, revoked_reason, composition, composition_method, intact } = row;
  return { certificate_number, verification_code, organization_name, ticket_number, facility_name, facility_kind, registration, operation_date,
    gross_kg, tare_kg, net_kg, issued_at, revoked_at, revoked_reason, composition, composition_method, intact };
}

export async function publishFactors(input: {
  methodology: string; docf: number; mcf: number; methaneFraction: number; oxidation: number; gwpCh4: number; changeSummary: string;
  streams: Record<string, { doc: number; defaultSharePct: number }>;
}, userId: string) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE carbon_factor_sets IN SHARE ROW EXCLUSIVE MODE");
    const known = (await client.query("SELECT code FROM waste_streams")).rows.map(r => r.code as string);
    const missing = known.filter(code => !input.streams[code]), unknown = Object.keys(input.streams).filter(code => !known.includes(code));
    if (missing.length || unknown.length) throw fail(400, `Give a value for every stream${missing.length ? ` (missing: ${missing.join(", ")})` : ""}${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
    const set = (await client.query(`INSERT INTO carbon_factor_sets(version,methodology,docf,mcf,methane_fraction,oxidation,gwp_ch4,change_summary,published_by,published_by_name)
      SELECT coalesce(max(version),0)+1,$1,$2,$3,$4,$5,$6,$7,$8::uuid,(SELECT full_name FROM users WHERE id=$8::uuid) FROM carbon_factor_sets RETURNING *`,
    [input.methodology, input.docf, input.mcf, input.methaneFraction, input.oxidation, input.gwpCh4, input.changeSummary, userId])).rows[0];
    await client.query(`INSERT INTO carbon_factor_streams(version,stream_code,doc,default_share_pct)
      SELECT $1,key,(value->>'doc')::numeric,(value->>'defaultSharePct')::numeric FROM jsonb_each($2::jsonb)`, [set.version, JSON.stringify(input.streams)]);
    await client.query("COMMIT");
    await refreshBaseline("factors");
    return set;
  } catch (error) {
    await client.query("ROLLBACK");
    return database(error);
  } finally { client.release(); }
}

export async function refreshBaseline(source: "schedule" | "kcca" | "factors") {
  return (await dbPool.query("SELECT refresh_carbon_baseline($1) factor_version", [source])).rows[0];
}

/** Daily refresh from the scheduler; skipped while a recent one exists. */
export async function refreshBaselineIfDue() {
  const due = (await dbPool.query(`SELECT NOT EXISTS(SELECT 1 FROM carbon_baseline_refreshes
    WHERE refreshed_at>now()-make_interval(hours=>$1)) due`, [REFRESH_EVERY_HOURS])).rows[0].due;
  return due ? refreshBaseline("schedule") : null;
}

/** The monthly baseline as rows for verifiers: one line per month, operator, destination and stream. */
export async function baselineRows(organizationId: string | null, from: string, to: string) {
  return (await dbPool.query(`SELECT to_char(b.month,'YYYY-MM') AS month,o.name operator,b.destination,b.stream_code stream,b.loads,
      b.tonnes,coalesce(b.measured_tonnes,0) measured_tonnes,b.ch4_tonnes,b.co2e_tonnes,b.factor_version
    FROM carbon_baseline b JOIN organizations o ON o.id=b.organization_id
    WHERE b.month BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR b.organization_id=$3::uuid)
    ORDER BY b.month,o.name,b.destination,b.stream_code`, [`${from}-01`, `${to}-01`, organizationId])).rows;
}
