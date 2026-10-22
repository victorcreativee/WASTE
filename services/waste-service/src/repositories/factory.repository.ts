import { notifyOrganization } from "../services/notify";
import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { Page, queryPage } from "../utils/pagination";
import { custodyState, validateBatchInputs, yieldRate } from "../services/factory.rules";

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });
const num = (value: unknown) => Number(value ?? 0);
const stamp = () => String(Date.now()).slice(-7);

/** Material category of a recycler's lot, from that recycler's own catalogue. */
const LOT_CATEGORY = `COALESCE((SELECT c.category FROM recycling_material_catalog c WHERE c.organization_id=l.organization_id AND lower(c.name)=lower(l.material_type) LIMIT 1),'other')`;

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

/** The signed-in user's organization (used by the web shell to choose a workspace). */
export async function organizationContext(organizationId: string) {
  return (await dbPool.query("SELECT id,name,type,is_active FROM organizations WHERE id=$1::uuid", [organizationId])).rows[0] ?? null;
}

export async function requireFactory(organizationId: string | null) {
  if (!organizationId) throw Object.assign(new Error("Your account is not linked to an organization"), { statusCode: 403 });
  const org = await organizationContext(organizationId);
  if (!org || org.type !== "processing_plant") throw Object.assign(new Error("This workspace is for recycling factories"), { statusCode: 403 });
  return org;
}

async function today(client: PoolClient | typeof dbPool = dbPool) {
  return (await client.query("SELECT CURRENT_DATE::text AS d")).rows[0].d as string;
}

/** Licensed factories a recycler can sell to, with whether their processing permit is in force. */
export async function factoryDirectory() {
  return (await dbPool.query(
    `SELECT o.id,o.name,
       EXISTS(SELECT 1 FROM organization_permit_applications p JOIN organization_permit_activities a ON a.permit_application_id=p.id
         WHERE p.organization_id=o.id AND p.status='approved' AND (p.valid_until IS NULL OR p.valid_until>=CURRENT_DATE)
           AND a.activity_code='recycled_material_processing') AS permit_in_force
     FROM organizations o WHERE o.type='processing_plant' AND o.is_active ORDER BY o.name`)).rows;
}

const EXPECTED = `SELECT s.id AS sale_id,s.sold_on::text AS sold_on,s.quantity_kg AS sold_kg,s.invoice_number,seller.id AS seller_id,seller.name AS seller_name,
    l.material_type,${LOT_CATEGORY} AS material_category
  FROM recycling_material_sales s
  JOIN recycling_material_lots l ON l.id=s.lot_id
  JOIN organizations seller ON seller.id=s.organization_id
  WHERE s.buyer_organization_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM factory_intakes i WHERE i.source_sale_id=s.id AND i.status='received')`;

export async function expectedDeliveries(organizationId: string) {
  const [rows, dateToday] = await Promise.all([dbPool.query(`${EXPECTED} ORDER BY s.sold_on,s.id`, [organizationId]), today()]);
  return rows.rows.map(row => ({ ...row, sold_kg: num(row.sold_kg), state: custodyState({ sold_kg: num(row.sold_kg), sold_on: row.sold_on, received_kg: null }, dateToday) }));
}

