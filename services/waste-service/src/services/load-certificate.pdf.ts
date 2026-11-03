import QRCode from "qrcode";
import { env } from "../config/env";
import { ascii, assemblePdf } from "./permit-certificate.pdf";

// Load certificate (migration 115): one A4 page per completed weighbridge ticket, with a QR code to the public check.

export type CertificateLoad = {
  certificate_number: string; verification_code: string; organization_name: string; ticket_number: string;
  facility_name: string; facility_kind: string; registration: string; operation_date: string;
  gross_kg: string | number; tare_kg: string | number; net_kg: string | number; issued_at: string | Date;
  record_hash: string; revoked_at: string | Date | null; revoked_reason: string | null;
  composition: { name: string; share_pct: number }[] | null; composition_method: string | null;
};

const PAGE_W = 595;
const MARGIN = 56;
const KIND: Record<string, string> = {
  landfill: "Landfill disposal", transfer_station: "Transfer station", composting: "Composting (diverted from landfill)",
  materials_recovery: "Materials recovery (diverted from landfill)",
};
const kg = (value: string | number) => `${Number(value).toLocaleString("en-GB", { maximumFractionDigits: 2 })} kg`;
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const loadCertificateUrl = (code: string) => `${env.publicAppUrl}/l/${encodeURIComponent(code)}`;

export function renderLoadCertificate(c: CertificateLoad): Buffer {
  const ops: string[] = [];
  const text = (x: number, y: number, size: number, value: unknown, bold = false, gray = 0) =>
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${gray} g 1 0 0 1 ${x} ${y} Tm (${ascii(value)}) Tj ET`);
  const rule = (y: number) => ops.push(`0.8 G 0.75 w ${MARGIN} ${y} m ${PAGE_W - MARGIN} ${y} l S`);
  const field = (x: number, y: number, label: string, value: unknown) => {
    text(x, y, 9, label.toUpperCase(), true, 0.45);
    text(x, y - 16, 13, value);
  };

  ops.push(`0.16 0.32 0.8 rg 0 806 ${PAGE_W} 36 re f`);
  text(MARGIN, 818, 10, "KAMPALA CAPITAL CITY AUTHORITY", true, 1);
  text(PAGE_W - MARGIN - 130, 818, 9, "Urban Waste Management", false, 1);

  text(MARGIN, 752, 22, "Load Certificate", true);
  text(MARGIN, 730, 11, "Waste received and weighed at a KCCA disposal facility", false, 0.4);
  if (c.revoked_at) {
    ops.push(`0.75 0.1 0.1 rg ${PAGE_W - MARGIN - 120} 738 120 26 re f`);
    text(PAGE_W - MARGIN - 106, 747, 11, "REVOKED", true, 1);
  }
  rule(712);

  field(MARGIN, 684, "Certificate number", c.certificate_number);
  field(MARGIN + 250, 684, "Weighbridge ticket", c.ticket_number);
  field(MARGIN, 640, "Waste company", c.organization_name);
  field(MARGIN, 596, "Facility", c.facility_name);
  field(MARGIN + 250, 596, "Destination", KIND[c.facility_kind] ?? c.facility_kind);
  field(MARGIN, 552, "Date", day(c.operation_date));
  field(MARGIN + 250, 552, "Vehicle", c.registration);
  rule(528);

  field(MARGIN, 504, "Gross", kg(c.gross_kg));
  field(MARGIN + 165, 504, "Tare", kg(c.tare_kg));
  text(MARGIN + 330, 504, 9, "NET WASTE RECEIVED", true, 0.45);
  text(MARGIN + 330, 484, 18, kg(c.net_kg), true);
  rule(462);

  text(MARGIN, 438, 9, "COMPOSITION", true, 0.45);
  if (c.composition?.length) {
    const method = c.composition_method === "sample_sort" ? "sorted sample" : "visual estimate at the tipping face";
    text(MARGIN, 422, 9, `Recorded by KCCA: ${method}`, false, 0.4);
    c.composition.slice(0, 12).forEach((s, i) => {
      const x = MARGIN + (i % 2) * 250, y = 402 - Math.floor(i / 2) * 16;
      text(x, y, 11, `${s.name}`);
      text(x + 170, y, 11, `${Number(s.share_pct).toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`, true);
    });
  } else {
    text(MARGIN, 422, 11, "Not recorded for this load.", false, 0.3);
  }
  rule(296);
  if (c.revoked_at) {
    text(MARGIN, 276, 9, "REVOKED BECAUSE THE TICKET WAS VOIDED", true, 0.45);
    text(MARGIN, 260, 10, String(c.revoked_reason ?? "").slice(0, 95));
  }
  text(MARGIN, 236, 8, `Issued ${new Date(c.issued_at).toISOString().replace("T", " ").slice(0, 19)} UTC`, false, 0.45);
  text(MARGIN, 224, 7, `Record fingerprint (SHA-256): ${c.record_hash}`, false, 0.45);

  const url = loadCertificateUrl(c.verification_code);
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const size = qr.modules.size, cell = 3, quiet = 4 * cell, box = size * cell + quiet * 2;
  const x0 = MARGIN, y0 = 70;
  ops.push(`0.85 G 0.75 w ${x0 - 0.5} ${y0 - 0.5} ${PAGE_W - 2 * MARGIN + 1} ${box + 1} re S`);
  ops.push("0 g");
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.modules.get(row, col)) ops.push(`${x0 + quiet + col * cell} ${y0 + box - quiet - (row + 1) * cell} ${cell} ${cell} re`);
    }
  }
  ops.push("f");
  const tx = x0 + box + 16;
  text(tx, y0 + box - 26, 9, "CHECK THIS CERTIFICATE", true, 0.45);
  text(tx, y0 + box - 48, 16, c.verification_code, true);
  text(tx, y0 + box - 68, 9, "Scan the code to see the weighbridge record as KCCA holds it.", false, 0.35);
  text(tx, y0 + box - 82, 9, `${env.publicAppUrl}/l/${c.verification_code}`, false, 0.16);
  text(tx, y0 + box - 100, 8, "A voided ticket shows as revoked, even on an older printed copy.", false, 0.45);

  return assemblePdf(ops.join("\n"));
}
