import test from "node:test";
import assert from "node:assert/strict";
import { createExpenseSchema, dailyExpenseBatchSchema } from "../src/validators/expense.validator";

const baseExpense = {
  description: "Field team operating expense",
  amountUgx: 25_000,
  expenseDate: "2026-10-29",
};

test("daily operating expense categories are accepted", () => {
  for (const category of ["food", "transport", "worker_credit", "daily_wages"] as const) {
    const parsed = createExpenseSchema.parse({ ...baseExpense, category });
    assert.equal(parsed.category, category);
  }
});

test("unknown expense categories remain rejected", () => {
  assert.throws(() => createExpenseSchema.parse({ ...baseExpense, category: "personal_spending" }));
});

test("one daily expense sheet preserves each category, amount and person", () => {
  const parsed=dailyExpenseBatchSchema.parse({expenseDate:"2026-10-29",reference:"DAY-20261029",lines:[
    {category:"food",description:"Lunch for sorting team",vendor:"Sorting team",amountUgx:45_000},
    {category:"transport",description:"Workers transport home",vendor:"Alex",amountUgx:30_000},
  ]});
  assert.equal(parsed.lines.length,2);
  assert.equal(parsed.lines[1].vendor,"Alex");
});

test("daily expense sheet refuses empty and invalid lines", () => {
  assert.throws(()=>dailyExpenseBatchSchema.parse({expenseDate:"2026-10-29",lines:[]}));
  assert.throws(()=>dailyExpenseBatchSchema.parse({expenseDate:"2026-10-29",lines:[{category:"food",description:"x",amountUgx:0}]}));
});
