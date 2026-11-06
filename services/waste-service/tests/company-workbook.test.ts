import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildCompanyReport, CompanyReportRecords } from "../src/services/company-report";
import { buildCompanyWorkbook } from "../src/services/company-workbook";

const lot = (id: string, material: string, origin: string, kg: number, available: number, price: number) => ({ id, material_type: material, source_name: "Kalerwe Dealers", origin, quantity_kg: kg, available_kg: available, unit_purchase_price_ugx: price, worker_wages_ugx: 0, food_ugx: 0, transport_ugx: 0, driver_fee_ugx: 0, other_expense_ugx: 0, collected_on: "2026-10-01" });
const records: CompanyReportRecords = {
  organization: { id: "o", name: "Wallas Ecotrade", type: "recycling_company" },
  lots: [lot("mixed", "Mixed", "purchase", 10000, 7000, 100), lot("sacs", "Sacs", "sorted", 3000, 1000, 0)],
  sales: [{ id: "s1", lot_id: "sacs", buyer_name: "Factory Ltd", quantity_kg: 1800, delivered_kg: 2000, unit_price_ugx: 500, worker_wages_ugx: 0, food_ugx: 0, transport_ugx: 20000, other_expense_ugx: 0, sold_on: "2026-10-10" }],
  saleLots: [{ sale_id: "s1", lot_id: "sacs", delivered_kg: 2000 }],
  sorting: [{ input_lot_id: "mixed", output_lot_id: "sacs", input_kg: 3000, output_kg: 3000, rejected_kg: 0, processing_cost_ugx: 30000, processed_on: "2026-10-05" }],
  adjustments: [], float: [],
  expenses: [{ id: "e1", expense_number: "EXP-1", category: "rent", description: "=SUM(A1)", vendor: null, amount_ugx: 50000, status: "paid", expense_date: "2026-10-12" }],
  purchasePayments: [{ lot_id: "mixed", amount_ugx: 400000, paid_on: "2026-10-02" }],
  salePayments: [{ sale_id: "s1", amount_ugx: 900000, paid_on: "2026-10-10" }],
};
const open = async () => {
  const report = buildCompanyReport(records, "2026-10-01", "2026-10-31");
  const file = await buildCompanyWorkbook(report, records, [{ lender_name: "Muhire", received_on: "2026-10-03", due_on: null, reference: "L1", amount_ugx: 500000, repaid_ugx: 100000 }], [{ movement_date: "2026-10-03", direction: "in", category: "loan_received", amount_ugx: 500000, reference: "L1", counterparty: "Muhire", notes: "Loan" }]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file as never);
  return { book, report };
};
const find = (sheet: ExcelJS.Worksheet, label: string) => { let value: unknown; sheet.eachRow(row => { if (row.getCell(1).value === label) value = row.getCell(4).value; }); return value; };

test("the workbook has every sheet, in order", async () => {
  const { book } = await open();
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ["Summary", "Daily_Log", "Purchases", "Sorting", "Sales", "Stock", "Suppliers", "Buyers", "Expenses", "Loans", "Other_Cash", "How_To_Use"]);
  assert.equal(book.getWorksheet("Summary")!.getCell("A1").value, "WALLAS ECOTRADE — COMPANY REPORT");
});

test("the summary agrees with the report on screen", async () => {
  const { book, report } = await open(), summary = book.getWorksheet("Summary")!;
  assert.equal(find(summary, "Sales"), report.summary.revenueUgx);
  assert.equal(find(summary, "Operating profit"), report.summary.operatingProfitUgx);
  assert.equal(find(summary, "Owed to suppliers"), report.summary.payablesUgx);
});

test("a sale shows what was delivered, paid for and refused, and tables end in totals", async () => {
  const { book } = await open(), sales = book.getWorksheet("Sales")!;
  assert.deepEqual([sales.getCell("D4").value, sales.getCell("E4").value, sales.getCell("F4").value, sales.getCell("H4").value], [2000, 1800, 200, 900000]);
  assert.equal(sales.getCell("A5").value, "Total");
  assert.equal(sales.getCell("H5").value, 900000);
});

test("sorting names its materials and a loan shows what is still owed", async () => {
  const { book } = await open(), sorting = book.getWorksheet("Sorting")!, loans = book.getWorksheet("Loans")!;
  assert.deepEqual([sorting.getCell("B4").value, sorting.getCell("C4").value], ["Mixed", "Sacs"]);
  assert.equal(loans.getCell("G4").value, 400000);
  assert.equal(book.getWorksheet("Other_Cash")!.getCell("B4").value, "Loan received");
});

test("text that looks like a formula stays text", async () => {
  const { book } = await open();
  assert.equal(book.getWorksheet("Expenses")!.getCell("D4").value, "=SUM(A1)");
});

test("an empty period still makes a workbook", async () => {
  const empty: CompanyReportRecords = { ...records, lots: [], sales: [], saleLots: [], sorting: [], expenses: [], purchasePayments: [], salePayments: [] };
  assert.ok((await buildCompanyWorkbook(buildCompanyReport(empty, "2026-10-01", "2026-10-31"), empty, [], [])).length > 1000);
});
