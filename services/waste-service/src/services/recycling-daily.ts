import ExcelJS from "exceljs";
import { addGuide, addTable, KG, TableColumn } from "./workbook";

// Daily records: what happened on each day, kept apart as purchases, sales, float and sorting.

export type DailyPurchase = { id: string; date: string; material: string; supplier: string; reference: string | null; quantity_kg: number; price_ugx: number; material_cost_ugx: number; other_costs_ugx: number; total_ugx: number; payment: string };
export type DailySale = { id: string; date: string; material: string; buyer: string; invoice: string | null; delivered_kg: number; paid_kg: number; price_ugx: number; revenue_ugx: number; received_ugx: number; balance_ugx: number };
export type DailyFloat = { id: string; date: string; type: "given" | "spent" | "returned"; amount_ugx: number; balance_ugx: number; reference: string | null; linked_to: string; notes: string | null; recorded_by: string | null };
export type DailySorting = { id: string; date: string; input_material: string; output_material: string; input_kg: number; output_kg: number; rejected_kg: number; cost_ugx: number; recorded_at: string };
export type StockEvent = { at: string; material: string; kg: number };
export type SortingRow = DailySorting & { inputStockKg: number; outputStockKg: number };

/** What each material held straight after each sorting entry, replaying stock in the order it was recorded. */
export function withStockAfter(entries: DailySorting[], events: StockEvent[]): SortingRow[] {
  const time = (value: string) => Date.parse(value), stock = new Map<string, number>(), after = new Map<string, SortingRow>();
  const ordered = [...events].sort((a, b) => time(a.at) - time(b.at));
  let next = 0;
  for (const entry of [...entries].sort((a, b) => time(a.recorded_at) - time(b.recorded_at))) {
    while (next < ordered.length && time(ordered[next].at) <= time(entry.recorded_at)) {
      const event = ordered[next++];
      stock.set(event.material, (stock.get(event.material) ?? 0) + event.kg);
    }
    after.set(entry.id, { ...entry, inputStockKg: stock.get(entry.input_material) ?? 0, outputStockKg: stock.get(entry.output_material) ?? 0 });
  }
  return entries.map(entry => after.get(entry.id)!);
}

