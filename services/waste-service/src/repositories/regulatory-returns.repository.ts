import { notifyOrganization } from "../services/notify";
import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { effectivePermitStatus } from "../services/permit-lifecycle.rules";
import {
  COLLECTOR_FIELDS,
  FACTORY_FIELDS,
  MATERIAL_CATEGORIES,
  dueOn,
  flattenMaterials,
  periodEnd,
  periodError,
  periodStart,
  periodState,
  requiredPeriods,
  variances,
} from "../services/regulatory-returns.rules";
import { collectorReturnFiguresSchema, factoryReturnFiguresSchema, recyclerReturnFiguresSchema } from "../validators/regulatory.validator";

const monthLabel = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

type Declaration = { declarantName: string; declarantTitle: string; figures: unknown };

const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });
const num = (value: unknown) => Number(value ?? 0);
const REPORTING_TYPES = ["waste_collection_company", "recycling_company", "processing_plant"];

export const currentDate = () => today();

async function today(client: PoolClient | typeof dbPool = dbPool): Promise<string> {
  return (await client.query("SELECT CURRENT_DATE::text AS d")).rows[0].d;
}

async function organization(client: PoolClient | typeof dbPool, organizationId: string) {
  const row = (await client.query("SELECT id,name,type,is_active,created_at::date::text AS joined_on FROM organizations WHERE id=$1::uuid", [organizationId])).rows[0];
  if (!row) throw notFound("Organization not found");
  if (!REPORTING_TYPES.includes(row.type)) throw badRequest("Statutory returns apply to waste collectors, recycling companies and recycling factories");
  return row as { id: string; name: string; type: string; is_active: boolean; joined_on: string };
}

/** What the platform recorded for the month. Zero where the company does not use the matching module. */
export async function platformFigures(client: PoolClient | typeof dbPool, organizationId: string, type: string, period: string) {
  const from = periodStart(period), to = periodEnd(period);
  if (type === "waste_collection_company") {
    const row = (await client.query(
      `SELECT
         (SELECT COUNT(DISTINCT customer_id) FROM customer_service_relationships WHERE organization_id=$1::uuid AND effective_from<=$3::date AND (effective_to IS NULL OR effective_to>=$2::date)) AS customers_served,
         (SELECT COUNT(*) FROM collection_routes WHERE organization_id=$1::uuid AND status='completed' AND route_date BETWEEN $2 AND $3) AS trips_completed,
         (SELECT COUNT(*) FROM collection_jobs WHERE organization_id=$1::uuid AND status='completed' AND job_date BETWEEN $2 AND $3) AS collections_completed,
         (SELECT COUNT(*) FROM collection_jobs WHERE organization_id=$1::uuid AND status='missed' AND job_date BETWEEN $2 AND $3) AS collections_missed,
         (SELECT COALESCE(SUM(net_kg),0) FROM weighbridge_transactions WHERE organization_id=$1::uuid AND status='completed' AND operation_date BETWEEN $2 AND $3) AS waste_disposed_kg,
         (SELECT COUNT(DISTINCT truck_id) FROM collection_routes WHERE organization_id=$1::uuid AND status='completed' AND route_date BETWEEN $2 AND $3) AS vehicles_operated,
         (SELECT COUNT(*) FROM organization_memberships WHERE organization_id=$1::uuid AND status='active') AS staff_employed,
         (SELECT COUNT(*) FROM citizen_issues WHERE assigned_organization_id=$1::uuid AND created_at::date BETWEEN $2 AND $3) AS complaints_received,
         (SELECT COUNT(*) FROM citizen_issues WHERE assigned_organization_id=$1::uuid AND status='resolved' AND resolved_at::date BETWEEN $2 AND $3) AS complaints_resolved`,
      [organizationId, from, to])).rows[0];
    return Object.fromEntries(COLLECTOR_FIELDS.map(([field]) => [field, num(row[field])])) as Record<string, number>;
  }
  if (type === "processing_plant") {
    const row = (await client.query(
      `SELECT
         (SELECT COALESCE(SUM(accepted_kg),0) FROM factory_intakes WHERE organization_id=$1::uuid AND status='received' AND received_on BETWEEN $2 AND $3) AS accepted_kg,
         (SELECT COALESCE(SUM(rejected_kg),0) FROM factory_intakes WHERE organization_id=$1::uuid AND status='received' AND received_on BETWEEN $2 AND $3) AS rejected_kg,
         (SELECT COALESCE(SUM(input_kg),0) FROM factory_batches WHERE organization_id=$1::uuid AND processed_on BETWEEN $2 AND $3) AS processed_kg,
         (SELECT COALESCE(SUM(output_kg),0) FROM factory_batches WHERE organization_id=$1::uuid AND processed_on BETWEEN $2 AND $3) AS output_kg,
         (SELECT COALESCE(SUM(residue_kg),0) FROM factory_batches WHERE organization_id=$1::uuid AND processed_on BETWEEN $2 AND $3) AS residue_kg,
         (SELECT COALESCE(SUM(quantity_kg),0) FROM factory_dispatches WHERE organization_id=$1::uuid AND dispatched_on BETWEEN $2 AND $3) AS dispatched_kg,
         (SELECT COUNT(*) FROM organization_memberships WHERE organization_id=$1::uuid AND status='active') AS staff_employed`,
      [organizationId, from, to])).rows[0];
    return Object.fromEntries(FACTORY_FIELDS.map(([field]) => [field, num(row[field])])) as Record<string, number>;
  }
  const category = `COALESCE((SELECT c.category FROM recycling_material_catalog c WHERE c.organization_id=l.organization_id AND lower(c.name)=lower(l.material_type) LIMIT 1),'other')`;
  const [materials, other] = await Promise.all([
    client.query(
      `WITH collected AS (
         SELECT ${category} AS category,SUM(l.quantity_kg) AS kg FROM recycling_material_lots l
         WHERE l.organization_id=$1::uuid AND l.origin='purchase' AND l.status<>'rejected' AND l.collected_on BETWEEN $2 AND $3 GROUP BY 1
       ), sold AS (
         SELECT ${category} AS category,SUM(s.quantity_kg) AS kg FROM recycling_material_sales s JOIN recycling_material_lots l ON l.id=s.lot_id
         WHERE s.organization_id=$1::uuid AND s.sold_on BETWEEN $2 AND $3 GROUP BY 1
       )
       SELECT COALESCE(c.category,s.category) AS category,COALESCE(c.kg,0) AS collected,COALESCE(s.kg,0) AS sold FROM collected c FULL JOIN sold s ON s.category=c.category`,
      [organizationId, from, to]),
    client.query(
      `SELECT (SELECT COALESCE(SUM(rejected_kg),0) FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on BETWEEN $2 AND $3) AS residue_kg,
              (SELECT COUNT(*) FROM organization_memberships WHERE organization_id=$1::uuid AND status='active') AS staff_employed`,
      [organizationId, from, to]),
  ]);
  const byCategory = new Map(materials.rows.map(row => [row.category, row]));
  const rows = MATERIAL_CATEGORIES.filter(c => byCategory.has(c)).map(c => ({ category: c, collectedKg: num(byCategory.get(c).collected), soldKg: num(byCategory.get(c).sold) }));
  return { ...flattenMaterials(rows), residue_kg: num(other.rows[0].residue_kg), staff_employed: num(other.rows[0].staff_employed) } as Record<string, number>;
}

