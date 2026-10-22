import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedPermitActions,
  effectivePermitStatus,
  normalizeVerificationCode,
  reminderTypeFor,
  renewalEligibility,
  validityDateError,
} from "../src/services/permit-lifecycle.rules";
import { renderPermitCertificate } from "../src/services/permit-certificate.pdf";

const today = "2026-10-21";

test("each permit status exposes only its legal KCCA actions", () => {
  assert.deepEqual(allowedPermitActions("under_review"), ["request_information", "approve", "reject"]);
  assert.deepEqual(allowedPermitActions("approved"), ["suspend", "renew", "update_activities"]);
  assert.deepEqual(allowedPermitActions("suspended"), ["reinstate", "renew"]);
  assert.deepEqual(allowedPermitActions("expired"), ["renew"]);
  assert.deepEqual(allowedPermitActions("rejected"), []);
});

test("an approved permit past its validity date is treated as expired", () => {
  assert.equal(effectivePermitStatus("approved", "2026-10-20", today), "expired");
  assert.equal(effectivePermitStatus("approved", today, today), "approved");
  assert.equal(effectivePermitStatus("suspended", "2026-01-01", today), "suspended");
  assert.equal(effectivePermitStatus("approved", null, today), "approved");
});

test("renewal opens 90 days before expiry and stays open after expiry", () => {
  assert.equal(renewalEligibility({ status: "approved", validUntil: "2027-03-01", hasOpenRequest: false }, today).eligible, false);
  const early = renewalEligibility({ status: "approved", validUntil: "2027-03-01", hasOpenRequest: false }, today);
  assert.equal(early.opensOn, "2026-12-01");
  assert.equal(renewalEligibility({ status: "approved", validUntil: "2027-01-19", hasOpenRequest: false }, today).eligible, true);
  assert.equal(renewalEligibility({ status: "expired", validUntil: "2026-09-01", hasOpenRequest: false }, today).eligible, true);
  assert.equal(renewalEligibility({ status: "approved", validUntil: "2026-09-01", hasOpenRequest: false }, today).eligible, true);
});

test("renewal is refused while suspended, while a request is open, or without a permit", () => {
  assert.match(renewalEligibility({ status: "suspended", validUntil: "2027-01-01", hasOpenRequest: false }, today).reason!, /suspended/);
  assert.match(renewalEligibility({ status: "approved", validUntil: "2026-11-01", hasOpenRequest: true }, today).reason!, /already waiting/);
  assert.match(renewalEligibility(null, today).reason!, /No KCCA permit/);
  assert.equal(renewalEligibility({ status: "rejected", validUntil: null, hasOpenRequest: false }, today).eligible, false);
});

test("a new validity date must be future, extend the permit and stay within five years", () => {
  assert.equal(validityDateError("2027-10-21", "2026-12-31", today), null);
  assert.match(validityDateError(today, null, today)!, /future/);
  assert.match(validityDateError("2026-12-01", "2026-12-31", today)!, /after the current expiry/);
  assert.match(validityDateError("2031-10-22", null, today)!, /at most 5 years/);
  assert.equal(validityDateError("2031-10-21", null, today), null);
  assert.match(validityDateError("2027-02-30x", null, today)!, /valid date/);
});

test("only the tightest reminder applies", () => {
  assert.equal(reminderTypeFor(61), null);
  assert.equal(reminderTypeFor(60), "expiry_60");
  assert.equal(reminderTypeFor(30), "expiry_30");
  assert.equal(reminderTypeFor(8), "expiry_30");
  assert.equal(reminderTypeFor(7), "expiry_7");
  assert.equal(reminderTypeFor(0), "expiry_7");
  assert.equal(reminderTypeFor(-1), null);
});

test("verification codes are normalized from how people type them", () => {
  assert.equal(normalizeVerificationCode("7f3a 91c2-b04e"), "7F3A-91C2-B04E");
  assert.equal(normalizeVerificationCode("7F3A91C2B04E"), "7F3A-91C2-B04E");
  assert.equal(normalizeVerificationCode("7F3A-91C2"), null);
  assert.equal(normalizeVerificationCode("ZZZZ-ZZZZ-ZZZZ"), null);
});

test("certificate PDF carries the activities, readable dates and a verification code", () => {
  const pdf = renderPermitCertificate({
    permit_number: "PERMIT-2026-0000001",
    company_name: "Example Collectors Ltd",
    registration_number: "REG-123",
    valid_from: "2026-01-01",
    valid_until: "2027-12-31",
    verification_code: "7F3A-91C2-B04E",
    activities: ["Household collection", "Transport to disposal site"],
  }).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.includes("(7F3A-91C2-B04E) Tj"));
  assert.ok(pdf.includes("Household collection"));
  assert.ok(pdf.includes("(31 December 2027) Tj"));
  assert.ok(pdf.includes(" re\n"), "QR modules are drawn");
});