export function dayTotals(purchases: DailyPurchase[], sales: DailySale[], float: DailyFloat[], sorting: DailySorting[]) {
  const days = new Map<string, ReturnType<typeof blank>>();
  const blank = (date: string) => ({ date, purchases: 0, purchasedKg: 0, purchaseUgx: 0, sales: 0, soldKg: 0, salesUgx: 0, floatGivenUgx: 0, floatSpentUgx: 0, floatReturnedUgx: 0, sortedKg: 0, sortingWasteKg: 0 });
  const day = (date: string) => { if (!days.has(date)) days.set(date, blank(date)); return days.get(date)!; };
  for (const row of purchases) { const d = day(row.date); d.purchases += 1; d.purchasedKg += row.quantity_kg; d.purchaseUgx += row.total_ugx; }
  for (const row of sales) { const d = day(row.date); d.sales += 1; d.soldKg += row.paid_kg; d.salesUgx += row.revenue_ugx; }
  for (const row of float) { const d = day(row.date); if (row.type === "given") d.floatGivenUgx += row.amount_ugx; else if (row.type === "spent") d.floatSpentUgx += row.amount_ugx; else d.floatReturnedUgx += row.amount_ugx; }
  for (const row of sorting) { const d = day(row.date); d.sortedKg += row.output_kg; d.sortingWasteKg += row.rejected_kg; }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export type DailyActivity = { organization: string; from: string; to: string; days: ReturnType<typeof dayTotals>; purchases: DailyPurchase[]; sales: DailySale[]; float: DailyFloat[]; sorting: SortingRow[] };

const amount = (label: string, value: (row: any) => number, width = 15): TableColumn<any> => ({ label, width, format: KG, total: true, value });
const plain = (label: string, value: (row: any) => string | number | null, width = 18): TableColumn<any> => ({ label, width, value });
const rate = (label: string, value: (row: any) => number): TableColumn<any> => ({ label, width: 13, format: KG, value });

export async function buildDailyWorkbook(activity: DailyActivity) {
  const company = activity.organization.toUpperCase(), period = `from ${activity.from} to ${activity.to}`;
  const title = (name: string) => `${company} — ${name}`;
  const book = new ExcelJS.Workbook();
  book.creator = "Kampala WMS";
  addTable(book, "Day_Totals", title("DAILY TOTALS"), `Each day with activity, ${period}.`, [
    plain("Date", row => row.date, 13), amount("Purchases", row => row.purchases, 11), amount("Bought (kg)", row => row.purchasedKg, 13), amount("Purchases (UGX)", row => row.purchaseUgx), amount("Sales", row => row.sales, 9), amount("Sold (kg)", row => row.soldKg, 13), amount("Sales (UGX)", row => row.salesUgx), amount("Float Given (UGX)", row => row.floatGivenUgx), amount("Float Spent (UGX)", row => row.floatSpentUgx), amount("Float Returned (UGX)", row => row.floatReturnedUgx), amount("Sorted (kg)", row => row.sortedKg, 13), amount("Sorting Waste (kg)", row => row.sortingWasteKg, 13),
  ], activity.days);
  addTable(book, "Purchases", title("PURCHASES"), `Material bought ${period}.`, [
    plain("Date", row => row.date, 13), plain("Material", row => row.material), plain("Supplier", row => row.supplier, 26), plain("Delivery", row => row.reference), amount("Weight (kg)", row => row.quantity_kg, 13), rate("Price per kg (UGX)", row => row.price_ugx), amount("Material Cost (UGX)", row => row.material_cost_ugx), amount("Other Costs (UGX)", row => row.other_costs_ugx), amount("Total (UGX)", row => row.total_ugx), plain("Payment", row => row.payment, 12),
  ], activity.purchases);
  addTable(book, "Sales", title("SALES"), `Material sold ${period}.`, [
    plain("Date", row => row.date, 13), plain("Material", row => row.material), plain("Customer", row => row.buyer, 26), plain("Invoice", row => row.invoice), amount("Delivered (kg)", row => row.delivered_kg, 13), amount("Paid For (kg)", row => row.paid_kg, 13), rate("Price per kg (UGX)", row => row.price_ugx), amount("Revenue (UGX)", row => row.revenue_ugx), amount("Received (UGX)", row => row.received_ugx), amount("Balance (UGX)", row => row.balance_ugx),
  ], activity.sales);
  addTable(book, "Floating", title("FLOATING"), `Manager float ${period}. Balance is the float held after each entry.`, [
    plain("Date", row => row.date, 13), plain("Type", row => String(row.type).replace(/^./, c => c.toUpperCase()), 11), plain("For", row => row.linked_to, 16), plain("Reference", row => row.reference, 22), plain("Notes", row => row.notes, 34), plain("Recorded By", row => row.recorded_by, 20), { label: "Amount (UGX)", width: 15, format: KG, value: row => row.amount_ugx }, { label: "Balance (UGX)", width: 15, format: KG, value: row => row.balance_ugx },
  ], activity.float);
  addTable(book, "Sorting", title("SORTING"), `Material sorted ${period}. Stock columns show each material's balance straight after the entry was recorded.`, [
    plain("Date", row => row.date, 13), plain("From Material", row => row.input_material, 20), plain("Sorted Into", row => row.output_material, 20), amount("Taken (kg)", row => row.input_kg, 13), amount("Sorted (kg)", row => row.output_kg, 13), amount("Loss (kg)", row => row.rejected_kg, 12), amount("Cost (UGX)", row => row.cost_ugx, 13), { label: "From Material Stock After (kg)", width: 16, format: KG, value: row => row.inputStockKg }, { label: "Sorted Stock After (kg)", width: 16, format: KG, value: row => row.outputStockKg },
  ], activity.sorting);
  addGuide(book, title("EXCEL EXPORT GUIDE"), "This workbook is generated from Kampala WMS daily records.", [
    ["Day_Totals", "One row for each day with activity."],
    ["Purchases, Sales", "Each purchase and sale in the period, with totals in the last row."],
    ["Floating", "Money given to, spent by and returned by the manager, with the balance after each entry."],
    ["Sorting", "What was taken, sorted and lost, with stock after each entry."],
  ], "Dates are the business dates recorded. Stock after an entry follows the order entries were recorded, which can differ from their dates when older work was entered later.");
  return Buffer.from(await book.xlsx.writeBuffer());
}
