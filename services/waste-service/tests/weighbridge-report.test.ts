import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { weighbridgeReportQuery } from "../src/controllers/weighbridge.controller";
import { archiveMonths, buildWeighbridgeWorkbook, ReportTicket, summarize } from "../src/services/weighbridge-report";

const ticket = (ticket_number: string, division: string | null, operator_category: string | null, company: string, gross_kg: number, tare_kg: number, operation_date = "2026-08-20"): ReportTicket => ({ ticket_number, operation_date, registration: "UBM 100M", origin_area: null, division, operator_category, company, route_source: "Mengo - Masanafu", driver_name: "Victor", driver_phone: "0772333333", arrival: "12:08", gross_kg, tare_kg, net_kg: gross_kg - tare_kg, departure: null, status: "completed" });
// The five tickets of the Buyala workbook this export follows.
const tickets = [
  ticket("8DA6275A", "City Center", "Non-concessionaire", "KCCA", 300, 100),
  ticket("F5DAABAB", "Mengo", null, "Mugisha waste management", 10000, 2000),
  ticket("50A53418", "Mengo", null, "Mugisha waste management", 18000, 7000),
  ticket("AE0B8186", "Lubaga", null, "Nyarugabo", 12000, 3000),
  ticket("BUY-20260820-005", "Mengo", null, "Mugisha waste management", 13000, 2500),
];

test("the summary reproduces the Buyala workbook's figures", () => {
  const s = summarize(tickets, "2026-08-14", "2026-08-21");
  assert.deepEqual([s.trips, s.kccaDirect, s.concessionaires, s.nonConcessionaires, s.grossKg, s.tareKg, s.netKg, s.netTonnes], [5, 0, 0, 1, 53300, 14600, 38700, 38.7]);
  assert.equal(s.tonnesPerTrip, 7.74);
  assert.equal(s.tonnesPerDay, 4.8375, "eight days, both ends counted");
  assert.deepEqual(s.divisions.map(d => [d.label, d.trips, d.netKg]), [["Mengo", 3, 29500], ["Lubaga", 1, 9000], ["City Center", 1, 200]]);
  assert.equal(s.origins[0].label, "Unconfirmed origin");
  assert.equal(s.categories[0].label, "Unconfirmed");
  assert.ok(Math.abs(s.companies[0].share - 0.7622739) < 1e-6);
});

test("concessionaires and non-concessionaires are told apart", () => {
  const s = summarize([ticket("A", null, "Concessionaire", "X", 2, 1), ticket("B", null, "KCCA direct", "X", 2, 1)], "2026-08-20", "2026-08-20");
  assert.deepEqual([s.concessionaires, s.nonConcessionaires, s.kccaDirect], [1, 0, 1]);
});

test("an archive covers the whole months of the period", () => {
  assert.deepEqual(archiveMonths("2026-08-14", "2026-08-21"), { archiveFrom: "2026-08-01", archiveTo: "2026-08-31" });
  assert.deepEqual(archiveMonths("2025-12-30", "2026-02-02"), { archiveFrom: "2025-12-01", archiveTo: "2026-02-28" });
});

test("the workbook has the six sheets, keeps the log to the period and the archive to the months", async () => {
  const file = await buildWeighbridgeWorkbook({ facilityName: "Buyala Landfill", from: "2026-08-14", to: "2026-08-21", archiveFrom: "2026-08-01", archiveTo: "2026-08-31", tickets: [ticket("EARLY", "Mengo", null, "Nyarugabo", 5000, 1000, "2026-08-02"), ...tickets], vehicles: [], drivers: [{ name: "=HYPERLINK(1)", phone: null, company: "X", status: "Active" }] });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file as never);
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ["Daily_Log", "Daily_Summary", "Vehicle_DB", "Driver_DB", "Monthly_Archive", "How_To_Use"]);
  const log = book.getWorksheet("Daily_Log")!, archive = book.getWorksheet("Monthly_Archive")!, summary = book.getWorksheet("Daily_Summary")!;
  assert.equal(log.getCell("A1").value, "BUYALA LANDFILL — DAILY WEIGHBRIDGE LOG");
  assert.equal(log.getCell("A5").value, "8DA6275A");
  assert.equal(log.getCell("N5").value, 200, "weights are real numbers");
  assert.equal(log.getCell("P5").value, "COMPLETED");
  assert.equal(log.getCell("A10").value, null, "the earlier ticket stays out of the log");
  assert.equal(archive.getCell("A4").value, "EARLY");
  assert.equal(summary.getCell("D11").value, 38700);
  assert.equal(book.getWorksheet("Driver_DB")!.getCell("A4").value, "=HYPERLINK(1)", "text that looks like a formula stays text");
});

test("an empty period still makes a workbook", async () => {
  const file = await buildWeighbridgeWorkbook({ facilityName: "Buyala", from: "2026-08-14", to: "2026-08-21", archiveFrom: "2026-08-01", archiveTo: "2026-08-31", tickets: [], vehicles: [], drivers: [] });
  assert.ok(file.length > 1000);
});

test("the report period is checked", () => {
  const ok = { facility: "BUYALA", from: "2026-08-14", to: "2026-08-21" };
  assert.equal(weighbridgeReportQuery.safeParse(ok).success, true);
  assert.equal(weighbridgeReportQuery.safeParse({ ...ok, from: "2026-08-22" }).success, false);
  assert.equal(weighbridgeReportQuery.safeParse({ ...ok, from: "2024-01-01" }).success, false);
  assert.equal(weighbridgeReportQuery.safeParse({ facility: "BUYALA" }).success, false);
});
