import assert from "node:assert/strict";
import test from "node:test";
import {supplierBillSchema,supplierPaymentSchema} from "../src/validators/payables.validator";

const supplierId="11111111-1111-4111-8111-111111111111";

test("supplier bill requires a valid invoice and due-date sequence",()=>{
  const bill=supplierBillSchema.parse({billNumber:"SUP-100",supplierId,description:"Truck tyres",amountUgx:800000,issuedOn:"2026-09-01",dueOn:"2026-09-30"});
  assert.equal(bill.amountUgx,800000);
  assert.throws(()=>supplierBillSchema.parse({...bill,dueOn:"2026-08-31"}));
});

test("traceable supplier payment methods require a reference",()=>{
  assert.equal(supplierPaymentSchema.parse({amountUgx:100000,paymentMethod:"bank_transfer",reference:"BANK-4421",paidOn:"2026-09-01"}).reference,"BANK-4421");
  assert.throws(()=>supplierPaymentSchema.parse({amountUgx:100000,paymentMethod:"bank_transfer",paidOn:"2026-09-01"}));
  assert.equal(supplierPaymentSchema.parse({amountUgx:100000,paymentMethod:"cash",paidOn:"2026-09-01"}).paymentMethod,"cash");
});
