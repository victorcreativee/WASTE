import ExcelJS from "exceljs";
import { addBreakdown, addGuide, addHeader, addRow, addSection, addSheet, Column, COLOR, KG, PERCENT, TONNES } from "./workbook";

// The weighbridge workbook KCCA reads: a log of completed tickets for the period, a summary with its breakdowns, the
// vehicles and drivers behind them, and the whole months around the period. Sheet names and layout follow the Buyala
// workbook, so the export can replace it.

export type ReportTicket = {
  ticket_number: string; operation_date: string; registration: string; origin_area: string | null; division: string | null;
  operator_category: string | null; company: string; route_source: string | null; driver_name: string | null; driver_phone: string | null;
  arrival: string; gross_kg: number; tare_kg: number; net_kg: number; departure: string | null; status: string;
};
export type ReportVehicle = { registration: string; origin_area: string | null; division: string | null; operator_category: string | null; company: string | null; route_source: string | null; vehicle_type: string | null; tare_kg: number | null; status: string };
export type ReportDriver = { name: string; phone: string | null; company: string | null; status: string };
export type WeighbridgeReport = { facilityName: string; from: string; to: string; archiveFrom: string; archiveTo: string; tickets: ReportTicket[]; vehicles: ReportVehicle[]; drivers: ReportDriver[] };

const DAY_MS = 86400000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

/** The first and last day of the months a period touches. */
export function archiveMonths(from: string, to: string) {
  const [year, month] = to.split("-").map(Number);
  return { archiveFrom: `${from.slice(0, 7)}-01`, archiveTo: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}

function breakdown(tickets: ReportTicket[], label: (ticket: ReportTicket) => string, totalKg: number) {
  const groups = new Map<string, { label: string; trips: number; netKg: number }>();
  for (const ticket of tickets) {
    const name = label(ticket), group = groups.get(name) ?? { label: name, trips: 0, netKg: 0 };
    group.trips += 1;
    group.netKg += ticket.net_kg;
    groups.set(name, group);
  }
  return [...groups.values()].sort((a, b) => b.netKg - a.netKg || a.label.localeCompare(b.label)).map(group => ({ ...group, share: totalKg ? group.netKg / totalKg : 0 }));
}

const category = (ticket: ReportTicket) => (ticket.operator_category ?? "").toLowerCase();

export function summarize(tickets: ReportTicket[], from: string, to: string) {
  const sum = (key: "gross_kg" | "tare_kg" | "net_kg") => tickets.reduce((total, ticket) => total + ticket[key], 0);
  const netKg = sum("net_kg"), netTonnes = netKg / 1000;
  return {
    trips: tickets.length,
    kccaDirect: tickets.filter(ticket => category(ticket).includes("kcca")).length,
    concessionaires: tickets.filter(ticket => category(ticket).startsWith("concession")).length,
    nonConcessionaires: tickets.filter(ticket => category(ticket).startsWith("non")).length,
    grossKg: sum("gross_kg"), tareKg: sum("tare_kg"), netKg, netTonnes,
    tonnesPerTrip: tickets.length ? netTonnes / tickets.length : 0,
    tonnesPerDay: netTonnes / daysBetween(from, to),
    divisions: breakdown(tickets, ticket => ticket.division || "Unconfirmed division", netKg),
    origins: breakdown(tickets, ticket => ticket.origin_area || "Unconfirmed origin", netKg),
    categories: breakdown(tickets, ticket => ticket.operator_category || "Unconfirmed", netKg),
    companies: breakdown(tickets, ticket => ticket.company, netKg),
  };
}

const ticketValues = (ticket: ReportTicket) => [ticket.ticket_number, ticket.operation_date, ticket.registration, ticket.origin_area, ticket.division, ticket.operator_category, ticket.company, ticket.route_source, ticket.driver_name, ticket.driver_phone, ticket.arrival, ticket.gross_kg, ticket.tare_kg, ticket.net_kg, ticket.departure, ticket.status.toUpperCase()];
const weights: Record<number, Column> = { 12: { format: KG }, 13: { format: KG }, 14: { format: KG } };

function addDailyLog(book: ExcelJS.Workbook, facility: string, tickets: ReportTicket[], from: string, to: string) {
  const sheet = addSheet(book, "Daily_Log", [18, 13, 15, 25, 18, 22, 22, 28, 20, 16, 12, 14, 14, 14, 13, 12], `${facility} — DAILY WEIGHBRIDGE LOG`, `Completed transactions from ${from} to ${to}. Origin, division and operator category are separate reporting fields.`, 4);
  addHeader(sheet, 4, ["Ticket No.", "Date", "Reg. No.", "Origin Area", "Kampala Division", "Operator Category", "Company", "Collection Site\n/ Route", "Driver Name", "Tel.", "Arrival\nTime", "Gross Wt\n(kg)", "Tare Wt\n(kg)", "Net Wt\n(kg)", "Departure\nTime", "Status"]);
  const location = { tint: COLOR.location }, person = { tint: COLOR.person };
  const columns = { ...weights, 4: location, 5: location, 6: location, 7: location, 8: location, 9: person, 10: person };
  tickets.forEach((ticket, index) => addRow(sheet, index + 5, ticketValues(ticket), columns, index % 2 === 1));
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + tickets.length, column: 16 } };
}

