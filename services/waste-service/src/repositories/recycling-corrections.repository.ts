import { randomUUID } from "node:crypto";
import { dbPool } from "../config/database";
import { assertRecyclingBusinessDayOpen } from "../services/recycling-business-day";
import { dateOnly } from "../utils/date-only";
import { ensureMaterial, financeError, financeState, setLotAvailable, takeFromStock } from "./recycling.repository";

type Client = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });
const kg = (value: number) => Math.round(value * 1000) / 1000;
const countedKg = (value: number) => Math.round(value * 100) / 100;

/** Runs a correction in one transaction, holding the company's finance lock so balances are checked against settled figures. */
async function correction<T>(org: string, work: (c: Client) => Promise<T>) {
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recycling-finance:${org}`]);
    const result = await work(c);
    await c.query("COMMIT");
    return result;
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
const audit = (c: Client, org: string, type: string, id: string, before: unknown, after: unknown, user: string) =>
  c.query(`INSERT INTO recycling_transaction_edits(organization_id,transaction_type,transaction_id,before_state,after_state,edited_by)VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
    [org, type, id, JSON.stringify(before), JSON.stringify(after), user]);

/** A portable, organization-scoped operational backup. Authentication secrets are deliberately excluded. */
export async function createCompanyBackup(org: string) {
  const organization = (await dbPool.query(`SELECT id,name,type,is_active,address,email,phone,created_at,updated_at FROM organizations WHERE id=$1::uuid`, [org])).rows[0];
  if (!organization) throw notFound("Organization not found");
  const recyclingTables = (await dbPool.query(`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id' AND table_name LIKE 'recycling\\_%' ESCAPE '\\' ORDER BY table_name`)).rows.map((row: { table_name: string }) => row.table_name);
  const tables = [...recyclingTables, "organization_expenses", "organization_finance_settings", "organization_finance_setting_history"];
  const records: Record<string, unknown[]> = {};
  for (const table of tables) {
    const quotedTable = `"${table.replaceAll('"', '""')}"`;
    try { records[table] = (await dbPool.query(`SELECT * FROM ${quotedTable} WHERE organization_id=$1::uuid`, [org])).rows; }
    catch (error: unknown) {
      // A backup remains usable across staged deployments where an optional table has not been introduced yet.
      if ((error as { code?: string })?.code === "42P01") records[table] = [];
      else throw error;
    }
  }
  return {
    format: "kwms-recycling-company-backup",
    version: 1,
    generatedAt: new Date().toISOString(),
    security: "Passwords, access tokens and credential hashes are not included.",
    organization,
    records,
  };
}

