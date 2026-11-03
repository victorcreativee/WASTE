import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migration=fs.readFileSync(path.resolve(__dirname,'../../../infrastructure/database/128_recycling_closed_day_finance_guards.sql'),'utf8');
const historyMigration=fs.readFileSync(path.resolve(__dirname,'../../../infrastructure/database/129_recycling_daily_closure_history.sql'),'utf8');
const expenses=fs.readFileSync(path.resolve(__dirname,'../src/repositories/expense.repository.ts'),'utf8');
const recycling=fs.readFileSync(path.resolve(__dirname,'../src/repositories/recycling.repository.ts'),'utf8');
const platformOrganizations=fs.readFileSync(path.resolve(__dirname,'../../auth-service/src/repositories/platform-organization.repository.ts'),'utf8');

test('closed recycling days protect every dated finance ledger at the database boundary',()=>{
 for(const table of ['recycling_cash_movements','recycling_loans','organization_expenses']){
  assert.match(migration,new RegExp(`WHEN '${table}'`));
  assert.match(migration,new RegExp(`prevent_closed_day_write ON %I`));
 }
 assert.match(migration,/BEFORE UPDATE OF[\s\S]*organization_expenses/);
 assert.match(migration,/status='closed'/);
});

test('expense lifecycle changes take the same close lock before the finance lock',()=>{
 const fn=expenses.slice(expenses.indexOf('export async function updateExpenseStatus'));
 assert.ok(fn.indexOf('FOR UPDATE')<fn.indexOf('assertRecyclingBusinessDayOpen'));
 assert.ok(fn.indexOf('assertRecyclingBusinessDayOpen')<fn.indexOf('finance:${organizationId}'));
});

test('a business day cannot close with unresolved expenses',()=>{
 const fn=recycling.slice(recycling.indexOf('export async function closeRecyclingDay'));
 assert.match(fn,/status NOT IN\('paid','void'\)/);
 assert.match(fn,/Complete or void them before closing the day/);
});

test('every close and reopen is preserved in append-only audit history',()=>{
 assert.match(historyMigration,/CREATE TABLE IF NOT EXISTS recycling_daily_closure_events/);
 assert.match(historyMigration,/BEFORE UPDATE OR DELETE ON recycling_daily_closure_events/);
 assert.match(historyMigration,/FOREIGN KEY \(actor_user_id, organization_id\) REFERENCES users\(id, organization_id\)/);
 const closeFn=recycling.slice(recycling.indexOf('export async function closeRecyclingDay'),recycling.indexOf('export async function reopenRecyclingDay'));
 const reopenFn=recycling.slice(recycling.indexOf('export async function reopenRecyclingDay'),recycling.indexOf('export async function assertPurchaseFunding'));
 assert.match(closeFn,/INSERT INTO recycling_daily_closure_events[\s\S]*'closed'/);
 assert.match(reopenFn,/INSERT INTO recycling_daily_closure_events[\s\S]*'reopened'/);
});

test('reopen takes the daily close lock before locking and changing the closure row',()=>{
 const fn=recycling.slice(recycling.indexOf('export async function reopenRecyclingDay'),recycling.indexOf('export async function assertPurchaseFunding'));
 assert.ok(fn.indexOf('pg_advisory_xact_lock')<fn.indexOf("status='closed' FOR UPDATE"));
 assert.ok(fn.indexOf("status='closed' FOR UPDATE")<fn.indexOf('recycling_daily_closure_events'));
});

test('only an explicit platform reset transaction can remove closure audit rows',()=>{
 assert.match(historyMigration,/TG_OP = 'DELETE'[\s\S]*app\.allow_audit_reset/);
 assert.match(historyMigration,/Daily closure audit history is append-only/);
 assert.match(platformOrganizations,/set_config\('app\.allow_audit_reset','true',true\)/);
});