function parseFigures(type: string, figures: unknown) {
  const schema = type === "waste_collection_company" ? collectorReturnFiguresSchema : type === "processing_plant" ? factoryReturnFiguresSchema : recyclerReturnFiguresSchema;
  const parsed = schema.safeParse(figures);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(`${issue.path.join(".") || "figures"}: ${issue.message}`);
  }
  const value = parsed.data as any;
  const comparable: Record<string, number> = type === "waste_collection_company"
    ? Object.fromEntries(COLLECTOR_FIELDS.map(([field]) => [field, value[field]]))
    : type === "processing_plant"
      ? Object.fromEntries(FACTORY_FIELDS.map(([field]) => [field, value[field]]))
      : { ...flattenMaterials(value.materials), residue_kg: value.residue_kg, staff_employed: value.staff_employed };
  return { value, comparable };
}

async function history(client: PoolClient, returnId: string, version: number, action: string, figures: unknown, notes: string | null, actorId: string) {
  await client.query(
    "INSERT INTO regulatory_return_history(return_id,version,action,figures,notes,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
    [returnId, version, action, figures === null ? null : JSON.stringify(figures), notes, actorId]);
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

const RETURN_COLUMNS = `r.id,r.return_number,r.organization_id,r.organization_type,to_char(r.period_month,'YYYY-MM') AS period,r.due_on::text AS due_on,r.status,r.version,
  r.figures,r.platform_figures,r.variances,r.declarant_name,r.declarant_title,r.submitted_at,r.first_submitted_at,r.submitted_late,r.review_notes,r.reviewed_at`;

// ---------- Company ----------

export async function organizationReturns(organizationId: string) {
  const [org, dateToday] = await Promise.all([organization(dbPool, organizationId), today()]);
  const filed = (await dbPool.query(`SELECT ${RETURN_COLUMNS} FROM regulatory_returns r WHERE r.organization_id=$1::uuid ORDER BY r.period_month DESC`, [organizationId])).rows;
  const byPeriod = new Map(filed.map(row => [row.period, row]));
  const periods = requiredPeriods(org.joined_on, dateToday).reverse().map(period => ({
    period, due_on: dueOn(period), state: periodState(period, byPeriod.get(period)?.status ?? null, dateToday), return: byPeriod.get(period) ?? null,
  }));
  return { organization: { name: org.name, type: org.type }, today: dateToday, periods };
}

export async function prefill(organizationId: string, period: string) {
  const [org, dateToday] = await Promise.all([organization(dbPool, organizationId), today()]);
  const error = periodError(period, org.joined_on, dateToday);
  if (error) throw badRequest(error);
  const existing = (await dbPool.query(`SELECT ${RETURN_COLUMNS} FROM regulatory_returns r WHERE r.organization_id=$1::uuid AND r.period_month=$2::date`, [organizationId, periodStart(period)])).rows[0] ?? null;
  return { period, due_on: dueOn(period), organization_type: org.type, recorded: await platformFigures(dbPool, organizationId, org.type, period), existing };
}

export async function submitReturn(organizationId: string, userId: string, input: Declaration & { period: string }) {
  return inTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`return:${organizationId}:${input.period}`]);
    const org = await organization(client, organizationId), dateToday = await today(client);
    const error = periodError(input.period, org.joined_on, dateToday);
    if (error) throw badRequest(error);
    const existing = await client.query("SELECT status FROM regulatory_returns WHERE organization_id=$1::uuid AND period_month=$2::date", [organizationId, periodStart(input.period)]);
    if (existing.rowCount) throw conflict(existing.rows[0].status === "queried" ? "KCCA queried this return. Correct and resubmit it instead." : "A return for this month has already been submitted");
    const { value, comparable } = parseFigures(org.type, input.figures);
    const recorded = await platformFigures(client, organizationId, org.type, input.period);
    const due = dueOn(input.period);
    const row = (await client.query(
      `INSERT INTO regulatory_returns(return_number,organization_id,organization_type,period_month,due_on,figures,platform_figures,variances,declarant_name,declarant_title,submitted_by,submitted_late)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,return_number,status,version,submitted_late,variances`,
      [`RET-${input.period.replace("-", "")}-${String(Date.now()).slice(-6)}`, organizationId, org.type, periodStart(input.period), due,
        JSON.stringify(value), JSON.stringify(recorded), JSON.stringify(variances(comparable, recorded)), input.declarantName, input.declarantTitle, userId, dateToday > due])).rows[0];
    await history(client, row.id, 1, "submitted", value, `Declared by ${input.declarantName}, ${input.declarantTitle}`, userId);
    return row;
  });
}

