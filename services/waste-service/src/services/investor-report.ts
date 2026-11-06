import { buildCompanyReport, type CompanyReportRecords } from "./company-report";

const n = (value: unknown) => Number(value || 0);
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/** The last `count` calendar months ending with the month of `today`, oldest first. The newest ends today. */
export function reportingMonths(today: string, count: number) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const from = start.toISOString().slice(0, 10), last = end.toISOString().slice(0, 10);
    return { month: from.slice(0, 7), from, to: last > today ? today : last };
  });
}

/** How much of the total the biggest names hold, without saying who they are. */
function concentration(partners: { valueUgx: number }[]) {
  const total = partners.reduce((sum, partner) => sum + partner.valueUgx, 0);
  const top = (count: number) => partners.slice(0, count).reduce((sum, partner) => sum + partner.valueUgx, 0);
  return { count: partners.length, largestPercent: percent(top(1), total), topThreePercent: percent(top(3), total) };
}

export type InvestorPosition = { cashUgx: number; loansOwedUgx: number };

/**
 * What an investor reads: monthly results, what the company owns and owes, and how concentrated its trade is.
 * It never carries a buyer's, supplier's or staff member's name.
 */
export function buildInvestorReport(records: CompanyReportRecords, position: InvestorPosition, today: string, monthCount = 12) {
  const periods = reportingMonths(today, monthCount);
  const months = periods.map(({ month, from, to }) => {
    const { summary, sales } = buildCompanyReport(records, from, to);
    return {
      month, revenueUgx: summary.revenueUgx, grossProfitUgx: summary.grossProfitUgx, operatingProfitUgx: Math.round(summary.operatingProfitUgx),
      marginPercent: Math.round(summary.marginPercent * 10) / 10, purchasedKg: summary.purchasedKg, soldKg: summary.soldKg,
      deliveredKg: sales.reduce((sum, sale) => sum + n(sale.delivered_kg ?? sale.quantity_kg), 0),
      sortingWasteKg: records.sorting.filter(row => row.processed_on >= from && row.processed_on <= to).reduce((sum, row) => sum + n(row.rejected_kg), 0),
    };
  });
  const whole = buildCompanyReport(records, periods[0].from, today);
  const total = (key: keyof (typeof months)[number]) => months.reduce((sum, row) => sum + Number(row[key]), 0);

  // A month still running would always look like a fall, so growth compares the last two finished months.
  const [previous, latest] = months.slice(-3, -1);
  const growthPercent = previous?.revenueUgx ? Math.round(((latest.revenueUgx - previous.revenueUgx) / previous.revenueUgx) * 1000) / 10 : null;

  const materials = new Map<string, { material: string; revenueUgx: number; soldKg: number }>();
  for (const sale of whole.sales) {
    const item = materials.get(String(sale.material_type)) ?? { material: String(sale.material_type), revenueUgx: 0, soldKg: 0 };
    item.revenueUgx += sale.revenueUgx; item.soldKg += n(sale.quantity_kg);
    materials.set(item.material, item);
  }

  const { stockKg, stockValueUgx, receivablesUgx, payablesUgx } = whole.summary;
  const stockValue = Math.round(stockValueUgx), owned = position.cashUgx + stockValue + receivablesUgx, owed = payablesUgx + position.loansOwedUgx;
  const collectedKg = total("purchasedKg"), deliveredKg = total("deliveredKg"), soldKg = total("soldKg");
  return {
    organization: { name: records.organization.name }, generatedAt: new Date().toISOString(), range: { from: periods[0].from, to: today },
    basis: "Figures come from the company's own records and have not been audited. Operating profit is an estimate before tax: sales less the cost of material sold, selling costs, operating expenses and stock losses. Stock is valued at cost.",
    warnings: whole.warnings,
    totals: { revenueUgx: total("revenueUgx"), grossProfitUgx: total("grossProfitUgx"), operatingProfitUgx: total("operatingProfitUgx"), marginPercent: percent(total("operatingProfitUgx"), total("revenueUgx")) },
    growth: { percent: growthPercent, month: latest?.month ?? null, previousMonth: previous?.month ?? null },
    months,
    position: { cashUgx: position.cashUgx, stockValueUgx: stockValue, stockKg, receivablesUgx, payablesUgx, loansOwedUgx: position.loansOwedUgx, ownedUgx: owned, owedUgx: owed, netPositionUgx: owned - owed },
    buyers: concentration(whole.buyers), suppliers: concentration(whole.suppliers),
    materials: [...materials.values()].sort((a, b) => b.revenueUgx - a.revenueUgx).map(item => ({ ...item, revenuePercent: percent(item.revenueUgx, total("revenueUgx")) })),
    impact: { collectedKg, deliveredKg, soldKg, sortingWasteKg: total("sortingWasteKg"), refusedByBuyersKg: Math.max(deliveredKg - soldKg, 0) },
  };
}

/** Each investor's part of an amount shared across the whole company. Parts round down, and anyone due nothing is left out. */
export function shareOut<T extends { share_percent: string | number | null }>(totalUgx: number, investors: T[]) {
  return investors
    .map(investor => ({ investor, amountUgx: Math.floor((totalUgx * Math.round(Number(investor.share_percent ?? 0) * 100)) / 10000) }))
    .filter(part => part.amountUgx > 0);
}

/** Adds what each investor still had invested after each entry. Takes and returns newest first; cancelled entries change nothing. */
export function withRunningBalance<T extends { investor_id: string; transaction_type: string; amount_ugx: string | number; reversed_at: unknown }>(newestFirst: T[]) {
  const balances = new Map<string, number>();
  return [...newestFirst].reverse().map(row => {
    const change = row.reversed_at ? 0 : (row.transaction_type === "investment" ? 1 : -1) * Number(row.amount_ugx);
    const balanceUgx = (balances.get(row.investor_id) ?? 0) + change;
    balances.set(row.investor_id, balanceUgx);
    return { ...row, balanceUgx };
  }).reverse();
}
