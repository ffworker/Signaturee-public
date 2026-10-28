'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','..');
const html=fs.readFileSync(path.join(root,'frontend','admin.html'),'utf8');
const client=fs.readFileSync(path.join(root,'frontend','admin-v2.js'),'utf8');
const css=fs.readFileSync(path.join(root,'frontend','admin-compact.css'),'utf8');

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'Admin field IDs must be unique');
for(const id of ['templateStatus','templateStripChips','templateDetails','summaryTemplateState',
  'signatureCards','variableCards','saveProfileBtn','applyEnvConfigBtn',
  'previewPath','productionPath','ldapTestForm','ldapTestResult',
  'taskList','adSearchTestBtn','authUserList','signatureCardTemplate']){
  assert.ok(ids.includes(id),'Missing live UI control: '+id);
}
assert.ok(html.indexOf('class="template-overview"') < html.indexOf('data-view="overview"'),
  'Template health should be placed above the Admin views');
assert.ok(html.includes('<details class="compact-disclosure config-advanced">'));
assert.ok(html.includes('<details class="signature-editor">'));
assert.ok(html.includes('class="variable-cards"'));
assert.ok(html.includes('admin-compact.css'));

// Validate tag nesting for the static Admin HTML, including <template> content.
const open=[],voids=new Set(['area','base','br','col','embed','hr','img','input',
  'link','meta','param','source','track','wbr']);
for(const match of html.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)){
  const tag=match[1].toLowerCase();
  if(match[0].startsWith('</')){
    assert.equal(open.pop(),tag,'Mismatched closing HTML tag: '+tag);
  }else if(!voids.has(tag)&&!match[0].endsWith('/>'))open.push(tag);
}
assert.deepEqual(open,[],'Unclosed HTML tags');

assert.match(client,/templateStripChips\.innerHTML/);
assert.match(client,/templateDetails\.open=true/);
assert.match(client,/card\.querySelector\('\.variable-editor'\)\.open=true/);
assert.match(client,/profileSaveBar\.hidden=!dirty&&!envPendingRestart/);
assert.match(css,/html\[data-theme="dark"\]/,
  'Compact styling must support the shared dark theme');
// Accessibility and layout regressions from the Night Sky visual pass.
const theme=fs.readFileSync(path.join(root,'frontend','theme.css'),'utf8');
const generator=fs.readFileSync(path.join(root,'frontend','index.html'),'utf8');
assert.ok(html.includes('data-admin-view="onboarding">Onboarding / Check-Liste</button>'),
  'Onboarding menu must explicitly mention the checklist');
assert.ok(html.includes('<section class="step-card onboarding-flow">'),
  'The onboarding workflow must be visible without opening details');
assert.ok(!html.includes('<details class="compact-disclosure onboarding-flow">'),
  'Onboarding instructions must not be collapsed');
assert.match(client,/const section=\(heading,body\)=>/,
  'AD checklist sections should be directly visible, not disclosures');
assert.match(client,/section\('1\. Pflichtfelder im AD'/);
assert.match(client,/section\('2\. Signaturgruppen'/);
assert.match(theme,/html\[data-theme="dark"\] \.flow-status \{/,
  'Generator progress bar needs a dark surface');
assert.match(generator,/class="flow-status"/);
assert.match(theme,/html\[data-theme="dark"\] input\[type="checkbox"\]/,
  'Dark-mode checkbox contrast must be explicitly styled');
assert.match(css,/\.auth-user-row input\[type="checkbox"\]/,
  'Account active checkbox must have compact dimensions');
assert.match(css,/\.onboarding-checklist\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  'Onboarding checklist should use readable cards');
for(const id of ['authUserList','requiredVariablesOnly','adSearchTestBtn',
  'ldapTestForm','restartBackendBtn','saveProfileBtn']){
  assert.ok(ids.includes(id),'Functional UI element unexpectedly removed: '+id);
}
console.log('admin-ui-structure.test.js: ok');