export async function resubmitReturn(organizationId: string, userId: string, returnId: string, input: Declaration) {
  return inTransaction(async client => {
    const current = (await client.query(
      "SELECT id,status,version,to_char(period_month,'YYYY-MM') AS period FROM regulatory_returns WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE", [returnId, organizationId])).rows[0];
    if (!current) throw notFound("Return not found");
    if (current.status !== "queried") throw conflict("Only a return KCCA has queried can be resubmitted");
    const org = await organization(client, organizationId);
    const { value, comparable } = parseFigures(org.type, input.figures);
    const recorded = await platformFigures(client, organizationId, org.type, current.period);
    const row = (await client.query(
      `UPDATE regulatory_returns SET status='submitted',version=version+1,figures=$2,platform_figures=$3,variances=$4,declarant_name=$5,declarant_title=$6,
         submitted_by=$7,submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE id=$1::uuid RETURNING id,return_number,status,version,variances`,
      [returnId, JSON.stringify(value), JSON.stringify(recorded), JSON.stringify(variances(comparable, recorded)), input.declarantName, input.declarantTitle, userId])).rows[0];
    await history(client, returnId, row.version, "resubmitted", value, `Declared by ${input.declarantName}, ${input.declarantTitle}`, userId);
    return row;
  });
}

export async function returnDetail(returnId: string, organizationId: string | null) {
  const row = (await dbPool.query(
    `SELECT ${RETURN_COLUMNS},o.name AS organization_name FROM regulatory_returns r JOIN organizations o ON o.id=r.organization_id
     WHERE r.id=$1::uuid AND ($2::uuid IS NULL OR r.organization_id=$2::uuid)`, [returnId, organizationId])).rows[0];
  if (!row) return null;
  const events = (await dbPool.query(
    `SELECT h.version,h.action,h.notes,h.created_at,COALESCE(u.full_name,'System') AS actor FROM regulatory_return_history h LEFT JOIN users u ON u.id=h.actor_id
     WHERE h.return_id=$1::uuid ORDER BY h.created_at,h.id`, [returnId])).rows;
  return { ...row, history: events };
}

// ---------- KCCA ----------

