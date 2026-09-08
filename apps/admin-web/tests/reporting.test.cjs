/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness for TypeScript helper. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/reporting.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const exportsObject = {};
vm.runInNewContext(outputText, { exports: exportsObject });
const net = exportsObject.netCashMovement;
test('paid fleet expenses are not deducted twice', () => {
  assert.equal(net({ received: '100', operating_expenses: '25', supplier_payments: '0', fuel_cost: '25', maintenance_cost: '500' }), 75);
});
test('cash movement includes supplier payments and preserves deficits', () => {
  assert.equal(net({ received: '100', operating_expenses: '25', supplier_payments: '90' }), -15);
});
test('zero activity reports zero movement', () => {
  assert.equal(net({ received: '0', operating_expenses: '0', supplier_payments: '0' }), 0);
});
