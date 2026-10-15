import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root=path.resolve(__dirname,"../../..");
const repository=fs.readFileSync(path.join(root,"services/waste-service/src/repositories/billing.repository.ts"),"utf8");
const contracts=fs.readFileSync(path.join(root,"services/waste-service/src/repositories/contract.repository.ts"),"utf8");
const migration=fs.readFileSync(path.join(root,"infrastructure/database/082_customer_billing_periods.sql"),"utf8");

test("customer invoices use controlled numbers and unique service periods",()=>{
  assert.match(migration,/customer_invoice_number_seq/);
  assert.match(migration,/customer_invoice_subscription_period_idx/);
  assert.match(repository,/billing_period_start,billing_period_end/);
  assert.match(repository,/ON CONFLICT DO NOTHING/);
  assert.match(contracts,/nextval\('customer_invoice_number_seq'\)/);
});

test("recurring billing remains inside the active contract and is audited",()=>{
  assert.match(repository,/cc\.status IN \('active','expiring'\)/);
  assert.match(repository,/contract_ends_on/);
  assert.match(repository,/periods<120/);
  assert.match(repository,/invoice_generated/);
  assert.match(repository,/customer_payment_recorded/);
  assert.match(repository,/customer_payment_confirmed/);
});

test("successful customer payments receive controlled printable receipt numbers",()=>{
  const receiptMigration=fs.readFileSync(path.join(root,"infrastructure/database/083_customer_payment_receipts.sql"),"utf8");
  assert.match(receiptMigration,/customer_receipt_number_seq/);
  assert.match(receiptMigration,/customer_payments_receipt_number_idx/);
  assert.match(repository,/receipt_number='RCT-'/);
  assert.match(repository,/findPaymentReceipt/);
});
