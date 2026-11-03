import assert from "node:assert/strict";
import test from "node:test";
import { baselineRangeSchema, certificateCodeSchema, compositionSchema, factorSetSchema, loadListSchema } from "../src/validators/landfill.validator";
import { renderLoadCertificate } from "../src/services/load-certificate.pdf";

test("a composition adds up to 100% and a sorted sample has a weight", () => {
  assert.ok(compositionSchema.safeParse({ method: "visual_estimate", shares: { food_organic: 70, plastics: 30 } }).success);
  assert.ok(compositionSchema.safeParse({ method: "visual_estimate", shares: { food_organic: 33.33, plastics: 33.33, paper: 33.34 } }).success);
  assert.ok(!compositionSchema.safeParse({ method: "visual_estimate", shares: { food_organic: 70, plastics: 20 } }).success, "90% is refused");
  assert.ok(!compositionSchema.safeParse({ method: "visual_estimate", shares: {} }).success);
  assert.ok(!compositionSchema.safeParse({ method: "visual_estimate", shares: { "food; drop": 100 } }).success, "stream codes are plain");
  assert.ok(!compositionSchema.safeParse({ method: "visual_estimate", shares: { food_organic: 110, plastics: -10 } }).success);
  assert.ok(!compositionSchema.safeParse({ method: "sample_sort", shares: { food_organic: 100 } }).success);
  assert.ok(compositionSchema.safeParse({ method: "sample_sort", sampleKg: 80, shares: { food_organic: 100 } }).success);
});

test("factor versions keep fractions in range and an assumed mix of 100%", () => {
  const base = { methodology: "IPCC 2006 defaults", docf: 0.5, mcf: 1, methaneFraction: 0.5, oxidation: 0.1, gwpCh4: 28, changeSummary: "Engineered site",
    streams: { food_organic: { doc: 0.15, defaultSharePct: 80 }, plastics: { doc: 0, defaultSharePct: 20 } } };
  assert.ok(factorSetSchema.safeParse(base).success);
  assert.ok(!factorSetSchema.safeParse({ ...base, mcf: 1.2 }).success);
  assert.ok(!factorSetSchema.safeParse({ ...base, oxidation: 1 }).success);
  assert.ok(!factorSetSchema.safeParse({ ...base, streams: { food_organic: { doc: 0.15, defaultSharePct: 80 } } }).success);
  assert.ok(!factorSetSchema.safeParse({ ...base, changeSummary: "" }).success);
});

test("periods and codes are checked", () => {
  assert.ok(baselineRangeSchema.safeParse({ from: "2026-01", to: "2026-10" }).success);
  assert.ok(!baselineRangeSchema.safeParse({ from: "2026-10", to: "2026-01" }).success);
  assert.ok(!baselineRangeSchema.safeParse({ from: "2026-13", to: "2026-12" }).success);
  assert.ok(loadListSchema.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success);
  assert.ok(!loadListSchema.safeParse({ from: "2026-01-01", to: "2026-10-31" }).success, "at most three months of loads");
  assert.equal(certificateCodeSchema.parse("b8ed-8cea-6473"), "B8ED-8CEA-6473");
  assert.ok(!certificateCodeSchema.safeParse("B8ED8CEA6473' OR 1=1").success);
});

test("a load certificate is a one-page PDF that says when it is revoked", () => {
  const load = { certificate_number: "LC-2026-000001", verification_code: "B8ED-8CEA-6473", organization_name: "Nabugabo (Joint) Cleaners",
    ticket_number: "LF-1", facility_name: "Buyala", facility_kind: "landfill", registration: "UAX 101A", operation_date: "2026-10-05",
    gross_kg: "14000", tare_kg: "6000", net_kg: "8000", issued_at: "2026-10-31T17:48:08.998Z", record_hash: "ab".repeat(32),
    revoked_at: null, revoked_reason: null, composition: [{ name: "Food and organic", share_pct: 60 }], composition_method: "sample_sort" };
  const pdf = renderLoadCertificate(load).toString("latin1");
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\/Count 1/);
  assert.match(pdf, /Nabugabo \\\(Joint\\\) Cleaners/, "brackets are escaped");
  assert.doesNotMatch(pdf, /REVOKED/);
  assert.match(renderLoadCertificate({ ...load, revoked_at: "2026-10-31T18:00:00Z", revoked_reason: "Duplicate" }).toString("latin1"), /REVOKED/);
});
