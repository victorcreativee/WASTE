import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { buildExportContent, previewSerial, serialFormatError, sha256Hex, signText, signingKeyFromSeed, verifyText } from "../src/services/receipt-signing";
import { formatMessage } from "../src/services/notification-delivery";
import { operatorCodeSchema, receiptListQuerySchema } from "../src/validators/receipt.validator";

const receipt = {
  serial_number: "NJC-2026-0000001", chain_position: "1", issued_at: "2026-10-31T11:25:00.123Z", collected_at: "2026-10-31T11:25:00.100Z",
  customer_name: "Sarah Namata", customer_phone: "0772123456", location_label: "Home", address: "Plot 4, Kisenyi Rd", zone_name: "Kisenyi",
  collected_weight_kg: "42.50", truck_plate: "UBA 123X", driver_name: "Moses Driver", previous_hash: null, record_hash: "a".repeat(64),
};
const exportInput = {
  organization: { id: "11111111-1111-1111-1111-111111111111", name: "Nabugabo Joint Cleaners Ltd", code: "NJC" }, date: "2026-10-31",
  receipts: [receipt], voids: [{ serial_number: "NJC-2026-0000001", reason: "Duplicate stop", voided_by_name: "Admin", voided_at: new Date("2026-10-31T12:00:00Z") }],
  chainHeadHash: "a".repeat(64),
};

test("the same ledger always produces the same export bytes", () => {
  const first = buildExportContent(exportInput), second = buildExportContent(structuredClone(exportInput));
  assert.equal(first, second);
  const parsed = JSON.parse(first);
  assert.equal(parsed.format, "kwms-collection-receipts/1");
  assert.deepEqual(parsed.totals, { receipts: 1, voids: 1 });
  assert.equal(parsed.receipts[0].weightKg, 42.5);
  assert.equal(parsed.firstSerial, "NJC-2026-0000001");
});

test("a signed export verifies with the public key and fails after any change", () => {
  const key = signingKeyFromSeed(randomBytes(32));
  const content = buildExportContent(exportInput), signature = signText(content, key);
  assert.ok(verifyText(content, signature, key.publicKeyPem));
  assert.ok(!verifyText(content.replace("42.5", "4.5"), signature, key.publicKeyPem));
  assert.ok(!verifyText(content, signature, signingKeyFromSeed(randomBytes(32)).publicKeyPem), "another key's signature is rejected");
  assert.ok(!verifyText(content, "not-a-signature", key.publicKeyPem));
  assert.equal(sha256Hex(content).length, 64);
});

test("signing keys are stable for a seed and the development key is labelled", () => {
  const seed = randomBytes(32);
  assert.equal(signingKeyFromSeed(seed).keyId, signingKeyFromSeed(Buffer.from(seed)).keyId);
  assert.match(signingKeyFromSeed(Buffer.alloc(32, 7), true).keyId, /^dev-ed25519-[0-9a-f]{16}$/);
  assert.throws(() => signingKeyFromSeed(randomBytes(16)), /exactly 32 bytes/);
});

test("serial formats must keep serials unique and URL-safe", () => {
  assert.equal(serialFormatError("{ORG}-{YYYY}-{SEQ7}"), null);
  assert.equal(serialFormatError("KCCA-{ORG}{YY}{MM}-{SEQ6}"), null);
  assert.match(serialFormatError("{YYYY}-{SEQ7}") ?? "", /\{ORG\}/);
  assert.match(serialFormatError("{ORG}-{SEQ7}") ?? "", /year/);
  assert.match(serialFormatError("{ORG}-{YYYY}") ?? "", /sequence/);
  assert.match(serialFormatError("{ORG}-{YYYY}-{SEQ3}") ?? "", /not a known token/);
  assert.match(serialFormatError("{ORG}/{YYYY}/{SEQ7}") ?? "", /letters, digits/);
  assert.match(serialFormatError("{ORG}-{YYYY}-{SEQ5}-{SEQ5}") ?? "", /exactly one/);
});

test("serial previews use the Kampala date and pad the sequence", () => {
  // 31 Dec 22:30 UTC is already 1 January in Kampala (UTC+3).
  assert.equal(previewSerial("{ORG}-{YYYY}-{SEQ7}", "NJC", new Date("2026-12-31T22:30:00Z"), 42), "NJC-2027-0000042");
  assert.equal(previewSerial("KCCA{YY}{MM}{DD}-{ORG}-{SEQ4}", "GK", new Date("2026-10-31T09:00:00Z"), 123456), "KCCA261031-GK-123456");
});

test("operator codes are upper-cased and limited to 2-8 letters or digits", () => {
  assert.equal(operatorCodeSchema.parse({ code: " njc " }).code, "NJC");
  assert.ok(!operatorCodeSchema.safeParse({ code: "N" }).success);
  assert.ok(!operatorCodeSchema.safeParse({ code: "NJC-1" }).success);
});

test("receipt list dates must be in order", () => {
  assert.ok(receiptListQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success);
  assert.ok(!receiptListQuerySchema.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success);
});

test("receipt SMS carry the receipt link", () => {
  const sms = formatMessage("sms", { category: "household", title: "Collection receipt", link: "/r/NJC-2026-0000001",
    body: "Nabugabo Joint Cleaners Ltd: waste collected 31 Oct 2026 14:25 at Home, 42.5 kg. Receipt NJC-2026-0000001." }, "https://kampalawms.com");
  assert.ok(sms.text.endsWith(" https://kampalawms.com/r/NJC-2026-0000001"));
  assert.ok(sms.text.length <= 306);
});