export async function overview(organizationId: string) {
  const [stock, month, deliveries, intakes, batches] = await Promise.all([
    dbPool.query(
      `SELECT material_category,SUM(available_kg) AS kg,COUNT(*) FILTER (WHERE available_kg>0)::int AS intakes
       FROM factory_intakes WHERE organization_id=$1::uuid AND status='received' GROUP BY 1 HAVING SUM(available_kg)>0 ORDER BY 2 DESC`, [organizationId]),
    dbPool.query(
      `SELECT
         (SELECT COALESCE(SUM(accepted_kg),0) FROM factory_intakes WHERE organization_id=$1::uuid AND status='received' AND received_on>=date_trunc('month',CURRENT_DATE)) AS accepted_kg,
         (SELECT COALESCE(SUM(rejected_kg),0) FROM factory_intakes WHERE organization_id=$1::uuid AND status='received' AND received_on>=date_trunc('month',CURRENT_DATE)) AS rejected_kg,
         (SELECT COALESCE(SUM(input_kg),0) FROM factory_batches WHERE organization_id=$1::uuid AND processed_on>=date_trunc('month',CURRENT_DATE)) AS input_kg,
         (SELECT COALESCE(SUM(output_kg),0) FROM factory_batches WHERE organization_id=$1::uuid AND processed_on>=date_trunc('month',CURRENT_DATE)) AS output_kg,
         (SELECT COALESCE(SUM(residue_kg),0) FROM factory_batches WHERE organization_id=$1::uuid AND processed_on>=date_trunc('month',CURRENT_DATE)) AS residue_kg,
         (SELECT COALESCE(SUM(quantity_kg),0) FROM factory_dispatches WHERE organization_id=$1::uuid AND dispatched_on>=date_trunc('month',CURRENT_DATE)) AS dispatched_kg`,
      [organizationId]),
    expectedDeliveries(organizationId),
    listIntakes(organizationId, { limit: 5, offset: 0 }),
    listBatches(organizationId, { limit: 5, offset: 0 }),
  ]);
  const m = Object.fromEntries(Object.entries(month.rows[0]).map(([k, v]) => [k, num(v)])) as Record<string, number>;
  return {
    stock: stock.rows.map(row => ({ material_category: row.material_category, kg: num(row.kg), intakes: row.intakes })),
    month: { ...m, yield_rate: yieldRate(m.output_kg, m.input_kg) },
    expected_deliveries: deliveries,
    recent_intakes: intakes.rows,
    recent_batches: batches.rows,
  };
}

// ---------- Intake ----------

export async function listIntakes(organizationId: string, page?: Page) {
  return queryPage(
    `SELECT i.id,i.intake_number,i.source_sale_id,i.supplier_organization_id,i.supplier_name,i.material_category,i.material_description,
       i.declared_kg,i.received_kg,i.rejected_kg,i.accepted_kg,i.available_kg,i.received_on::text AS received_on,i.vehicle_registration,i.notes,
       i.status,i.void_reason,i.created_at,u.full_name AS recorded_by_name
     FROM factory_intakes i JOIN users u ON u.id=i.recorded_by
     WHERE i.organization_id=$1::uuid ORDER BY i.received_on DESC,i.created_at DESC,i.id`, [organizationId], page);
}

type IntakeInput = {
  sourceSaleId?: string; supplierName?: string; materialCategory?: string; materialDescription?: string; declaredKg?: number;
  receivedKg: number; rejectedKg: number; receivedOn: string; vehicleRegistration?: string; notes?: string;
};

export async function createIntake(organizationId: string, userId: string, data: IntakeInput) {
  return inTransaction(async client => {
    const dateToday = await today(client);
    if (data.receivedOn > dateToday) throw badRequest("The receiving date cannot be in the future");
    if (data.rejectedKg > data.receivedKg) throw badRequest("Rejected weight cannot exceed the weight received");
    let supplier: { id: string | null; name: string }, category: string, description: string, declared: number | null;
    if (data.sourceSaleId) {
      const sale = (await client.query(
        `SELECT s.id,s.quantity_kg,s.sold_on::text AS sold_on,seller.id AS seller_id,seller.name AS seller_name,l.material_type,${LOT_CATEGORY} AS category
         FROM recycling_material_sales s JOIN recycling_material_lots l ON l.id=s.lot_id JOIN organizations seller ON seller.id=s.organization_id
         WHERE s.id=$1::uuid AND s.buyer_organization_id=$2::uuid FOR UPDATE OF s`, [data.sourceSaleId, organizationId])).rows[0];
      if (!sale) throw notFound("That delivery was not sold to this factory");
      if ((await client.query("SELECT 1 FROM factory_intakes WHERE source_sale_id=$1::uuid AND status='received'", [sale.id])).rowCount) {
        throw conflict("This delivery has already been received");
      }
      if (data.receivedOn < sale.sold_on) throw badRequest("A delivery cannot be received before it was sold");
      supplier = { id: sale.seller_id, name: sale.seller_name };
      category = sale.category; description = sale.material_type; declared = num(sale.quantity_kg);
    } else {
      if (!data.supplierName || !data.materialCategory || !data.materialDescription) throw badRequest("Name the supplier and describe the material");
      supplier = { id: null, name: data.supplierName }; category = data.materialCategory; description = data.materialDescription; declared = data.declaredKg ?? null;
    }
    const row = (await client.query(
      `INSERT INTO factory_intakes(intake_number,organization_id,source_sale_id,supplier_organization_id,supplier_name,material_category,material_description,
         declared_kg,received_kg,rejected_kg,available_kg,received_on,vehicle_registration,notes,recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10::numeric,$9::numeric-$10::numeric,$11,$12,$13,$14) RETURNING *`,
      [`INT-${dateToday.slice(0, 4)}-${stamp()}`, organizationId, data.sourceSaleId ?? null, supplier.id, supplier.name, category, description,
        declared, data.receivedKg, data.rejectedKg, data.receivedOn, data.vehicleRegistration ?? null, data.notes ?? null, userId])).rows[0];
    const state = declared === null ? null : custodyState({ sold_kg: declared, sold_on: data.receivedOn, received_kg: data.receivedKg }, dateToday);
    if (state === "shortfall" && supplier.id) {
      const factory = (await client.query("SELECT name FROM organizations WHERE id=$1::uuid", [organizationId])).rows[0];
      await notifyOrganization(client, supplier.id, ["company_admin"], {
        category: "custody", severity: "warning", title: `Delivery short at ${factory?.name || "the factory"}`,
        body: `${factory?.name || "The factory"} received ${data.receivedKg.toLocaleString("en-GB")} kg of ${description} against ${declared!.toLocaleString("en-GB")} kg sold. KCCA can see the difference.`,
        link: "/dashboard/recycling", dedupeKey: `custody-shortfall:${row.id}`,
      });
    }
    return { ...row, custody_state: state };
  });
}

