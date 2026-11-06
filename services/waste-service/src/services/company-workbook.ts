import ExcelJS from "exceljs";
import { buildCompanyReport, CompanyReportRecords } from "./company-report";
import { addBreakdown, addGuide, addRow, addSection, addSheet, addTable, COLOR, KG, PERCENT, TableColumn } from "./workbook";

// A recycling company's report as an Excel workbook, in the same look as the weighbridge workbook. It only lays out what
// buildCompanyReport calculated, so the file always agrees with the report on screen.

type Report = ReturnType<typeof buildCompanyReport>;
type Row = Record<string, any>;
export type LoanRow = { lender_name: string; received_on: string; due_on: string | null; reference: string; amount_ugx: number; repaid_ugx: number };
export type CashRow = { movement_date: string; direction: string; category: string; amount_ugx: number; reference: string; counterparty: string | null; notes: string };

const n = (value: unknown) => Number(value || 0);
const words = (value: string) => { const text = value.replace(/_/g, " "); return text.charAt(0).toUpperCase() + text.slice(1); };
const money = (label: string, value: (row: any) => unknown, width = 16): TableColumn<any> => ({ label, width, format: KG, total: true, value: row => n(value(row)) });
const text = (label: string, value: (row: any) => string | null | undefined, width = 18): TableColumn<any> => ({ label, width, value });

function addSummary(book: ExcelJS.Workbook, company: string, report: Report) {
  const s = report.summary, { from, to } = report.range, revenue = s.revenueUgx;
  const sheet = addSheet(book, "Summary", [34, 14, 20, 18, 16], `${company} — COMPANY REPORT`, `Calculated from company records between ${from} and ${to}. Balances are as of ${to}; stock is as it stands today.`, 3);
  let row = 4;
  for (const warning of report.warnings) {
    sheet.mergeCells(row, 1, row, 5);
    addRow(sheet, row, [warning], { 1: { tint: COLOR.note } }, false);
    row += 1;
  }
  const lines = (title: string, values: [string, number, string?][]) => {
    row = addSection(sheet, row, title);
    values.forEach(([label, value, format], index) => {
      addRow(sheet, row, [label, "", "", value], { 4: { format: format ?? KG } }, index % 2 === 1);
      row += 1;
    });
    row += 1;
  };
  lines("PROFIT (UGX)", [["Sales", revenue], ["Cost of material sold", s.costOfGoodsUgx], ["Gross profit", s.grossProfitUgx], ["Selling costs", s.sellingCostsUgx], ["Operating expenses", s.operatingExpensesUgx], ["Stock losses", s.stockLossUgx], ["Operating profit", s.operatingProfitUgx], ["Operating margin", s.marginPercent / 100, PERCENT]]);
  lines("MONEY AND BALANCES (UGX)", [["Received from buyers", s.buyerReceiptsUgx], ["Paid to suppliers", s.supplierPaymentsUgx], ["Owed by buyers", s.receivablesUgx], ["Owed to suppliers", s.payablesUgx], ["Stock value at cost", s.stockValueUgx]]);
  lines("VOLUMES", [["Number of purchases", s.purchases], ["Bought (kg)", s.purchasedKg], ["Number of sales", s.sales], ["Sold (kg)", s.soldKg], ["Stock today (kg)", s.stockKg]]);
  const materials = new Map<string, { sales: number; kg: number; revenue: number }>();
  for (const sale of report.sales) {
    const item = materials.get(sale.material_type) ?? { sales: 0, kg: 0, revenue: 0 };
    item.sales += 1; item.kg += n(sale.quantity_kg); item.revenue += sale.revenueUgx;
    materials.set(sale.material_type, item);
  }
  const share = (value: number) => revenue ? value / revenue : 0;
  row = addBreakdown(sheet, row, "SALES BY MATERIAL", ["Material", "Sales", "Sold (kg)", "Sales (UGX)", "% of Sales"], [...materials].sort((a, b) => b[1].revenue - a[1].revenue).map(([name, item]) => [name, item.sales, item.kg, item.revenue, share(item.revenue)]), [KG, KG, KG, PERCENT]);
  addBreakdown(sheet, row + 1, "SALES BY BUYER", ["Buyer", "Sales", "Sold (kg)", "Sales (UGX)", "% of Sales"], report.buyers.map(buyer => [buyer.name, buyer.transactions, buyer.quantityKg, buyer.valueUgx, share(buyer.valueUgx)]), [KG, KG, KG, PERCENT]);
}

