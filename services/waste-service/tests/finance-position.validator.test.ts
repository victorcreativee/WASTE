import assert from "node:assert/strict";
import test from "node:test";
import {openingBalanceSchema} from "../src/validators/expense.validator";

test("opening cash balance requires a non-negative amount and accounting date",()=>{
  assert.deepEqual(openingBalanceSchema.parse({openingBalanceUgx:2500000,asOfDate:"2026-09-01"}),{openingBalanceUgx:2500000,asOfDate:"2026-09-01"});
  assert.throws(()=>openingBalanceSchema.parse({openingBalanceUgx:-1,asOfDate:"2026-09-01"}));
  assert.throws(()=>openingBalanceSchema.parse({openingBalanceUgx:0,asOfDate:"not-a-date"}));
});
