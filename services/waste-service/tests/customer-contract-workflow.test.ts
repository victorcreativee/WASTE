import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration=fs.readFileSync(path.resolve(__dirname,"../../../infrastructure/database/081_customer_contract_workflow.sql"),"utf8");
const repository=fs.readFileSync(path.resolve(__dirname,"../src/repositories/contract.repository.ts"),"utf8");
const validator=fs.readFileSync(path.resolve(__dirname,"../src/validators/contract.validator.ts"),"utf8");

test("customers receive stable human-readable numbers",()=>{
 assert.match(migration,/customer_number VARCHAR\(32\)/);
 assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_profiles_number/);
});

test("contract creation rejects overlapping terms and uses controlled numbers",()=>{
 assert.match(repository,/daterange\(existing\.starts_on,existing\.ends_on,'\[\]'\) && daterange/);
 assert.match(repository,/customer_contract_number_seq/);
 assert.match(validator,/endsOn>=value\.startsOn/);
});
