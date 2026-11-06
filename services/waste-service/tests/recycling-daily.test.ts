import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildDailyWorkbook, dayTotals, withStockAfter } from "../src/services/recycling-daily";

const entry = (id: string, recorded_at: string, input_kg: number, output_kg: number) => ({ id, date: "2026-11-02", input_material: "Mixed", output_material: "Soft black", input_kg, output_kg, rejected_kg: input_kg - output_kg, cost_ugx: 0, recorded_at });

test("stock after each sorting entry follows the order things were recorded", () => {
  const rows = withStockAfter([entry("late", "2026-11-03T10:00:00Z", 100, 90), entry("early", "2026-11-02T10:00:00Z", 50, 50)], [
    { at: "2026-11-01T08:00:00Z", material: "Mixed", kg: 1000 },
    { at: "2026-11-02T10:00:00Z", material: "Mixed", kg: -50 }, { at: "2026-11-02T10:00:00Z", material: "Soft black", kg: 50 },
    { at: "2026-11-02T12:00:00Z", material: "Soft black", kg: -20 },
    { at: "2026-11-03T10:00:00Z", material: "Mixed", kg: -100 }, { at: "2026-11-03T10:00:00Z", material: "Soft black", kg: 90 },
    { at: "2026-11-04T10:00:00Z", material: "Mixed", kg: 500 },
  ]);
  assert.deepEqual(rows.map(row => [row.id, row.inputStockKg, row.outputStockKg]), [["late", 850, 120], ["early", 950, 50]]);
});

const purchase = { id: "p", date: "2026-11-02", material: "Mixed", supplier: "S", reference: null, quantity_kg: 100, price_ugx: 200, material_cost_ugx: 20000, other_costs_ugx: 1000, total_ugx: 21000, payment: "Paid" };
const sale = { id: "s", date: "2026-11-03", material: "Sacs", buyer: "B", invoice: null, delivered_kg: 110, paid_kg: 100, price_ugx: 700, revenue_ugx: 70000, received_ugx: 70000, balance_ugx: 0 };
const float = (type: "given" | "spent" | "returned", amount_ugx: number) => ({ id: type, date: "2026-11-02", type, amount_ugx, balance_ugx: 0, reference: null, linked_to: "", notes: null, recorded_by: null });

test("day totals keep each kind of record apart, newest day first", () => {
  const days = dayTotals([purchase], [sale], [float("given", 500), float("spent", 200), float("returned", 100)], [entry("e", "2026-11-02T10:00:00Z", 100, 90)]);
  assert.deepEqual(days.map(day => day.date), ["2026-11-03", "2026-11-02"]);
  assert.deepEqual([days[1].purchaseUgx, days[1].floatGivenUgx, days[1].floatSpentUgx, days[1].floatReturnedUgx, days[1].sortedKg, days[1].sortingWasteKg], [21000, 500, 200, 100, 90, 10]);
  assert.equal(days[0].salesUgx, 70000);
});

test("the workbook has a sheet for each kind of record", async () => {
  const sorting = withStockAfter([entry("e", "2026-11-02T10:00:00Z", 100, 90)], []);
  const file = await buildDailyWorkbook({ organization: "Wallas", from: "2026-11-02", to: "2026-11-03", days: dayTotals([purchase], [sale], [], sorting), purchases: [purchase], sales: [sale], float: [float("spent", 200)], sorting });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file as never);
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ["Day_Totals", "Purchases", "Sales", "Floating", "Sorting", "How_To_Use"]);
  assert.equal(book.getWorksheet("Sales")!.getCell("H4").value, 70000);
  assert.equal(book.getWorksheet("Floating")!.getCell("B4").value, "Spent");
});
