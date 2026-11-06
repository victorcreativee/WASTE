import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { buildInvestorReport, reportingMonths, shareOut, withRunningBalance } from "../services/investor-report";
import { notifyOrganization, notifyUser } from "../services/notify";
import { companyReportRecords } from "./company-report.repository";
import { configuredOfficeCash, financeError, financeState } from "./recycling.repository";

const n = (value: unknown) => Number(value || 0);
const MONTHS = 12;
const INVESTORS = `SELECT i.*,u.full_name account_name,u.email account_email,
  COALESCE(SUM(t.amount_ugx) FILTER (WHERE t.transaction_type='investment'),0)::bigint invested_ugx,
  COALESCE(SUM(t.amount_ugx) FILTER (WHERE t.transaction_type='payout'),0)::bigint paid_out_ugx
 FROM recycling_investors i LEFT JOIN users u ON u.id=i.user_id LEFT JOIN recycling_investor_transactions t ON t.investor_id=i.id AND t.reversed_at IS NULL
 WHERE i.organization_id=$1::uuid`;
const UPDATES = `SELECT p.id,p.title,p.body,p.created_at,u.full_name posted_by_name FROM recycling_investor_updates p LEFT JOIN users u ON u.id=p.posted_by WHERE p.organization_id=$1::uuid ORDER BY p.created_at DESC`;
const TRANSACTIONS = `SELECT t.id,t.investor_id,i.display_name,t.transaction_type,t.amount_ugx,t.transaction_date::text,t.reference,t.notes,t.cash_movement_id IS NOT NULL moved_cash,t.reversed_at,t.reversal_reason FROM recycling_investor_transactions t JOIN recycling_investors i ON i.id=t.investor_id WHERE t.organization_id=$1::uuid`;

const LINK = "/dashboard/investor";
/** Notifications are emailed from this severity up. Investors seldom sign in, so what concerns them should reach their inbox. */
const EMAILED = "warning";
const money = (amount: number | string) => `UGX ${Number(amount).toLocaleString("en-GB")}`;
const companyName = async (c: PoolClient, org: string) => (await c.query(`SELECT name FROM organizations WHERE id=$1::uuid`, [org])).rows[0].name as string;

const duplicateReference = (error: any) => error?.code === "23505" ? financeError("That reference is already used. Enter another one.") : error;

/** The investor page. `userId` limits it to that investor's own position; without it every investor is listed. */
export async function investorOverview(org: string, userId: string | null) {
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { type, today } = (await c.query(`SELECT type,(now() AT TIME ZONE 'Africa/Kampala')::date::text today FROM organizations WHERE id=$1::uuid`, [org])).rows[0] ?? {};
    if (type !== "recycling_company") throw Object.assign(new Error("The investor page belongs to recycling companies"), { statusCode: 403 });
    const records = await companyReportRecords(c, org, reportingMonths(today, MONTHS)[0].from, today);
    const loansOwedUgx = n((await c.query(`SELECT COALESCE(SUM(l.amount_ugx),0)-COALESCE((SELECT SUM(amount_ugx) FROM recycling_cash_movements WHERE organization_id=$1::uuid AND category='loan_repayment'),0) owed FROM recycling_loans l WHERE l.organization_id=$1::uuid`, [org])).rows[0].owed);
    const report = buildInvestorReport(records, { cashUgx: (await financeState(c, org)).cash, loansOwedUgx }, today, MONTHS);
    const investors = (await c.query(`${INVESTORS} AND i.active ${userId ? "AND i.user_id=$2::uuid" : ""} GROUP BY i.id,u.id ORDER BY i.display_name`, userId ? [org, userId] : [org])).rows;
    const transactions = userId && investors[0] ? (await c.query(`${TRANSACTIONS} AND t.investor_id=$2::uuid ORDER BY t.transaction_date DESC,t.created_at DESC`, [org, investors[0].id])).rows : [];
    const updates = (await c.query(UPDATES, [org])).rows;
    await c.query("COMMIT");
    const shares = investors.map(investor => {
      const invested = n(investor.invested_ugx), paidOut = n(investor.paid_out_ugx), share = investor.share_percent === null ? null : n(investor.share_percent);
      return { id: investor.id, name: investor.display_name, sharePercent: share, investedUgx: invested, paidOutUgx: paidOut, stillInvestedUgx: invested - paidOut, paidBackPercent: invested ? Math.round((paidOut / invested) * 1000) / 10 : null, estimatedValueUgx: share === null ? null : Math.round((report.position.netPositionUgx * share) / 100) };
    });
    return { ...report, updates, investors: shares, transactions: withRunningBalance(transactions).map(({ notes: _notes, reversal_reason: _reason, ...row }) => row) };
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}