export async function buildCompanyWorkbook(report: Report, records: CompanyReportRecords, loans: LoanRow[], cash: CashRow[]) {
  const company = String(report.organization.name).toUpperCase(), { from, to } = report.range;
  const within = (date: string) => date >= from && date <= to;
  const lots = new Map(records.lots.map(lot => [lot.id, lot]));
  const material = (id: string) => lots.get(id)?.material_type ?? "Unknown";
  const sorting = records.sorting.filter(batch => within(batch.processed_on)).sort((a, b) => a.processed_on.localeCompare(b.processed_on));
  const title = (name: string) => `${company} — ${name}`, period = `from ${from} to ${to}`;
  const book = new ExcelJS.Workbook();
  book.creator = "Kampala WMS";

  addSummary(book, company, report);
  addTable<Row>(book, "Daily_Log", title("DAILY ACTIVITY"), `Each day with activity, ${period}.`, [
    text("Date", row => row.date, 13), { label: "Purchases", width: 11, format: KG, total: true, value: row => row.purchases }, money("Bought (kg)", row => row.purchasedKg, 13), money("Purchase Cost (UGX)", row => row.purchaseCostUgx),
    { label: "Sales", width: 9, format: KG, total: true, value: row => row.sales }, money("Sold (kg)", row => row.soldKg, 13), money("Sales (UGX)", row => row.revenueUgx), money("Cost of Material Sold (UGX)", row => row.costOfGoodsUgx), money("Selling Costs (UGX)", row => row.sellingCostsUgx), money("Operating Expenses (UGX)", row => row.overheadUgx), money("Stock Losses (UGX)", row => row.stockLossUgx), money("Operating Profit (UGX)", row => row.operatingProfitUgx),
  ], report.daily);
  addTable<Row>(book, "Purchases", title("PURCHASES"), `Material bought ${period}. Paid and balance are as of ${to}.`, [
    text("Date", row => row.collected_on, 13), text("Supplier", row => row.source_name, 26), text("Material", row => row.material_type), money("Weight (kg)", row => row.quantity_kg, 13), { label: "Price per kg (UGX)", width: 13, format: KG, value: row => n(row.unit_purchase_price_ugx) }, money("Total Cost (UGX)", row => row.totalCostUgx), money("Paid (UGX)", row => row.paidUgx), money("Balance (UGX)", row => row.balanceUgx),
  ], report.purchases);
  addTable<Row>(book, "Sorting", title("SORTING"), `Material sorted ${period}. What is not sorted out stays in the source material.`, [
    text("Date", row => row.processed_on, 13), text("From Material", row => material(row.input_lot_id), 22), text("Sorted Into", row => material(row.output_lot_id), 22), money("Taken (kg)", row => row.input_kg, 13), money("Sorted (kg)", row => row.output_kg, 13), money("Rejected (kg)", row => row.rejected_kg, 13), money("Sorting Cost (UGX)", row => row.processing_cost_ugx),
  ], sorting);
  addTable<Row>(book, "Sales", title("SALES"), `Material sold ${period}. Paid and balance are as of ${to}.`, [
    text("Date", row => row.sold_on, 13), text("Buyer", row => row.buyer_name, 26), text("Material", row => row.material_type), money("Delivered (kg)", row => row.delivered_kg ?? row.quantity_kg, 13), money("Paid For (kg)", row => row.quantity_kg, 13), money("Refused (kg)", row => Math.max(n(row.delivered_kg ?? row.quantity_kg) - n(row.quantity_kg), 0), 13), { label: "Price per kg (UGX)", width: 13, format: KG, value: row => n(row.unit_price_ugx) }, money("Sales (UGX)", row => row.revenueUgx), money("Cost of Material (UGX)", row => row.costOfGoodsUgx), money("Selling Costs (UGX)", row => row.sellingCostsUgx), money("Received (UGX)", row => row.paidUgx), money("Balance (UGX)", row => row.balanceUgx),
  ], report.sales);
  addTable<Row>(book, "Stock", title("CURRENT STOCK"), "Stock as it stands today, valued at cost.", [
    text("Material", row => row.material, 28), money("Weight (kg)", row => row.quantityKg), money("Value at Cost (UGX)", row => row.valueUgx, 20),
  ], report.stock);
  const partner = (label: string, value: string, paid: string) => [text(label, (row: Row) => row.name, 30), { label: "Transactions", width: 13, format: KG, total: true, value: (row: Row) => row.transactions }, money("Weight (kg)", (row: Row) => row.quantityKg), money(value, (row: Row) => row.valueUgx), money(paid, (row: Row) => row.paidUgx), money("Balance (UGX)", (row: Row) => row.balanceUgx)];
  addTable<Row>(book, "Suppliers", title("SUPPLIERS"), `Purchases by supplier, ${period}.`, partner("Supplier", "Bought (UGX)", "Paid (UGX)"), report.suppliers);
  addTable<Row>(book, "Buyers", title("BUYERS"), `Sales by buyer, ${period}.`, partner("Buyer", "Sales (UGX)", "Received (UGX)"), report.buyers);
  addTable<Row>(book, "Expenses", title("OPERATING EXPENSES"), `Every expense dated ${period}. Drafts, voided expenses and worker advances don’t count towards profit.`, [
    text("Date", row => row.expense_date, 13), text("Number", row => row.expense_number), text("Category", row => words(String(row.category))), text("Description", row => row.description, 34), text("Worker / Provider", row => row.vendor, 24), money("Amount (UGX)", row => row.amount_ugx), text("Status", row => words(String(row.status)), 12),
  ], report.expenses);
  addTable<LoanRow>(book, "Loans", title("LOANS"), `Loans received by ${to}, with what was repaid by that date.`, [
    text("Received", row => row.received_on, 13), text("Lender", row => row.lender_name, 28), text("Reference", row => row.reference), text("Due", row => row.due_on, 13), money("Amount (UGX)", row => row.amount_ugx), money("Repaid (UGX)", row => row.repaid_ugx), money("Still Owed (UGX)", row => row.amount_ugx - row.repaid_ugx),
  ], loans);
  addTable<CashRow>(book, "Other_Cash", title("OTHER CASH MOVEMENTS"), `Money in and out ${period} other than purchases, sales and expenses: capital, loans, payouts and corrections.`, [
    text("Date", row => row.movement_date, 13), text("Category", row => words(row.category), 22), text("Reference", row => row.reference, 22), text("From / To", row => row.counterparty, 24), text("Notes", row => row.notes, 36), money("Money In (UGX)", row => row.direction === "in" ? row.amount_ugx : 0), money("Money Out (UGX)", row => row.direction === "out" ? row.amount_ugx : 0),
  ], cash);
  addGuide(book, title("EXCEL EXPORT GUIDE"), "This workbook is generated from Kampala WMS company records.", [
    ["Summary", "Profit, balances, volumes, and sales by material and buyer."],
    ["Daily_Log", "Purchases, sales and profit for each day with activity."],
    ["Purchases, Sorting, Sales", "Each record for the period, with totals in the last row."],
    ["Stock", "Current stock by material, valued at cost. It doesn’t change with the report dates."],
    ["Suppliers, Buyers", "Totals and balances for each partner in the period."],
    ["Expenses", "Every expense in the period, whatever its status."],
    ["Loans, Other_Cash", "Loans with what is still owed, and money that isn’t a purchase, sale or expense."],
  ], report.basis.profit);
  return Buffer.from(await book.xlsx.writeBuffer());
}