/** Reconciles the whole physical stock count in one approval and one audit event. */
export async function reconcilePhysicalStock(org: string, user: string, d: { countDate: string; reason: string; counts: Array<{ material: string; physicalKg: number }> }) {
  return correction(org, async c => {
    const today = String((await c.query(`SELECT (now() AT TIME ZONE 'Africa/Kampala')::date::text today`)).rows[0].today);
    if (d.countDate !== today) throw financeError("A physical stock count must be approved on the day the materials are counted.");
    await assertRecyclingBusinessDayOpen(c, org, d.countDate, "approving this physical stock count");
    const lots = (await c.query(`SELECT * FROM recycling_material_lots WHERE organization_id=$1::uuid AND collected_on<=$2::date AND available_kg>0 ORDER BY lower(material_type),collected_on,created_at,id FOR UPDATE`, [org, d.countDate])).rows;
    const byMaterial = new Map<string, { material: string; lots: any[]; expectedKg: number }>();
    for (const lot of lots) {
      const key = String(lot.material_type).trim().toLowerCase();
      const current = byMaterial.get(key) ?? { material: String(lot.material_type), lots: [], expectedKg: 0 };
      current.lots.push(lot); current.expectedKg = countedKg(current.expectedKg + Number(lot.available_kg)); byMaterial.set(key, current);
    }
    const submitted = new Map(d.counts.map(line => [line.material.trim().toLowerCase(), line]));
    const missing = [...byMaterial.entries()].filter(([key]) => !submitted.has(key)).map(([, value]) => value.material);
    if (missing.length) throw financeError(`Count every material before approval. Missing: ${missing.join(", ")}.`);
    const unknown = [...submitted.keys()].filter(key => !byMaterial.has(key));
    if (unknown.length) throw financeError(`These materials have no available recorded stock: ${unknown.map(key => submitted.get(key)!.material).join(", ")}.`);

    const entryId = randomUUID();
    const differences: any[] = [];
    let shortageKg = 0, surplusKg = 0;
    for (const [key, group] of byMaterial) {
      const physicalKg = countedKg(Number(submitted.get(key)!.physicalKg));
      const differenceKg = countedKg(physicalKg - group.expectedKg);
      if (!differenceKg) continue;
      const adjustmentType = differenceKg < 0 ? "loss" : "correction_in";
      const adjustmentRows: any[] = [];
      if (differenceKg < 0) {
        const parts = await takeFromStock(c, org, { materialType: group.material }, Math.abs(differenceKg), d.countDate);
        for (const part of parts) adjustmentRows.push((await c.query(`INSERT INTO recycling_stock_adjustments(organization_id,lot_id,adjustment_date,adjustment_type,quantity_kg,reason,notes,recorded_by) VALUES($1,$2,$3,'loss',$4,$5,$6,$7) RETURNING *`, [org, part.lot.id, d.countDate, part.kg, d.reason, `Physical count ${entryId}: recorded ${group.expectedKg} kg, counted ${physicalKg} kg`, user])).rows[0]);
        shortageKg = countedKg(shortageKg + Math.abs(differenceKg));
      } else {
        const lot = group.lots[group.lots.length - 1];
        await c.query(`UPDATE recycling_material_lots SET quantity_kg=quantity_kg+$2,available_kg=available_kg+$2,status='available',updated_at=now() WHERE id=$1::uuid`, [lot.id, differenceKg]);
        adjustmentRows.push((await c.query(`INSERT INTO recycling_stock_adjustments(organization_id,lot_id,adjustment_date,adjustment_type,quantity_kg,reason,notes,recorded_by) VALUES($1,$2,$3,'correction_in',$4,$5,$6,$7) RETURNING *`, [org, lot.id, d.countDate, differenceKg, d.reason, `Physical count ${entryId}: recorded ${group.expectedKg} kg, counted ${physicalKg} kg`, user])).rows[0]);
        surplusKg = countedKg(surplusKg + differenceKg);
      }
      differences.push({ material: group.material, recordedKg: group.expectedKg, physicalKg, differenceKg, adjustmentType, adjustments: adjustmentRows });
    }
    const before = { countDate: d.countDate, counts: [...byMaterial.values()].map(group => ({ material: group.material, recordedKg: group.expectedKg })) };
    const after = { countDate: d.countDate, reason: d.reason, counts: d.counts, differences, shortageKg, surplusKg };
    await audit(c, org, "physical_stock_count", entryId, before, after, user);
    return { entryId, countDate: d.countDate, materialsCounted: d.counts.length, materialsAdjusted: differences.length, shortageKg, surplusKg, differences };
  });
}

/**
 * Moves weight from one material to another, oldest stock first. Each lot it takes from gives a new lot of the other
 * material that keeps the original cost per kg, so profit and stock value do not change.
 */