function addSummary(book: ExcelJS.Workbook, facility: string, tickets: ReportTicket[], from: string, to: string) {
  const summary = summarize(tickets, from, to);
  const sheet = addSheet(book, "Daily_Summary", [28, 14, 20, 18, 16], `${facility} — OPERATIONAL SUMMARY`, `Calculated from completed transactions between ${from} and ${to}.`, 3);
  let row = addSection(sheet, 4, "OVERALL TOTALS");
  ([
    ["Total vehicles logged", summary.trips, KG], ["KCCA direct", summary.kccaDirect, KG], ["Concessionaires", summary.concessionaires, KG], ["Non-Concessionaires", summary.nonConcessionaires, KG],
    ["Total gross weight (kg)", summary.grossKg, KG], ["Total tare weight (kg)", summary.tareKg, KG], ["Total net weight (kg)", summary.netKg, KG],
    ["Total net tonnes", summary.netTonnes, TONNES], ["Average tonnes per trip", summary.tonnesPerTrip, TONNES], ["Daily average tonnes", summary.tonnesPerDay, TONNES],
  ] as [string, number, string][]).forEach(([label, value, format], index) => {
    addRow(sheet, row, [label, "", "", value], { 4: { format } }, index % 2 === 1);
    row += 1;
  });
  ([
    ["BREAKDOWN BY DIVISION", "Division", "Vehicles", summary.divisions], ["BREAKDOWN BY ORIGIN AREA", "Origin Area", "Trips", summary.origins],
    ["BREAKDOWN BY OPERATOR CATEGORY", "Operator Category", "Trips", summary.categories], ["BREAKDOWN BY PRIVATE COMPANY", "Private Company", "Trips", summary.companies],
  ] as const).forEach(([title, label, count, groups]) => {
    row = addBreakdown(sheet, row + 1, title, [label, count, "Net Weight (kg)", "Net Weight (T)", "% of Total"], groups.map(group => [group.label, group.trips, group.netKg, group.netKg / 1000, group.share]), [KG, KG, TONNES, PERCENT]);
  });
}

function addVehicles(book: ExcelJS.Workbook, facility: string, vehicles: ReportVehicle[]) {
  const sheet = addSheet(book, "Vehicle_DB", [16, 25, 18, 22, 24, 32, 18, 18, 12], `${facility} — VEHICLE MASTER DATABASE`, "Origin, Kampala division and operator category are stored separately. They come from each vehicle’s latest completed ticket.", 3);
  addHeader(sheet, 3, ["Reg. No.", "Origin Area", "Kampala Division", "Operator Category", "Company / Owner", "Collection Site / Route", "Vehicle Type", "Tare Weight (kg)", "Status"]);
  vehicles.forEach((vehicle, index) => addRow(sheet, index + 4, [vehicle.registration, vehicle.origin_area, vehicle.division, vehicle.operator_category, vehicle.company, vehicle.route_source, vehicle.vehicle_type, vehicle.tare_kg, vehicle.status], { 8: { format: KG } }, index % 2 === 0));
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + vehicles.length, column: 9 } };
}

function addDrivers(book: ExcelJS.Workbook, facility: string, drivers: ReportDriver[]) {
  const sheet = addSheet(book, "Driver_DB", [25, 18, 35, 12], `${facility} — DRIVER DATABASE`, "Driver names and telephone numbers used during weighbridge entry.", 3);
  addHeader(sheet, 3, ["Driver Name", "Phone Number", "Notes / Company", "Status"]);
  drivers.forEach((driver, index) => addRow(sheet, index + 4, [driver.name, driver.phone, driver.company, driver.status], {}, index % 2 === 0));
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + drivers.length, column: 4 } };
}

function addArchive(book: ExcelJS.Workbook, tickets: ReportTicket[], from: string, to: string) {
  const sheet = addSheet(book, "Monthly_Archive", [18, 13, 15, 25, 18, 22, 24, 30, 22, 16, 12, 14, 14, 14, 13, 12], "MONTHLY ARCHIVE — COMPLETED TRANSACTIONS", `Every completed transaction in the months of this report, from ${from} to ${to}. No manual copying is required.`, 3);
  addHeader(sheet, 3, ["Ticket No.", "Date", "Reg. No.", "Origin Area", "Kampala Division", "Operator Category", "Company", "Collection Site / Route", "Driver", "Tel.", "Arrival", "Gross kg", "Tare kg", "Net kg", "Departure", "Status"]);
  tickets.forEach((ticket, index) => addRow(sheet, index + 4, ticketValues(ticket), weights, index % 2 === 0));
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + tickets.length, column: 16 } };
}

export async function buildWeighbridgeWorkbook(report: WeighbridgeReport) {
  const { from, to, tickets } = report, facility = report.facilityName.toUpperCase();
  const period = tickets.filter(ticket => ticket.operation_date >= from && ticket.operation_date <= to);
  const book = new ExcelJS.Workbook();
  book.creator = "Kampala WMS";
  addDailyLog(book, facility, period, from, to);
  addSummary(book, facility, period, from, to);
  addVehicles(book, facility, report.vehicles);
  addDrivers(book, facility, report.drivers);
  addArchive(book, tickets, report.archiveFrom, report.archiveTo);
  addGuide(book, `${facility} — EXCEL EXPORT GUIDE`, "This workbook is generated from Kampala WMS weighbridge records.", [
    ["Daily_Log", "Completed transactions for the selected report period with origin, division, operator and company kept separate."],
    ["Daily_Summary", "Totals plus division, origin, operator-category and private-company contributions."],
    ["Vehicle_DB", "Vehicles of the companies in this report, and any other vehicle with a completed ticket."],
    ["Driver_DB", "Drivers named on completed tickets."],
    ["Monthly_Archive", "All completed transactions in the months of the report period; no manual copy-and-paste required."],
  ], "Open and voided tickets are left out. Tare workflow, canonical division spelling, and official ticket policy remain subject to KCCA confirmation.");
  return Buffer.from(await book.xlsx.writeBuffer());
}