export async function voidIntake(organizationId: string, intakeId: string, reason: string) {
  return inTransaction(async client => {
    const intake = (await client.query("SELECT id,status FROM factory_intakes WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE", [intakeId, organizationId])).rows[0];
    if (!intake) throw notFound("Intake not found");
    if (intake.status === "voided") throw conflict("This intake is already voided");
    if ((await client.query("SELECT 1 FROM factory_batch_inputs WHERE intake_id=$1::uuid", [intakeId])).rowCount) {
      throw conflict("This intake has already been processed and cannot be voided");
    }
    await client.query("UPDATE factory_intakes SET status='voided',void_reason=$2,available_kg=0 WHERE id=$1::uuid", [intakeId, reason]);
    return { id: intakeId, status: "voided" };
  });
}

// ---------- Processing ----------

export async function listBatches(organizationId: string, page?: Page) {
  const result = await queryPage<any>(
    `SELECT b.id,b.batch_number,b.processed_on::text AS processed_on,b.product_name,b.input_kg,b.output_kg,b.residue_kg,b.residue_disposal,b.notes,b.created_at,
       u.full_name AS recorded_by_name,
       COALESCE((SELECT SUM(d.quantity_kg) FROM factory_dispatches d WHERE d.batch_id=b.id),0) AS dispatched_kg,
       COALESCE((SELECT json_agg(json_build_object('intake_id',i.id,'intake_number',i.intake_number,'supplier_name',i.supplier_name,'material_category',i.material_category,'kg',bi.kg) ORDER BY i.intake_number)
         FROM factory_batch_inputs bi JOIN factory_intakes i ON i.id=bi.intake_id WHERE bi.batch_id=b.id),'[]'::json) AS inputs
     FROM factory_batches b JOIN users u ON u.id=b.recorded_by
     WHERE b.organization_id=$1::uuid ORDER BY b.processed_on DESC,b.created_at DESC,b.id`, [organizationId], page);
  return { rows: result.rows.map(row => ({ ...row, yield_rate: yieldRate(num(row.output_kg), num(row.input_kg)) })), total: result.total };
}

type BatchInputData = {
  processedOn: string; productName: string; inputs: Array<{ intakeId: string; kg: number }>;
  outputKg: number; residueKg: number; residueDisposal?: string; notes?: string;
};