export async function investorManagement(org: string) {
  const [investors, transactions, updates, accounts] = await Promise.all([
    dbPool.query(`${INVESTORS} GROUP BY i.id,u.id ORDER BY i.active DESC,i.display_name`, [org]),
    dbPool.query(`${TRANSACTIONS} ORDER BY t.transaction_date DESC,t.created_at DESC`, [org]),
    dbPool.query(UPDATES, [org]),
    dbPool.query(`SELECT u.id,u.full_name,u.email FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.organization_id=$1::uuid AND u.status='active' AND r.name='company_investor' ORDER BY u.full_name`, [org]),
  ]);
  return { investors: investors.rows, transactions: withRunningBalance(transactions.rows), updates: updates.rows, accounts: accounts.rows };
}

async function assertSharesFit(c: PoolClient, org: string, share: number | undefined, exceptId: string | null) {
  if (share === undefined) return;
  const others = n((await c.query(`SELECT COALESCE(SUM(share_percent),0) total FROM recycling_investors WHERE organization_id=$1::uuid AND active AND id IS DISTINCT FROM $2::uuid`, [org, exceptId])).rows[0].total);
  if (others + share > 100) throw financeError(`Other investors already hold ${others}%, so this share cannot be more than ${Math.max(100 - others, 0)}%.`);
}

async function assertInvestorAccount(c: PoolClient, org: string, userId: string | undefined) {
  if (userId && !(await c.query(`SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id=$1::uuid AND u.organization_id=$2::uuid AND r.name='company_investor'`, [userId, org])).rowCount)
    throw Object.assign(new Error("Choose an investor account from this company"), { statusCode: 400 });
}
const linkedAlready = (error: any) => error?.code === "23505" ? financeError("That account is already linked to another investor.") : error;

export async function createInvestor(org: string, user: string, d: any) {
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recycling-finance:${org}`]);
    await assertSharesFit(c, org, d.sharePercent, null);
    await assertInvestorAccount(c, org, d.userId);
    const row = (await c.query(`INSERT INTO recycling_investors(organization_id,user_id,display_name,share_percent,notes,created_by)VALUES($1,$2,$3,$4,$5,$6)RETURNING *`, [org, d.userId ?? null, d.displayName, d.sharePercent ?? null, d.notes ?? null, user])).rows[0];
    await c.query("COMMIT");
    return row;
  } catch (error) { await c.query("ROLLBACK"); throw linkedAlready(error); } finally { c.release(); }
}

export async function updateInvestor(org: string, id: string, d: any) {
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recycling-finance:${org}`]);
    if (d.active) await assertSharesFit(c, org, d.sharePercent, id);
    await assertInvestorAccount(c, org, d.userId);
    const row = (await c.query(`UPDATE recycling_investors SET user_id=$3,display_name=$4,share_percent=$5,notes=$6,active=$7,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [id, org, d.userId ?? null, d.displayName, d.sharePercent ?? null, d.notes ?? null, d.active])).rows[0] ?? null;
    await c.query("COMMIT");
    return row;
  } catch (error) { await c.query("ROLLBACK"); throw linkedAlready(error); } finally { c.release(); }
}

async function assertCashCovers(c: PoolClient, org: string, amountUgx: number, what: string) {
  const officeCash = await configuredOfficeCash(c, org);
  if (amountUgx > officeCash) throw financeError(`${what} is ${money(amountUgx)} but only ${money(Math.max(officeCash, 0))} is in office cash.`);
}

type Entry = { transactionType: "investment" | "payout"; amountUgx: number; transactionDate: string; reference: string; movesCash: boolean; notes?: string };

/** Writes one entry and its cash movement, and tells a linked investor about money that moved now. */
async function addEntry(c: PoolClient, org: string, user: string, company: string, investor: { id: string; display_name: string; user_id: string | null }, d: Entry) {
  const investing = d.transactionType === "investment";
  const cashMovementId = d.movesCash ? (await c.query(`INSERT INTO recycling_cash_movements(organization_id,movement_date,direction,category,amount_ugx,reference,counterparty,notes,recorded_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING id`, [org, d.transactionDate, investing ? "in" : "out", investing ? "capital_contribution" : "owner_withdrawal", d.amountUgx, d.reference, investor.display_name, d.notes || `${investing ? "Investment by" : "Payout to"} ${investor.display_name}`, user])).rows[0].id : null;
  const row = (await c.query(`INSERT INTO recycling_investor_transactions(organization_id,investor_id,transaction_type,amount_ugx,transaction_date,reference,notes,cash_movement_id,recorded_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING *`, [org, investor.id, d.transactionType, d.amountUgx, d.transactionDate, d.reference, d.notes ?? null, cashMovementId, user])).rows[0];
  if (d.movesCash && investor.user_id) await notifyUser(c, investor.user_id, org, { category: "billing", severity: EMAILED, title: `${company}: ${investing ? "investment received" : "payout made"}`, body: `${money(d.amountUgx)} ${investing ? "received from you" : "paid to you"} on ${d.transactionDate}. Reference ${d.reference}.`, link: LINK, dedupeKey: `investor-entry:${row.id}` });
  return row;
}

/** Records money an investor put in or took out, moving office cash unless the money is already counted. */
export async function recordInvestorTransaction(org: string, user: string, investorId: string, d: Entry) {
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recycling-finance:${org}`]);
    const investor = (await c.query(`SELECT id,display_name,user_id FROM recycling_investors WHERE id=$1::uuid AND organization_id=$2::uuid AND active`, [investorId, org])).rows[0];
    if (!investor) { await c.query("ROLLBACK"); return null; }
    if (d.movesCash && d.transactionType === "payout") await assertCashCovers(c, org, d.amountUgx, "The payout");
    const row = await addEntry(c, org, user, await companyName(c, org), investor, d);
    await c.query("COMMIT");
    return row;
  } catch (error) { await c.query("ROLLBACK"); throw duplicateReference(error); } finally { c.release(); }
}

