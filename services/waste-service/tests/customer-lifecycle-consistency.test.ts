import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const customers=fs.readFileSync(path.resolve(__dirname,"../src/repositories/customer-service.repository.ts"),"utf8");
const contracts=fs.readFileSync(path.resolve(__dirname,"../src/repositories/contract.repository.ts"),"utf8");

test("customer suspension also pauses contract and subscription",()=>{
 assert.match(customers,/UPDATE customer_subscriptions SET status=\$3/);
 assert.match(customers,/UPDATE customer_contracts SET status=\$3/);
 assert.match(customers,/service_status_changed/);
});

test("expired contracts close billing and activation respects the service lifecycle",()=>{
 assert.match(contracts,/UPDATE customer_subscriptions SET status='cancelled'/);
 assert.match(contracts,/cannot be activated before its start date/);
 assert.match(contracts,/Activate the customer service relationship/);
 assert.match(contracts,/contract_status_changed/);
});
