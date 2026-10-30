'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../frontend');
const theme = fs.readFileSync(path.join(root, 'theme.js'), 'utf8');
function initialTheme(saved) {
  const document = { documentElement: {dataset: {}, style: {}}, addEventListener() {} };
  vm.runInNewContext(theme, { document, localStorage: { getItem: () => saved } });
  return document.documentElement.dataset.theme;
}
assert.equal(initialTheme(null), 'light', 'First visit should use warm paper, not Night Sky');
assert.equal(initialTheme('dark'), 'dark', 'Preserve an explicit saved dark preference');
assert.equal(initialTheme('light'), 'light');
const css = fs.readFileSync(path.join(root, 'ui-polish.css'), 'utf8');
assert.match(css, /--ui-paper:\s*#eeece2/i);
assert.ok(!css.includes('linear-gradient('), 'Product surfaces should not use decorative gradients');
assert.match(css, /prefers-reduced-motion/);
for (const name of ['index.html','admin.html','self-service.html','login.html']) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  assert.match(html, /class="skip-link" href="#main-content"/);
  assert.match(html, /id="main-content"/);
  assert.match(html, /class="product-masthead"/, name + ' must share the ink masthead');
  assert.match(html, /class="page-heading"/, name + ' must separate editorial page hierarchy from account controls');
}
assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'), /id="adSearchInput"[^>]*aria-label=/);
assert.match(fs.readFileSync(path.join(root,'admin.html'),'utf8'), /id="variableSearch"[^>]*aria-label=/);
console.log('product-design.test.js: ok');
