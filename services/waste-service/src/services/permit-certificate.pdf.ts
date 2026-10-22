import QRCode from "qrcode";
import { env } from "../config/env";

// Single-page A4 permit certificate written as raw PDF (no rendering engine needed in the container).

type CertificatePermit = {
  permit_number: string;
  company_name: string;
  registration_number: string;
  valid_from: string | Date | null;
  valid_until: string | Date | null;
  approved_by_name?: string | null;
  verification_code?: string | null;
  activities?: string[] | null;
};

const PAGE_W = 595;
const MARGIN = 56;

function ascii(value: unknown) {
  return String(value ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, " ").replace(/[()\\]/g, c => `\\${c}`);
}

function formatDate(value: string | Date | null) {
  if (!value) return "No expiry";
  const iso = value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : String(value).slice(0, 10);
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function verificationUrl(code: string) {
  return `${env.publicAppUrl}/verify?code=${encodeURIComponent(code)}`;
}

export function renderPermitCertificate(permit: CertificatePermit): Buffer {
  const ops: string[] = [];
  const text = (x: number, y: number, size: number, value: unknown, bold = false, gray = 0) =>
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${gray} g 1 0 0 1 ${x} ${y} Tm (${ascii(value)}) Tj ET`);
  const rule = (y: number, gray = 0.8) => ops.push(`${gray} G 0.75 w ${MARGIN} ${y} m ${PAGE_W - MARGIN} ${y} l S`);

  // Header band
  ops.push(`0.16 0.32 0.8 rg 0 806 ${PAGE_W} 36 re f`);
  text(MARGIN, 818, 10, "KAMPALA CAPITAL CITY AUTHORITY", true, 1);
  text(PAGE_W - MARGIN - 130, 818, 9, "Urban Waste Management", false, 1);

  text(MARGIN, 752, 22, "Waste Management Permit", true);
  text(MARGIN, 730, 11, "Certificate of authorization issued under KCCA solid waste regulation", false, 0.4);
  rule(712);

  const field = (y: number, label: string, value: unknown) => {
    text(MARGIN, y, 9, label.toUpperCase(), true, 0.45);
    text(MARGIN, y - 16, 13, value);
  };
  field(684, "Permit number", permit.permit_number);
  field(640, "Licensed company", permit.company_name);
  field(596, "Company registration number", permit.registration_number);
  text(MARGIN, 552, 9, "VALID FROM", true, 0.45);
  text(MARGIN, 536, 13, formatDate(permit.valid_from));
  text(MARGIN + 220, 552, 9, "VALID UNTIL", true, 0.45);
  text(MARGIN + 220, 536, 13, formatDate(permit.valid_until));
  rule(512);

  text(MARGIN, 488, 9, "AUTHORIZED ACTIVITIES", true, 0.45);
  const activities = permit.activities?.length ? permit.activities : ["As described in the approved permit application"];
  activities.slice(0, 8).forEach((activity, index) => text(MARGIN + 10, 468 - index * 18, 11, `-  ${activity}`));
  const afterActivities = 468 - Math.min(activities.length, 8) * 18 - 8;
  rule(afterActivities);

  const legalTop = afterActivities - 24;
  [
    "This permit authorizes only the activities listed above within the divisions KCCA has assigned.",
    "It is not transferable. KCCA may suspend or revoke it for non-compliance.",
    "Platform account activation is a separate decision by the System Administrator.",
  ].forEach((line, index) => text(MARGIN, legalTop - index * 15, 9, line, false, 0.35));
  text(MARGIN, legalTop - 60, 9, "APPROVED BY", true, 0.45);
  text(MARGIN, legalTop - 76, 11, permit.approved_by_name || "Kampala Capital City Authority");

  // Verification block with QR code
  if (permit.verification_code) {
    const url = verificationUrl(permit.verification_code);
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
    text(tx, y0 + box - 26, 9, "VERIFY THIS CERTIFICATE", true, 0.45);
    text(tx, y0 + box - 48, 16, permit.verification_code, true);
    text(tx, y0 + box - 68, 9, "Scan the code, or enter the verification code at:", false, 0.35);
    text(tx, y0 + box - 82, 9, `${env.publicAppUrl}/verify`, false, 0.16);
    text(tx, y0 + box - 100, 8, "The page shows the permit's live status, so a suspended or expired", false, 0.45);
    text(tx, y0 + box - 111, 8, "permit is reported as such even on an older printed copy.", false, 0.45);
  }

  const stream = ops.join("\n");
  const objects = [
    "",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n `).join("\n")}\n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
