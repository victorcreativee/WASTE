import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

// Signing for the daily KCCA receipt exports (migration 111). Exports are signed with Ed25519 so KCCA, or anyone holding
// the public key, can check a file was produced by this platform and not changed since.
//
//   RECEIPT_SIGNING_KEY = base64 of a 32-byte Ed25519 seed. Required in production. Generate one with:
//     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Without it (development and tests) a fixed, publicly known development key is used and exports say so.

const DEV_SEED = Buffer.alloc(32, 7);
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export type SigningKey = { privateKey: KeyObject; publicKeyPem: string; keyId: string; development: boolean };

export function signingKeyFromSeed(seed: Buffer, development = false): SigningKey {
  if (seed.length !== 32) throw new Error("RECEIPT_SIGNING_KEY must be the base64 of exactly 32 bytes");
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const fingerprint = createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
  return { privateKey, publicKeyPem, keyId: `${development ? "dev-" : ""}ed25519-${fingerprint}`, development };
}

let cached: SigningKey | null = null;
export function receiptSigningKey(): SigningKey {
  if (cached) return cached;
  const configured = process.env.RECEIPT_SIGNING_KEY?.trim();
  cached = configured ? signingKeyFromSeed(Buffer.from(configured, "base64")) : signingKeyFromSeed(DEV_SEED, true);
  return cached;
}

export const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function signText(text: string, key: SigningKey = receiptSigningKey()) {
  return sign(null, Buffer.from(text, "utf8"), key.privateKey).toString("base64");
}

export function verifyText(text: string, signature: string, publicKeyPem: string) {
  try {
    return verify(null, Buffer.from(text, "utf8"), createPublicKey(publicKeyPem), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export type ExportReceipt = {
  serial_number: string; chain_position: number | string; issued_at: string | Date; collected_at: string | Date;
  customer_name: string; customer_phone: string | null; location_label: string; address: string; zone_name: string | null;
  collected_weight_kg: string | number | null; truck_plate: string | null; driver_name: string | null;
  previous_hash: string | null; record_hash: string;
};
export type ExportVoid = { serial_number: string; reason: string; voided_by_name: string; voided_at: string | Date };

const iso = (value: string | Date) => new Date(value).toISOString();

/**
 * The exact text of one operator's export for one Kampala day. Keys and arrays are always in the same order, so the same
 * ledger always produces the same bytes and therefore the same hash and signature.
 */
export function buildExportContent(input: {
  organization: { id: string; name: string; code: string }; date: string;
  receipts: ExportReceipt[]; voids: ExportVoid[]; chainHeadHash: string | null;
}) {
  const receipts = input.receipts.map(r => ({
    serial: r.serial_number, position: Number(r.chain_position), issuedAt: iso(r.issued_at), collectedAt: iso(r.collected_at),
    customer: r.customer_name, phone: r.customer_phone, location: r.location_label, address: r.address, zone: r.zone_name,
    weightKg: r.collected_weight_kg === null ? null : Number(r.collected_weight_kg), truck: r.truck_plate, driver: r.driver_name,
    previousHash: r.previous_hash, hash: r.record_hash,
  }));
  const voids = input.voids.map(v => ({ serial: v.serial_number, reason: v.reason, voidedBy: v.voided_by_name, voidedAt: iso(v.voided_at) }));
  return JSON.stringify({
    format: "kwms-collection-receipts/1",
    timezone: "Africa/Kampala",
    date: input.date,
    operator: input.organization,
    totals: { receipts: receipts.length, voids: voids.length },
    firstSerial: receipts[0]?.serial ?? null,
    lastSerial: receipts.at(-1)?.serial ?? null,
    chainHeadHash: input.chainHeadHash,
    receipts,
    voids,
  });
}

/** Serial formats KCCA may choose: operator code, year and a padded sequence are required; only letters, digits, - and _ besides. */
export function serialFormatError(format: string): string | null {
  if (!/^[A-Za-z0-9{}_-]{1,60}$/.test(format)) return "Use only letters, digits, - and _ besides the {TOKENS}, up to 60 characters";
  const unknown = (format.match(/\{[^}]*\}/g) ?? []).find(token => !/^\{(ORG|YYYY|YY|MM|DD|SEQ[4-9])\}$/.test(token));
  if (unknown) return `${unknown} is not a known token`;
  if (!format.includes("{ORG}")) return "Include {ORG}, the operator's code";
  if (!/\{(YYYY|YY)\}/.test(format)) return "Include the year, {YYYY} or {YY}: sequences restart every year";
  if ((format.match(/\{SEQ[4-9]\}/g) ?? []).length !== 1) return "Include exactly one sequence token, {SEQ4} to {SEQ9}";
  return null;
}

/** The serial a format produces, mirroring format_receipt_serial() in migration 111, for previews. */
export function previewSerial(format: string, code: string, at: Date, sequence: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(at).map(p => [p.type, p.value]));
  return format.replaceAll("{ORG}", code).replaceAll("{YYYY}", parts.year).replaceAll("{YY}", parts.year.slice(2))
    .replaceAll("{MM}", parts.month).replaceAll("{DD}", parts.day)
    .replace(/\{SEQ([4-9])\}/, (_, width) => String(sequence).padStart(Number(width), "0"));
}