export async function register(period: string) {
  periodStart(period);
  const dateToday = await today();
  const { rows } = await dbPool.query(
    `SELECT o.id AS organization_id,o.name,o.type,o.created_at::date::text AS joined_on,
       r.id AS return_id,r.return_number,r.status,r.version,r.submitted_at,r.submitted_late,jsonb_array_length(r.variances) AS variance_count
     FROM organizations o
     LEFT JOIN regulatory_returns r ON r.organization_id=o.id AND r.period_month=$1::date
     WHERE o.type IN('waste_collection_company','recycling_company','processing_plant') AND (o.is_active OR r.id IS NOT NULL)
     ORDER BY o.name`, [periodStart(period)]);
  const companies = rows
    .filter(row => row.return_id || requiredPeriods(row.joined_on, dateToday).includes(period))
    .map(row => ({ ...row, variance_count: row.variance_count ?? 0, state: periodState(period, row.status, dateToday) }));
  const count = (state: string) => companies.filter(c => c.state === state).length;
  return {
    period, due_on: dueOn(period), today: dateToday, companies,
    totals: { required: companies.length, submitted: count("submitted"), queried: count("queried"), accepted: count("accepted"), due: count("due"), overdue: count("overdue"),
      late: companies.filter(c => c.submitted_late).length, with_variances: companies.filter(c => c.variance_count > 0).length },
  };
}

export async function reviewReturn(returnId: string, userId: string, action: "accept" | "query", notes: string) {
  return inTransaction(async client => {
    const current = (await client.query("SELECT id,status,version,organization_id,to_char(period_month,'YYYY-MM') AS period FROM regulatory_returns WHERE id=$1::uuid FOR UPDATE", [returnId])).rows[0];
    if (!current) throw notFound("Return not found");
    if (current.status !== "submitted") throw conflict(`This return is ${current.status}; only a submitted return can be reviewed`);
    const status = action === "accept" ? "accepted" : "queried";
    await client.query(
      "UPDATE regulatory_returns SET status=$2,review_notes=$3,reviewed_by=$4,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid",
      [returnId, status, notes, userId]);
    await history(client, returnId, current.version, status, null, notes, userId);
    await notifyOrganization(client, current.organization_id, ["company_admin"], {
      category: "returns", severity: action === "accept" ? "info" : "warning",
      title: action === "accept" ? `Monthly return accepted: ${monthLabel(current.period)}` : `KCCA queried your return for ${monthLabel(current.period)}`,
      body: action === "accept" ? `KCCA accepted your return. ${notes}` : `${notes} Correct and resubmit it in Monthly returns.`,
      link: "/dashboard/returns", dedupeKey: `return-review:${returnId}:${current.version}:${status}`,
    });
    return { id: returnId, status };
  });
}

// ---------- Portal summary ----------

export async function portal(organizationId: string) {
  const [org, dateToday] = await Promise.all([organization(dbPool, organizationId), today()]);
  const [permit, compliance, notices, returns] = await Promise.all([
    dbPool.query(
      `SELECT p.permit_number,p.status,p.valid_until::text AS valid_until,
         EXISTS(SELECT 1 FROM permit_renewal_requests r WHERE r.permit_application_id=p.id AND r.status='submitted') AS renewal_pending
       FROM organization_permit_applications p WHERE p.organization_id=$1::uuid AND p.permit_number IS NOT NULL
       ORDER BY (p.status IN('approved','suspended')) DESC,p.valid_until DESC NULLS LAST,p.created_at DESC LIMIT 1`, [organizationId]),
    dbPool.query(
      `SELECT id,case_number,title,severity,status,due_date::text AS due_date FROM collector_compliance_cases
       WHERE organization_id=$1::uuid AND status<>'closed' ORDER BY due_date NULLS LAST LIMIT 5`, [organizationId]),
    dbPool.query("SELECT COUNT(*)::int AS n FROM permit_lifecycle_notices WHERE organization_id=$1::uuid AND acknowledged_at IS NULL", [organizationId]),
    organizationReturns(organizationId),
  ]);
  const p = permit.rows[0];
  const outstanding = returns.periods.filter(period => ["due", "overdue", "queried"].includes(period.state));
  return {
    organization: { name: org.name, type: org.type },
    today: dateToday,
    permit: p ? { ...p, effective_status: effectivePermitStatus(p.status, p.valid_until, dateToday) } : null,
    compliance: { open: compliance.rows, overdue: compliance.rows.filter(c => c.due_date && c.due_date < dateToday && c.status !== "remediation_submitted").length },
    returns: { outstanding, overdue: outstanding.filter(r => r.state === "overdue").length, queried: outstanding.filter(r => r.state === "queried").length },
    unread_notices: notices.rows[0].n,
  };
}
