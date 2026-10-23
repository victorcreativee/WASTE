import assert from "node:assert/strict";
import test from "node:test";
import { dateOnly } from "../src/utils/date-only";

test("dateOnly reads a DATE column value as its local calendar day", () => {
  // node-postgres builds DATE values at local midnight on the server.
  assert.equal(dateOnly(new Date(2026, 9, 23)), "2026-10-23");
  assert.equal(dateOnly(new Date(2026, 0, 5)), "2026-01-05");
});

test("dateOnly keeps ISO strings and tolerates empty values", () => {
  assert.equal(dateOnly("2026-10-23"), "2026-10-23");
  assert.equal(dateOnly("2026-10-23T09:15:00.000Z"), "2026-10-23");
  assert.equal(dateOnly(null), "");
  assert.equal(dateOnly(new Date("not a date")), "");
});
