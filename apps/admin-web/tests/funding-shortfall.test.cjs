/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness for the transpiled TSX component. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = fs.readFileSync(path.join(__dirname, '../src/components/ui/FundingShortfall.tsx'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
});
const exportsObject = {};
vm.runInNewContext(outputText, { exports: exportsObject, require });
const render = (props) => renderToStaticMarkup(React.createElement(exportsObject.FundingShortfall, props));

test('approval displays the required amount, available funds and exact shortage', () => {
  const html = render({ amount: 6000000, available: 5000000, action: 'approval' });
  assert.match(html, /Approval blocked/);
  for (const amount of ['6,000,000', '5,000,000', '1,000,000']) assert.ok(html.includes(amount));
});
test('fully funded requests, including the exact boundary, show no warning', () => {
  assert.equal(render({ amount: 5000000, available: 5000000, action: 'approval' }), '');
  assert.equal(render({ amount: 2000000, available: 5000000, action: 'payment' }), '');
});
test('payment warning describes cash rather than approval commitments', () => {
  const html = render({ id: 'payment-help', amount: 5800000, available: 5000000, action: 'payment' });
  assert.match(html, /Payment blocked/);
  assert.match(html, /cash balance/);
  assert.match(html, /800,000/);
  assert.match(html, /id="payment-help"/);
});
test('negative available funds include the existing deficit in the shortage', () => {
  const html = render({ amount: 1000000, available: -2000000, action: 'approval' });
  assert.match(html, /-2,000,000/);
  assert.match(html, /Shortfall: UGX 3,000,000/);
});
