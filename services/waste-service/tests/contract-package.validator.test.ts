import assert from "node:assert/strict";
import test from "node:test";

import { createServicePlanSchema, recordOrganizationPaymentSchema, updateServicePlanStatusSchema, updateSubscriptionStatusSchema } from "../src/validators/billing.validator";
import { contractSchema } from "../src/validators/contract.validator";

const uuidA="11111111-1111-4111-8111-111111111111";
const uuidB="22222222-2222-4222-8222-222222222222";

test("service package requires price and service-level commitments",()=>{
  const result=createServicePlanSchema.parse({name:"Residential standard",billingFrequency:"monthly",feeUgx:45000,collectionsPerPeriod:4,responseHours:24});
  assert.equal(result.collectionsPerPeriod,4);
  assert.equal(result.responseHours,24);
  assert.throws(()=>createServicePlanSchema.parse({name:"Incomplete",billingFrequency:"monthly",feeUgx:45000}));
});

test("contract accepts package assignment and rejects manual pricing fields",()=>{
  const result=contractSchema.parse({customerId:uuidA,planId:uuidB,startsOn:"2026-09-01",endsOn:"2027-08-31"});
  assert.equal(result.planId,uuidB);
  assert.throws(()=>contractSchema.parse({customerId:uuidA,startsOn:"2026-09-01",endsOn:"2027-08-31",contractValueUgx:1}));
});

test("package lifecycle accepts only an explicit boolean state",()=>{
  assert.deepEqual(updateServicePlanStatusSchema.parse({isActive:false}),{isActive:false});
  assert.throws(()=>updateServicePlanStatusSchema.parse({isActive:"false"}));
});

test("subscription lifecycle allows controlled service states only",()=>{
  for(const status of ["active","suspended","cancelled"]){
    assert.equal(updateSubscriptionStatusSchema.parse({status}).status,status);
  }
  assert.throws(()=>updateSubscriptionStatusSchema.parse({status:"deleted"}));
  assert.throws(()=>updateSubscriptionStatusSchema.parse({status:"pending"}));
});

test("organization payment requires a traceable supported method",()=>{
  const payment=recordOrganizationPaymentSchema.parse({invoiceId:uuidA,amountUgx:12000,provider:"bank_transfer",providerReference:"BANK-28491"});
  assert.equal(payment.amountUgx,12000);
  assert.throws(()=>recordOrganizationPaymentSchema.parse({invoiceId:uuidA,amountUgx:12000,provider:"unknown",providerReference:"REF-1"}));
  assert.throws(()=>recordOrganizationPaymentSchema.parse({invoiceId:uuidA,amountUgx:12000,provider:"cash",providerReference:""}));
});