export async function createBatch(organizationId: string, userId: string, data: BatchInputData) {
  return inTransaction(async client => {
    if (data.processedOn > await today(client)) throw badRequest("The processing date cannot be in the future");
    if (data.residueKg > 0 && !data.residueDisposal) throw badRequest("Say how the residue was disposed of");
    const ids = data.inputs.map(input => input.intakeId);
    const stock = (await client.query(
      `SELECT id,available_kg::float AS available_kg,status,material_category,received_on::text AS received_on FROM factory_intakes
       WHERE organization_id=$1::uuid AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [organizationId, ids])).rows;
    const inputKg = validateBatchInputs(data.inputs, stock, data.outputKg, data.residueKg);
    if (stock.some(item => item.received_on > data.processedOn)) throw badRequest("Material cannot be processed before it was received");
    const batch = (await client.query(
      `INSERT INTO factory_batches(batch_number,organization_id,processed_on,product_name,input_kg,output_kg,residue_kg,residue_disposal,notes,recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [`BAT-${data.processedOn.slice(0, 4)}-${stamp()}`, organizationId, data.processedOn, data.productName, inputKg, data.outputKg, data.residueKg,
        data.residueDisposal ?? null, data.notes ?? null, userId])).rows[0];
    for (const input of data.inputs) {
      await client.query("INSERT INTO factory_batch_inputs(batch_id,intake_id,kg) VALUES($1,$2,$3)", [batch.id, input.intakeId, input.kg]);
      await client.query("UPDATE factory_intakes SET available_kg=available_kg-$2 WHERE id=$1::uuid", [input.intakeId, input.kg]);
    }
    return { ...batch, yield_rate: yieldRate(data.outputKg, inputKg) };
  });
}

// ---------- Dispatch ----------

export async function listDispatches(organizationId: string, page?: Page) {
  return queryPage(
    `SELECT d.id,d.dispatch_number,d.batch_id,b.batch_number,d.product_name,d.quantity_kg,d.buyer_name,d.destination,d.dispatched_on::text AS dispatched_on,
       d.notes,d.created_at,u.full_name AS recorded_by_name
     FROM factory_dispatches d JOIN users u ON u.id=d.recorded_by LEFT JOIN factory_batches b ON b.id=d.batch_id
     WHERE d.organization_id=$1::uuid ORDER BY d.dispatched_on DESC,d.created_at DESC,d.id`, [organizationId], page);
}

type DispatchInput = { batchId?: string; productName: string; quantityKg: number; buyerName: string; destination?: string; dispatchedOn: string; notes?: string };

export async function createDispatch(organizationId: string, userId: string, data: DispatchInput) {
  return inTransaction(async client => {
    if (data.dispatchedOn > await today(client)) throw badRequest("The dispatch date cannot be in the future");
    let product = data.productName;
    if (data.batchId) {
      const batch = (await client.query(
        `SELECT b.id,b.product_name,b.output_kg,b.processed_on::text AS processed_on,COALESCE((SELECT SUM(quantity_kg) FROM factory_dispatches WHERE batch_id=b.id),0) AS dispatched
         FROM factory_batches b WHERE b.id=$1::uuid AND b.organization_id=$2::uuid FOR UPDATE`, [data.batchId, organizationId])).rows[0];
      if (!batch) throw notFound("Batch not found in this factory");
      const remaining = num(batch.output_kg) - num(batch.dispatched);
      if (data.quantityKg > remaining + 1e-9) throw badRequest(`Only ${remaining.toLocaleString("en-GB")} kg of this batch remain to dispatch`);
      if (data.dispatchedOn < batch.processed_on) throw badRequest("A batch cannot be dispatched before it was processed");
      product = data.productName || batch.product_name;
    }
    return (await client.query(
      `INSERT INTO factory_dispatches(dispatch_number,organization_id,batch_id,product_name,quantity_kg,buyer_name,destination,dispatched_on,notes,recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [`DSP-${data.dispatchedOn.slice(0, 4)}-${stamp()}`, organizationId, data.batchId ?? null, product, data.quantityKg, data.buyerName,
        data.destination ?? null, data.dispatchedOn, data.notes ?? null, userId])).rows[0];
  });
}

// ---------- KCCA oversight ----------

/** City-wide factory volumes and chain-of-custody exceptions for a period (volumes only, no prices). */
export async function factoriesOverview(from: string, to: string) {
  const dateToday = await today();
  const [factories, custody] = await Promise.all([
    dbPool.query(
      `SELECT o.id,o.name,o.is_active,
         COALESCE((SELECT SUM(accepted_kg) FROM factory_intakes WHERE organization_id=o.id AND status='received' AND received_on BETWEEN $1 AND $2),0) AS accepted_kg,
         COALESCE((SELECT SUM(rejected_kg) FROM factory_intakes WHERE organization_id=o.id AND status='received' AND received_on BETWEEN $1 AND $2),0) AS rejected_kg,
         COALESCE((SELECT SUM(input_kg) FROM factory_batches WHERE organization_id=o.id AND processed_on BETWEEN $1 AND $2),0) AS input_kg,
         COALESCE((SELECT SUM(output_kg) FROM factory_batches WHERE organization_id=o.id AND processed_on BETWEEN $1 AND $2),0) AS output_kg,
         COALESCE((SELECT SUM(residue_kg) FROM factory_batches WHERE organization_id=o.id AND processed_on BETWEEN $1 AND $2),0) AS residue_kg,
         COALESCE((SELECT SUM(quantity_kg) FROM factory_dispatches WHERE organization_id=o.id AND dispatched_on BETWEEN $1 AND $2),0) AS dispatched_kg,
         COALESCE((SELECT SUM(available_kg) FROM factory_intakes WHERE organization_id=o.id AND status='received'),0) AS stock_kg,
         (SELECT p.permit_number FROM organization_permit_applications p WHERE p.organization_id=o.id AND p.permit_number IS NOT NULL
           ORDER BY (p.status IN('approved','suspended')) DESC,p.valid_until DESC NULLS LAST LIMIT 1) AS permit_number
       FROM organizations o WHERE o.type='processing_plant' ORDER BY o.name`, [from, to]),
    dbPool.query(
      `SELECT s.id AS sale_id,s.sold_on::text AS sold_on,s.quantity_kg AS sold_kg,seller.name AS seller_name,factory.name AS factory_name,l.material_type,
         (SELECT i.received_kg FROM factory_intakes i WHERE i.source_sale_id=s.id AND i.status='received') AS received_kg,
         (SELECT i.received_on::text FROM factory_intakes i WHERE i.source_sale_id=s.id AND i.status='received') AS received_on
       FROM recycling_material_sales s JOIN organizations seller ON seller.id=s.organization_id JOIN organizations factory ON factory.id=s.buyer_organization_id
       JOIN recycling_material_lots l ON l.id=s.lot_id
       WHERE s.buyer_organization_id IS NOT NULL AND s.sold_on BETWEEN $1 AND $2 ORDER BY s.sold_on,s.id`, [from, to]),
  ]);
  const deliveries = custody.rows.map(row => {
    const received = row.received_kg === null ? null : num(row.received_kg);
    return { ...row, sold_kg: num(row.sold_kg), received_kg: received, state: custodyState({ sold_kg: num(row.sold_kg), sold_on: row.sold_on, received_kg: received }, dateToday) };
  });
  const rows = factories.rows.map(row => {
    const n = Object.fromEntries(["accepted_kg", "rejected_kg", "input_kg", "output_kg", "residue_kg", "dispatched_kg", "stock_kg"].map(k => [k, num(row[k])])) as Record<string, number>;
    return { id: row.id as string, name: row.name as string, is_active: row.is_active as boolean, permit_number: row.permit_number as string | null, ...n, yield_rate: yieldRate(n.output_kg, n.input_kg) } as { id: string; name: string; is_active: boolean; permit_number: string | null; yield_rate: number | null } & Record<string, number>;
  }).filter(row => row.is_active || row.accepted_kg || row.output_kg);
  const sum = (key: string) => rows.reduce((total, row) => total + (row as any)[key], 0);
  return {
    totals: {
      factories: rows.length, accepted_kg: sum("accepted_kg"), rejected_kg: sum("rejected_kg"), input_kg: sum("input_kg"), output_kg: sum("output_kg"),
      residue_kg: sum("residue_kg"), dispatched_kg: sum("dispatched_kg"), stock_kg: sum("stock_kg"), yield_rate: yieldRate(sum("output_kg"), sum("input_kg")),
      deliveries: deliveries.length, overdue: deliveries.filter(d => d.state === "overdue").length, shortfalls: deliveries.filter(d => d.state === "shortfall").length,
    },
    factories: rows,
    custody_exceptions: deliveries.filter(d => d.state === "overdue" || d.state === "shortfall"),
  };
}
