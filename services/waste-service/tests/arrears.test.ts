import assert from "node:assert/strict";
import test from "node:test";
import { arrearsListSchema, followUpSchema, planSchema } from "../src/validators/arrears.validator";
import { BUCKETS } from "../src/repositories/arrears.repository";

const later = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala" }).format(new Date(Date.now() + days * 86400000));

test("a promise to pay has an amount and a date that is not past; other outcomes have neither", () => {
  assert.ok(followUpSchema.safeParse({ channel: "call", outcome: "promise_to_pay", promisedAmountUgx: 20000, promisedOn: later(5) }).success);
  assert.ok(!followUpSchema.safeParse({ channel: "call", outcome: "promise_to_pay", promisedAmountUgx: 20000 }).success);
  assert.ok(!followUpSchema.safeParse({ channel: "call", outcome: "promise_to_pay", promisedAmountUgx: 20000, promisedOn: later(-2) }).success);
  assert.ok(!followUpSchema.safeParse({ channel: "call", outcome: "no_answer", promisedAmountUgx: 20000 }).success);
  assert.ok(followUpSchema.safeParse({ channel: "visit", outcome: "no_answer" }).success);
  assert.ok(!followUpSchema.safeParse({ channel: "visit", outcome: "disputed" }).success, "a dispute says what was disputed");
  assert.ok(!followUpSchema.safeParse({ channel: "whatsapp", outcome: "no_answer" }).success);
});

test("payment plans have 2 to 24 instalments of at least UGX 1,000, starting today or later", () => {
  const plan = { totalUgx: 150000, instalments: 3, frequency: "monthly", firstDueOn: later(10) };
  assert.ok(planSchema.safeParse(plan).success);
  assert.ok(!planSchema.safeParse({ ...plan, instalments: 1 }).success);
  assert.ok(!planSchema.safeParse({ ...plan, instalments: 25 }).success);
  assert.ok(!planSchema.safeParse({ ...plan, totalUgx: 1500 }).success);
  assert.ok(!planSchema.safeParse({ ...plan, firstDueOn: later(-1) }).success);
  assert.ok(!planSchema.safeParse({ ...plan, frequency: "daily" }).success);
});

test("only known age buckets reach the query", () => {
  assert.deepEqual(Object.keys(BUCKETS), ["all", "1_30", "31_60", "61_90", "over_90"]);
  assert.ok(!arrearsListSchema.safeParse({ bucket: "1=1" }).success);
  assert.deepEqual(arrearsListSchema.parse({}), { bucket: "all", page: 1, pageSize: 50 });
});
