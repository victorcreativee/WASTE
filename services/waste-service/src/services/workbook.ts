import ExcelJS from "exceljs";

// The look every KWMS Excel export shares, taken from the Buyala weighbridge workbook.

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
export const COLOR = { title: "FF10372C", subtitle: "FFE8F3ED", header: "FF176B43", band: "FFF6F8F7", white: "FFFFFFFF", location: "FFDDEBF7", person: "FFE4DFEC", note: "FFFFF2CC" };
export const KG = "#,##0", TONNES = "#,##0.000", PERCENT = "0.0%";
const INK = "FF18251F";
const headerBorder: Partial<ExcelJS.Borders> = { bottom: { style: "thin", color: { argb: "FFAABBB2" } } };
const rowBorder: Partial<ExcelJS.Borders> = { bottom: { style: "hair", color: { argb: "FFDDE5E0" } } };

export type Column = { format?: string; tint?: string };
type Value = string | number | null | undefined;

export function addSheet(book: ExcelJS.Workbook, name: string, widths: number[], title: string, subtitle: string, frozenRows: number) {
  const sheet = book.addWorksheet(name, {
    views: frozenRows ? [{ state: "frozen", ySplit: frozenRows }] : [],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  sheet.columns = widths.map(width => ({ width }));
  [[title, { name: "Arial", size: 16, bold: true, color: { argb: COLOR.white } }, COLOR.title, "left"], [subtitle, { name: "Arial", size: 9, italic: true, color: { argb: "FF53635B" } }, COLOR.subtitle, undefined]].forEach(([text, font, background, horizontal], index) => {
    const row = index + 1;
    sheet.mergeCells(row, 1, row, widths.length);
    const cell = sheet.getCell(row, 1);
    cell.value = text as string;
    cell.font = font as Partial<ExcelJS.Font>;
    cell.fill = fill(background as string);
    cell.alignment = { vertical: "middle", wrapText: index === 1, horizontal: horizontal as "left" | undefined };
    sheet.getRow(row).height = 28;
  });
  return sheet;
}

export function addHeader(sheet: ExcelJS.Worksheet, rowNumber: number, labels: string[]) {
  const row = sheet.getRow(rowNumber);
  row.height = 34;
  labels.forEach((label, index) => {
    const cell = row.getCell(index + 1);
    cell.value = label;
    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: COLOR.white } };
    cell.fill = fill(COLOR.header);
    cell.border = headerBorder;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
}

export function addRow(sheet: ExcelJS.Worksheet, rowNumber: number, values: Value[], columns: Record<number, Column>, banded: boolean) {
  const row = sheet.getRow(rowNumber);
  row.height = 22;
  values.forEach((value, index) => {
    const cell = row.getCell(index + 1), column = columns[index + 1], numeric = Boolean(column?.format);
    cell.value = value ?? "";
    cell.font = { name: "Arial", size: 9, color: { argb: INK } };
    cell.fill = fill(column?.tint ?? (banded ? COLOR.band : COLOR.white));
    cell.border = rowBorder;
    cell.alignment = { horizontal: numeric ? "right" : "left", vertical: "middle", wrapText: true };
    if (column?.format) cell.numFmt = column.format;
  });
}

/** A green bar across the sheet. Returns the row after it. */
export function addSection(sheet: ExcelJS.Worksheet, row: number, title: string) {
  const last = sheet.columnCount;
  sheet.mergeCells(row, 1, row, last);
  const cell = sheet.getCell(row, 1);
  cell.value = title;
  cell.font = { name: "Arial", size: 10, bold: true, color: { argb: COLOR.white } };
  cell.fill = fill(COLOR.header);
  return row + 1;
}

/** A section with a label column and numeric columns, the last being a share shown in white on green. Returns the next free row. */
export function addBreakdown(sheet: ExcelJS.Worksheet, startRow: number, title: string, labels: string[], rows: Value[][], formats: string[]) {
  let row = addSection(sheet, startRow, title);
  addHeader(sheet, row, labels);
  row += 1;
  const columns = Object.fromEntries(formats.map((format, index) => [index + 2, { format }]));
  rows.forEach((values, index) => {
    addRow(sheet, row, values, columns, index % 2 === 0);
    const share = sheet.getCell(row, labels.length);
    share.font = { name: "Arial", size: 9, bold: true, color: { argb: COLOR.white } };
    share.fill = fill(COLOR.header);
    row += 1;
  });
  return row;
}

export type TableColumn<T> = { label: string; width: number; value: (row: T) => Value; format?: string; total?: boolean };

/** A sheet holding one filterable table, with a totals row when any column asks for one. */
export function addTable<T>(book: ExcelJS.Workbook, name: string, title: string, subtitle: string, columns: TableColumn<T>[], rows: T[]) {
  const sheet = addSheet(book, name, columns.map(column => column.width), title, subtitle, 3);
  addHeader(sheet, 3, columns.map(column => column.label));
  const formats = Object.fromEntries(columns.flatMap((column, index) => column.format ? [[index + 1, { format: column.format }]] : []));
  rows.forEach((row, index) => addRow(sheet, index + 4, columns.map(column => column.value(row)), formats, index % 2 === 0));
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: columns.length } };
  if (rows.length && columns.some(column => column.total)) {
    const totalRow = rows.length + 4;
    addRow(sheet, totalRow, columns.map((column, index) => column.total ? rows.reduce((sum, row) => sum + Number(column.value(row) ?? 0), 0) : index === 0 ? "Total" : ""), formats, false);
    sheet.getRow(totalRow).eachCell(cell => { cell.font = { name: "Arial", size: 9, bold: true, color: { argb: INK } }; cell.fill = fill(COLOR.subtitle); });
  }
  return sheet;
}

/** The closing guide sheet. Each row is [section, guidance]; `important` is highlighted. */
export function addGuide(book: ExcelJS.Workbook, title: string, subtitle: string, rows: string[][], important: string) {
  const sheet = addSheet(book, "How_To_Use", [24, 90], title, subtitle, 0);
  addHeader(sheet, 3, ["Section", "Guidance"]);
  rows.forEach((values, index) => addRow(sheet, index + 4, values, {}, index % 2 === 0));
  addRow(sheet, rows.length + 4, ["Important", important], { 1: { tint: COLOR.note }, 2: { tint: COLOR.note } }, false);
}