/** Pays an amount shared across the whole company: each active investor gets their share of it, as one entry each. */
export async function distributeToInvestors(org: string, user: string, d: Omit<Entry, "transactionType" | "amountUgx"> & { totalUgx: number }) {
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recycling-finance:${org}`]);
    const investors = (await c.query(`SELECT id,display_name,user_id,share_percent FROM recycling_investors WHERE organization_id=$1::uuid AND active AND share_percent>0 ORDER BY display_name`, [org])).rows;
    const parts = shareOut(d.totalUgx, investors), paidUgx = parts.reduce((sum, part) => sum + part.amountUgx, 0);
    if (!parts.length) throw financeError("No investor has a share to pay. Set their shares first.");
    if (d.movesCash) await assertCashCovers(c, org, paidUgx, "The payout");
    const company = await companyName(c, org);
    for (const [index, part] of parts.entries()) await addEntry(c, org, user, company, part.investor, { ...d, transactionType: "payout", amountUgx: part.amountUgx, reference: `${d.reference}/${index + 1}` });
    await c.query("COMMIT");
    return { investors: parts.length, paidUgx };
  } catch (error) { await c.query("ROLLBACK"); throw duplicateReference(error); } finally { c.release(); }
}

/** Cancels an entry made by mistake. It stays on the record, and any cash it moved goes back today. */
export async function reverseInvestorTransaction(org: string, user: string, id: string, reason: string) {
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recycling-finance:${org}`]);
    const entry = (await c.query(`SELECT t.*,i.display_name,i.user_id,(now() AT TIME ZONE 'Africa/Kampala')::date::text today FROM recycling_investor_transactions t JOIN recycling_investors i ON i.id=t.investor_id WHERE t.id=$1::uuid AND t.organization_id=$2::uuid`, [id, org])).rows[0];
    if (!entry) { await c.query("ROLLBACK"); return null; }
    if (entry.reversed_at) throw financeError("This entry is already cancelled.");
    const investment = entry.transaction_type === "investment", amount = n(entry.amount_ugx);
    let movementId: string | null = null;
    if (entry.cash_movement_id) {
      if (investment) await assertCashCovers(c, org, amount, "Returning this investment");
      movementId = (await c.query(`INSERT INTO recycling_cash_movements(organization_id,movement_date,direction,category,amount_ugx,reference,counterparty,notes,recorded_by)VALUES($1,$2,$3,'correction',$4,$5,$6,$7,$8)RETURNING id`, [org, entry.today, investment ? "out" : "in", amount, `${entry.reference} cancelled`, entry.display_name, `Cancelled ${entry.reference}: ${reason}`, user])).rows[0].id;
    }
    const row = (await c.query(`UPDATE recycling_investor_transactions SET reversed_at=now(),reversed_by=$3,reversal_reason=$4,reversal_cash_movement_id=$5 WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [id, org, user, reason, movementId])).rows[0];
    if (entry.user_id) await notifyUser(c, entry.user_id, org, { category: "billing", severity: EMAILED, title: `${await companyName(c, org)}: investment record corrected`, body: `The ${entry.transaction_type} of ${money(amount)} (reference ${entry.reference}) was cancelled and no longer counts towards your position.`, link: LINK, dedupeKey: `investor-entry-cancelled:${id}` });
    await c.query("COMMIT");
    return row;
  } catch (error) { await c.query("ROLLBACK"); throw duplicateReference(error); } finally { c.release(); }
}

/** Posts an update and tells the company's investors and owner, in the app and by their chosen channels. */
export async function createInvestorUpdate(org: string, user: string, d: { title: string; body: string }) {
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN");
    const row = (await c.query(`INSERT INTO recycling_investor_updates(organization_id,title,body,posted_by)VALUES($1,$2,$3,$4)RETURNING *`, [org, d.title, d.body, user])).rows[0];
    await notifyOrganization(c, org, ["company_investor", "company_owner"], { category: "system", severity: EMAILED, title: `${await companyName(c, org)}: ${d.title}`.slice(0, 200), body: d.body.length > 300 ? `${d.body.slice(0, 299)}…` : d.body, link: LINK, dedupeKey: `investor-update:${row.id}` });
    await c.query("COMMIT");
    return row;
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}

export const deleteInvestorUpdate = async (org: string, id: string) =>
  Boolean((await dbPool.query(`DELETE FROM recycling_investor_updates WHERE id=$1::uuid AND organization_id=$2::uuid`, [id, org])).rowCount);