export async function transferMaterial(org: string, user: string, d: { fromMaterial: string; toMaterial: string; quantityKg: number; transferDate: string; reason: string; allowNewMaterial?: boolean }) {
  return correction(org, async c => {
    await assertRecyclingBusinessDayOpen(c, org, d.transferDate, "moving this material");
    const toMaterial = await ensureMaterial(c, org, user, d.toMaterial, Boolean(d.allowNewMaterial));
    const parts = await takeFromStock(c, org, { materialType: d.fromMaterial }, d.quantityKg, d.transferDate);
    if (parts.some(({ lot }) => String(lot.material_type).toLowerCase() === toMaterial.toLowerCase())) throw financeError("Choose two different materials.");
    const entryId = randomUUID(), moves: any[] = [];
    for (const { lot, kg: moved } of parts) {
      const created = (await c.query(`INSERT INTO recycling_material_lots(organization_id,material_type,source_name,quantity_kg,available_kg,unit_purchase_price_ugx,collected_on,quality,notes,created_by,origin,source_lot_id)
        VALUES($1,$2,$3,$4,$4,0,$5,$6,$7,$8,'transfer',$9) RETURNING id`, [org, toMaterial, `Moved from ${lot.material_type}`, moved, d.transferDate, lot.quality ?? "sorted", d.reason, user, lot.id])).rows[0];
      moves.push((await c.query(`INSERT INTO recycling_material_transfers(organization_id,entry_id,from_lot_id,to_lot_id,from_material,to_material,quantity_kg,transfer_date,reason,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [org, entryId, lot.id, created.id, lot.material_type, toMaterial, moved, d.transferDate, d.reason, user])).rows[0]);
    }
    const fromMaterial = parts[0].lot.material_type;
    await audit(c, org, "material_transfer", entryId, { material: fromMaterial, quantityKg: d.quantityKg }, { material: toMaterial, quantityKg: d.quantityKg, transferDate: d.transferDate, reason: d.reason, moves }, user);
    return { entryId, fromMaterial, toMaterial, quantityKg: d.quantityKg };
  });
}

/** Undoes a material move while the moved stock is untouched: the weight goes back and the new stock is removed. */
export async function reverseMaterialTransfer(org: string, user: string, entryId: string, reason: string) {
  return correction(org, async c => {
    const moves = (await c.query(`SELECT * FROM recycling_material_transfers WHERE organization_id=$1::uuid AND entry_id=$2::uuid ORDER BY from_lot_id FOR UPDATE`, [org, entryId])).rows;
    if (!moves.length) throw notFound("Material move not found");
    await assertRecyclingBusinessDayOpen(c, org, dateOnly(moves[0].transfer_date), "this material move can be undone");
    const created = moves.map(m => m.to_lot_id);
    const lots = (await c.query(`SELECT * FROM recycling_material_lots WHERE organization_id=$1::uuid AND id=ANY($2::uuid[]) FOR UPDATE`, [org, created])).rows;
    const used = lots.some(l => Number(l.available_kg) !== Number(l.quantity_kg)) || (await c.query(`SELECT 1 FROM recycling_material_sales WHERE lot_id=ANY($1::uuid[]) UNION ALL SELECT 1 FROM recycling_sale_lots WHERE lot_id=ANY($1::uuid[]) UNION ALL SELECT 1 FROM recycling_stock_adjustments WHERE lot_id=ANY($1::uuid[]) UNION ALL SELECT 1 FROM recycling_sorting_batches WHERE input_lot_id=ANY($1::uuid[]) UNION ALL SELECT 1 FROM recycling_material_transfers WHERE from_lot_id=ANY($1::uuid[]) LIMIT 1`, [created])).rowCount;
    if (used) throw financeError(`Some of the moved ${moves[0].to_material} has already been sold, sorted, moved or adjusted. Undo those records first.`);
    for (const m of moves) {
      const lot = (await c.query(`SELECT available_kg FROM recycling_material_lots WHERE id=$1::uuid FOR UPDATE`, [m.from_lot_id])).rows[0];
      await setLotAvailable(c, m.from_lot_id, kg(Number(lot.available_kg) + Number(m.quantity_kg)));
    }
    await c.query(`DELETE FROM recycling_material_transfers WHERE organization_id=$1::uuid AND entry_id=$2::uuid`, [org, entryId]);
    await c.query(`DELETE FROM recycling_material_lots WHERE id=ANY($1::uuid[])`, [created]);
    const quantityKg = kg(moves.reduce((n, m) => n + Number(m.quantity_kg), 0));
    await audit(c, org, "material_transfer_reversal", entryId, { material: moves[0].to_material, quantityKg, moves }, { material: moves[0].from_material, quantityKg, reason }, user);
    return { entryId, fromMaterial: moves[0].from_material, toMaterial: moves[0].to_material, quantityKg };
  });
}

/**
 * Cash reconciliation: brings office cash or the manager float to what was actually counted, up or down. Office cash
 * moves through a correction cash movement. The float moves through a hand-over between office and float plus a
 * matching correction cash movement, so office cash is unchanged. Neither changes profit.
 */
export async function reconcileCash(org: string, user: string, d: { account: "office" | "float"; direction: "add" | "reduce"; amountUgx: number; correctionDate: string; reason: string }) {
  return correction(org, async c => {
    await assertRecyclingBusinessDayOpen(c, org, d.correctionDate, "recording this cash reconciliation");
    const state = await financeState(c, org);
    if (!state.configured) throw financeError("Set the verified opening balance before reconciling cash.");
    const balance = d.account === "office" ? state.officeCash : state.floatBalance, add = d.direction === "add";
    if (!add && d.amountUgx > balance) throw financeError(`Only UGX ${Math.max(balance, 0).toLocaleString("en-GB")} is in ${d.account === "office" ? "office cash" : "the manager float"}.`);
    const id = randomUUID(), reference = `CORR-${id.slice(0, 8).toUpperCase()}`, note = `${d.account === "office" ? "Office cash" : "Manager float"} reconciliation: ${d.reason}`;
    let floatEntry = null;
    if (d.account === "float") floatEntry = (await c.query(`INSERT INTO recycling_manager_float_transactions(organization_id,transaction_date,transaction_type,amount_ugx,reference,notes,recorded_by)VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [org, d.correctionDate, add ? "given" : "returned", d.amountUgx, reference, note, user])).rows[0];
    const cash = (await c.query(`INSERT INTO recycling_cash_movements(organization_id,movement_date,direction,category,amount_ugx,reference,notes,recorded_by)VALUES($1,$2,$3,'correction',$4,$5,$6,$7) RETURNING *`, [org, d.correctionDate, add ? "in" : "out", d.amountUgx, reference, note, user])).rows[0];
    const after = balance + (add ? d.amountUgx : -d.amountUgx);
    await audit(c, org, "cash_correction", id, { account: d.account, balanceUgx: balance }, { account: d.account, direction: d.direction, balanceUgx: after, amountUgx: d.amountUgx, correctionDate: d.correctionDate, reference, reason: d.reason, cashMovement: cash, floatEntry }, user);
    return { reference, account: d.account, direction: d.direction, amountUgx: d.amountUgx, balanceUgx: after };
  });
}

/** Expenses, float entries and cash movements an administrator can cancel. Entries that belong to a purchase, sale, sorting, loan or investor are fixed there instead. */
export async function cancellableEntries(org: string) {
  const [expenses, float, cash] = await Promise.all([
    dbPool.query(`SELECT id,expense_number reference,expense_date::text date,description,category,amount_ugx::bigint amount_ugx,status FROM organization_expenses WHERE organization_id=$1::uuid AND status<>'void' ORDER BY expense_date DESC,created_at DESC LIMIT 200`, [org]),
    dbPool.query(`SELECT id,reference,transaction_date::text date,transaction_type,notes description,amount_ugx::bigint amount_ugx FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND purchase_lot_id IS NULL AND sale_id IS NULL AND sorting_batch_id IS NULL AND expense_batch_reference IS NULL ORDER BY transaction_date DESC,created_at DESC LIMIT 200`, [org]),
    dbPool.query(`SELECT m.id,m.reference,m.movement_date::text date,m.direction,m.category,COALESCE(m.notes,m.counterparty) description,m.amount_ugx::bigint amount_ugx FROM recycling_cash_movements m WHERE m.organization_id=$1::uuid AND m.loan_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM recycling_investor_transactions i WHERE i.cash_movement_id=m.id OR i.reversal_cash_movement_id=m.id) ORDER BY m.movement_date DESC,m.created_at DESC LIMIT 200`, [org]),
  ]);
  return { expenses: expenses.rows, float: float.rows, cash: cash.rows };
}

/**
 * Cancels a wrong money entry so it stops counting. The entry is removed (an expense is marked void) and a full copy
 * stays in the corrections history with the reason. Refused when cancelling would leave office cash or the float negative.
 */
export async function cancelEntry(org: string, user: string, d: { entryType: "expense" | "float" | "cash"; id: string; reason: string }) {
  return correction(org, async c => {
    const state = await financeState(c, org);
    const needs = (office: number, float: number) => {
      if (state.officeCash + office < 0) throw financeError(`Cancelling this would leave office cash below zero (UGX ${state.officeCash.toLocaleString("en-GB")} is held).`);
      if (state.floatBalance + float < 0) throw financeError(`Cancelling this would leave the manager float below zero (UGX ${state.floatBalance.toLocaleString("en-GB")} is held).`);
    };
    let before: any, label: string, amount: number;
    const table = d.entryType === "float" ? "recycling_manager_float_transactions" : "recycling_cash_movements";
    const picked = d.entryType === "expense" ? null : (await c.query(`SELECT reference FROM ${table} WHERE id=$1::uuid AND organization_id=$2::uuid`, [d.id, org])).rows[0];
    if (picked && /^CORR-/.test(picked.reference)) {
      // A cash correction is undone as a whole: for the float that is both the hand-back and the cash-out.
      const float = (await c.query(`SELECT * FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND reference=$2 FOR UPDATE`, [org, picked.reference])).rows;
      const cash = (await c.query(`SELECT * FROM recycling_cash_movements WHERE organization_id=$1::uuid AND reference=$2 FOR UPDATE`, [org, picked.reference])).rows;
      for (const row of [...float.map(r => r.transaction_date), ...cash.map(r => r.movement_date)]) await assertRecyclingBusinessDayOpen(c, org, dateOnly(row), "undoing this cash correction");
      await c.query(`DELETE FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND reference=$2`, [org, picked.reference]);
      await c.query(`DELETE FROM recycling_cash_movements WHERE organization_id=$1::uuid AND reference=$2`, [org, picked.reference]);
      amount = Number(cash[0]?.amount_ugx ?? float[0]?.amount_ugx ?? 0);
      // Removing the entries reverses their effect on each balance.
      const officeEffect = cash.reduce((n, r) => n + (r.direction === "in" ? -1 : 1) * Number(r.amount_ugx), 0) + float.reduce((n, r) => n + (r.transaction_type === "given" ? 1 : r.transaction_type === "returned" ? -1 : 0) * Number(r.amount_ugx), 0);
      const floatEffect = float.reduce((n, r) => n + (r.transaction_type === "given" ? -1 : 1) * Number(r.amount_ugx), 0);
      needs(officeEffect, floatEffect);
      before = { entries: { float, cash } };
      label = `Cash reconciliation ${picked.reference}`;
    } else if (d.entryType === "expense") {
      const row = (await c.query(`SELECT * FROM organization_expenses WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`, [d.id, org])).rows[0];
      if (!row || row.status === "void") throw notFound("Expense not found or already cancelled");
      await assertRecyclingBusinessDayOpen(c, org, dateOnly(row.expense_date), "cancelling this expense");
      amount = Number(row.amount_ugx);
      // A daily expense paid from the float has one float entry for the whole day's batch; this expense's share comes off it.
      const floatRow = row.reference ? (await c.query(`SELECT * FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND expense_batch_reference=$2 FOR UPDATE`, [org, row.reference])).rows[0] : null;
      if (floatRow) {
        const left = Number(floatRow.amount_ugx) - amount;
        if (left > 0) await c.query(`UPDATE recycling_manager_float_transactions SET amount_ugx=$2 WHERE id=$1::uuid`, [floatRow.id, left]);
        else await c.query(`DELETE FROM recycling_manager_float_transactions WHERE id=$1::uuid`, [floatRow.id]);
      }
      await c.query(`UPDATE organization_expenses SET status='void',updated_at=now() WHERE id=$1::uuid`, [row.id]);
      before = { entry: row, floatEntry: floatRow };
      label = `Expense ${row.expense_number}: ${row.description}`;
    } else if (d.entryType === "float") {
      const row = (await c.query(`SELECT * FROM recycling_manager_float_transactions WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`, [d.id, org])).rows[0];
      if (!row) throw notFound("Float entry not found");
      if (row.purchase_lot_id || row.sale_id || row.sorting_batch_id || row.expense_batch_reference) throw financeError("This float entry belongs to a purchase, sale, sorting or expense. Correct that record instead.");
      await assertRecyclingBusinessDayOpen(c, org, dateOnly(row.transaction_date), "cancelling this float entry");
      amount = Number(row.amount_ugx);
      // Cash given to the manager goes back to the office; a return goes back to the manager; spending comes back to both.
      if (row.transaction_type === "given") needs(amount, -amount);
      else if (row.transaction_type === "returned") needs(-amount, amount);
      await c.query(`DELETE FROM recycling_manager_float_transactions WHERE id=$1::uuid`, [row.id]);
      before = { entry: row };
      label = `Float ${row.transaction_type}: ${row.reference}`;
    } else {
      const row = (await c.query(`SELECT * FROM recycling_cash_movements WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`, [d.id, org])).rows[0];
      if (!row) throw notFound("Cash movement not found");
      if (row.loan_id || (await c.query(`SELECT 1 FROM recycling_investor_transactions WHERE cash_movement_id=$1::uuid OR reversal_cash_movement_id=$1::uuid`, [row.id])).rowCount) throw financeError("This cash movement belongs to a loan or an investor entry. Correct it there instead.");
      await assertRecyclingBusinessDayOpen(c, org, dateOnly(row.movement_date), "cancelling this cash movement");
      amount = Number(row.amount_ugx);
      if (row.direction === "in") needs(-amount, 0);
      await c.query(`DELETE FROM recycling_cash_movements WHERE id=$1::uuid`, [row.id]);
      before = { entry: row };
      label = `Cash ${row.direction === "in" ? "in" : "out"}: ${row.reference}`;
    }
    await audit(c, org, "entry_cancelled", d.id, { entryType: d.entryType, label, amountUgx: amount, ...before }, { cancelled: true, reason: d.reason }, user);
    return { entryType: d.entryType, label, amountUgx: amount };
  });
}
