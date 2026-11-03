import { dbPool } from "../config/database";

// KCCA tariff schedule (migration 112): bands and their dated monthly rates. Plans that follow a band are priced from it.

const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });

export async function listTariffBands(includeInactive: boolean) {
  const bands = (await dbPool.query(`SELECT b.id,b.code,b.name,b.customer_type,b.description,b.is_active,b.sort_order,b.updated_at,
     cur.monthly_fee_ugx current_fee_ugx,cur.effective_from::text current_from,
     nxt.monthly_fee_ugx next_fee_ugx,nxt.effective_from::text next_from,
     (SELECT count(*)::int FROM service_plans sp WHERE sp.tariff_band_id=b.id AND sp.is_active) active_plans,
     (SELECT count(DISTINCT sp.organization_id)::int FROM service_plans sp WHERE sp.tariff_band_id=b.id AND sp.is_active) operators
   FROM kcca_tariff_bands b
   LEFT JOIN LATERAL kcca_tariff_rate_at(b.id,kampala_today()) cur ON cur.id IS NOT NULL
   LEFT JOIN LATERAL (SELECT * FROM kcca_tariff_rates r WHERE r.band_id=b.id AND r.effective_from>kampala_today() ORDER BY r.effective_from LIMIT 1) nxt ON true
   WHERE $1 OR b.is_active ORDER BY b.sort_order,b.name`, [includeInactive])).rows;
  return bands;
}

export async function listTariffRates(bandId: string) {
  return (await dbPool.query(`SELECT r.id,r.monthly_fee_ugx,r.effective_from::text,r.notice_reference,r.created_by_name,r.created_at,
     r.effective_from>kampala_today() scheduled,
     (SELECT count(*)::int FROM customer_invoices ci WHERE ci.tariff_rate_id=r.id) invoices
   FROM kcca_tariff_rates r WHERE r.band_id=$1::uuid ORDER BY r.effective_from DESC`, [bandId])).rows;
}

export async function createTariffBand(input: { code: string; name: string; customerType: string; description?: string; sortOrder?: number }, userId: string) {
  try {
    return (await dbPool.query(`INSERT INTO kcca_tariff_bands(code,name,customer_type,description,sort_order,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.code, input.name, input.customerType, input.description ?? null, input.sortOrder ?? 0, userId])).rows[0];
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw conflict(`A band with code ${input.code} already exists`);
    throw error;
  }
}

/** Name, description, order and whether it is offered. The code and customer type never change once plans may use the band. */
export async function updateTariffBand(id: string, input: { name: string; description?: string; sortOrder?: number; isActive: boolean }) {
  return (await dbPool.query(`UPDATE kcca_tariff_bands SET name=$2,description=$3,sort_order=$4,is_active=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid RETURNING *`,
    [id, input.name, input.description ?? null, input.sortOrder ?? 0, input.isActive])).rows[0] ?? null;
}

export async function publishTariffRate(bandId: string, input: { monthlyFeeUgx: number; effectiveFrom: string; noticeReference?: string }, userId: string) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const band = (await client.query("SELECT id,name FROM kcca_tariff_bands WHERE id=$1::uuid FOR UPDATE", [bandId])).rows[0];
    if (!band) throw Object.assign(new Error("Tariff band not found"), { statusCode: 404 });
    const today = (await client.query("SELECT kampala_today()::text d")).rows[0].d as string;
    if (input.effectiveFrom < today) throw conflict("A new rate cannot start in the past: bills already issued would no longer match it");
    const rate = (await client.query(`INSERT INTO kcca_tariff_rates(band_id,monthly_fee_ugx,effective_from,notice_reference,created_by,created_by_name)
      SELECT $1,$2,$3,$4,u.id,u.full_name FROM users u WHERE u.id=$5::uuid
      ON CONFLICT(band_id,effective_from) DO NOTHING RETURNING id,monthly_fee_ugx,effective_from::text,notice_reference`,
      [bandId, input.monthlyFeeUgx, input.effectiveFrom, input.noticeReference ?? null, userId])).rows[0];
    if (!rate) throw conflict(`${band.name} already has a rate starting ${input.effectiveFrom}`);
    await client.query("COMMIT");
    return rate;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withdrawTariffRate(bandId: string, rateId: string) {
  try {
    const deleted = await dbPool.query("DELETE FROM kcca_tariff_rates WHERE id=$1::uuid AND band_id=$2::uuid RETURNING id", [rateId, bandId]);
    return deleted.rowCount ? deleted.rows[0] : null;
  } catch (error) {
    if ((error as { code?: string }).code === "23503") throw conflict("Bills have already been issued at this rate, so it can no longer be withdrawn");
    throw error;
  }
}

/** Run daily so rates that start today show on plans. */
export async function syncTariffPlanFees() {
  return Number((await dbPool.query("SELECT sync_tariff_plan_fees() changed")).rows[0].changed);
}
