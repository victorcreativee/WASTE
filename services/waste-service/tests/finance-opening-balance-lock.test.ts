import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migration=fs.readFileSync(path.resolve(__dirname,'../../../infrastructure/database/130_finance_opening_balance_lock.sql'),'utf8');
const expenses=fs.readFileSync(path.resolve(__dirname,'../src/repositories/expense.repository.ts'),'utf8');

test('the database refuses opening-balance changes after any real finance activity',()=>{
 for(const table of [
  'customer_payments','organization_expenses','supplier_payments','recycling_sale_payments',
  'recycling_purchase_payments','recycling_cash_movements','recycling_manager_float_transactions',
  'recycling_sorting_batches','recycling_material_sales',
 ]) assert.match(migration,new RegExp(`FROM ${table}`));
 assert.match(migration,/BEFORE UPDATE OF opening_balance_ugx,as_of_date/);
 assert.match(migration,/BEFORE DELETE ON organization_finance_settings/);
 assert.match(migration,/Opening balance is locked because financial activity has been recorded/);
});

test('the application lock includes cash movements, all float handovers and direct sale costs',()=>{
 const position=expenses.slice(expenses.indexOf('export async function findFinancialPosition'),expenses.indexOf('export async function setOpeningBalance'));
 const save=expenses.slice(expenses.indexOf('export async function setOpeningBalance'));
 for(const source of ['recycling_cash_movements','recycling_manager_float_transactions','recycling_material_sales']){
  assert.match(position,new RegExp(source));
  assert.match(save,new RegExp(source));
 }
 const lockClause=position.slice(position.indexOf('SELECT *, (opening_balance_configured'),position.indexOf('AS opening_balance_history'));
 assert.doesNotMatch(lockClause,/recycling_manager_float_transactions[^)]*transaction_type='spent'/);
});

test('only the explicit platform reset transaction can replace a locked baseline',()=>{
 assert.match(migration,/current_setting\('app\.allow_audit_reset', true\)='true'/);
});
