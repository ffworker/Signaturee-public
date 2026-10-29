'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','..');
const uiDir=path.join(root,'frontend');
const css=fs.readFileSync(path.join(uiDir,'ui-polish.css'),'utf8');
const generator=fs.readFileSync(path.join(uiDir,'generate-v2.js'),'utf8');
const generatorHtml=fs.readFileSync(path.join(uiDir,'index.html'),'utf8');

for(const name of ['index.html','admin.html','login.html','self-service.html']){
  const html=fs.readFileSync(path.join(uiDir,name),'utf8');
  const tag='<link rel="stylesheet" href="ui-polish.css">';
  assert.equal(html.split(tag).length,2,name+' must include exactly one modern UI stylesheet');
  assert.ok(html.indexOf(tag)>html.indexOf('<link rel="stylesheet" href="theme.css">'),
    name+' must load UI polish after the Night Sky theme');
}
assert.match(css,/html\[data-theme="dark"\] \.preflight-panel :is\(\.preflight-overall\.ok,\.preflight-chip\.ok\)/);
assert.match(css,/html\[data-theme="dark"\] \.preflight-panel :is\(\.preflight-overall\.bad,\.preflight-chip\.bad\)/);
assert.match(css,/html\[data-theme="dark"\] \.preflight-panel \.preflight-chip\.warn/);
assert.match(css,/html\[data-theme="dark"\] \.preflight-user-row span/);
assert.match(css,/html\[data-theme="dark"\] \.preflight-details>summary/);
assert.match(css,/html\[data-theme="dark"\] \.preview-variable-head code/);
assert.match(css,/html\[data-theme="dark"\] \.preview-variable-source/);
assert.match(css,/html\[data-theme="dark"\] \.preview-text-details pre/);
assert.match(css,/html\[data-theme="dark"\] \.preview-canvas/);
assert.match(generatorHtml,/id="previewSurface"/);
assert.match(generator,/attachShadow\(\{mode:'open'\}\)/,
  'Isolate the actual Outlook rendering from app CSS');
assert.match(generator,/function setStatusTone\(element,tone/);
assert.match(generator,/setStatusTone\(previewStatus,'success'\)/);
assert.match(generator,/setStatusTone\(previewStatus,'error'\)/);
assert.match(generator,/setStatusTone\(preflightHint,body\.ok\?'success':'error'\)/);
for (const id of ['runStateIcon','runStateTitle','runProgress','runProgressLabel',
  'runTechnicalDetails','runTechnicalLog']) {
  assert.ok(generatorHtml.includes('id="' + id + '"'), 'Missing live generation control: ' + id);
}
assert.match(generator,/\/api\/run\/generate\/stream/,
  'Generation must request the streaming API rather than waiting for a complete JSON response');
assert.match(generator,/consumeGenerationStream\(response, handleEvent\)/,
  'The streamed NDJSON must update the result panel continuously');
assert.match(generator,/Created Outlook signatures for user/,
  'Progress must reflect successful generator output, not a fake timer');
// Exercise the existing terminal renderer with split streaming chunks, without a browser.
const vm = require('node:vm');
const helpers = generator.match(/\/\/ Render log fragments[\s\S]*?(?=generateBtn\.addEventListener)/);
assert.ok(helpers, 'Live terminal renderer must exist');
const documentMock = {
  createElement: tagName => ({
    tagName, className: '', textContent: '', children: [],
    append(...nodes) { this.children.push(...nodes); },
  }),
  createTextNode: text => ({ textContent: text }),
};
const { createTerminalLogWriter } = vm.runInNewContext(
  helpers[0] + '\n({createTerminalLogWriter})',
  { document: documentMock },
);
const terminal = {
  children: [], scrollTop: 0, scrollHeight: 20,
  append(...nodes) { this.children.push(...nodes); },
};
const writer = createTerminalLogWriter(terminal);
writer.write('[2026-10-29 09:50:05] [INFO] Signature', 'stdout');
assert.equal(terminal.children.length, 0, 'Never render partial terminal lines');
writer.write(' done\n[2026-10-29 09:50:06] [WARNING] Word issue\n', 'stdout');
writer.write('[2026-10-29 09:50:07] [ERROR] Error <script>\n', 'stderr');
writer.flush();
const rows = terminal.children.filter(node => node.tagName === 'span');
assert.equal(rows.length, 3);
assert.ok(rows[0].children.some(node => node.className === 'terminal-level terminal-level-info'));
assert.ok(rows[1].children.some(node => node.className === 'terminal-level terminal-level-warning'));
assert.ok(rows[2].children.some(node => node.className === 'terminal-level terminal-level-error'));
assert.ok(rows[2].children.some(node => node.textContent === ' Error <script>'),
  'Untrusted log content must stay literal text, never HTML');
// Verify actual HTML/TXT replacement logs, split stdout and untrusted values.
const flatten = node => node.children?.length ? node.children.map(flatten).join('') : node.textContent;
writer.write('[2026-10-29 09:50:08] [INFO] Replaced $description with IT-', 'stdout');
writer.write('Systemadministrator\n[2026-10-29 09:50:09] [INFO] Replaced (TXT) $mail with \'x@y.de\'\n', 'stdout');
writer.write('[2026-10-29 09:50:10] [WARNING] Unresolved $mobile <img onerror=x>\n', 'stdout');
const replacements = terminal.children.filter(node => node.tagName === 'span').slice(3);
assert.equal(replacements.length, 3);
assert.equal(flatten(replacements[0]),
  '[2026-10-29 09:50:08] [INFO] Replaced $description with IT-Systemadministrator');
assert.ok(replacements[0].children.some(node =>
  node.className === 'terminal-variable' && node.textContent === '$description'));
assert.ok(replacements[0].children.some(node =>
  node.className === 'terminal-replacement' && node.textContent === 'IT-Systemadministrator'));
assert.equal(flatten(replacements[1]),
  "[2026-10-29 09:50:09] [INFO] Replaced (TXT) $mail with 'x@y.de'");
assert.ok(replacements[1].children.some(node =>
  node.className === 'terminal-replacement' && node.textContent === 'x@y.de'));
assert.ok(replacements[2].children.some(node =>
  node.className === 'terminal-variable' && node.textContent === '$mobile'));
assert.equal(flatten(replacements[2]),
  '[2026-10-29 09:50:10] [WARNING] Unresolved $mobile <img onerror=x>');
const generatorCss = fs.readFileSync(path.join(uiDir,'generate-v2.css'),'utf8');
for (const highlight of ['terminal-variable','terminal-replacement']) {
  assert.ok(generatorCss.includes('.' + highlight), 'Missing replacement highlight: ' + highlight);
}
for (const level of ['info','warning','error']) {
  assert.ok(generatorCss.includes('.terminal-level-' + level), 'Missing terminal color: ' + level);
}
assert.ok(!generator.includes('runTechnicalLog.innerHTML'),
  'Do not interpolate PowerShell logs into HTML');
assert.ok(!css.includes('::file-selector-button)'),
  'Pseudo-elements cannot appear inside :is() selectors');
let depth=0;
const stripped=css.replace(/\/\*[\s\S]*?\*\//g,'').replace(/"(?:[^"\\]|\\.)*"/g,'');
for(const ch of stripped){
  if(ch==='{')depth++;
  else if(ch==='}'){depth--;assert.ok(depth>=0,'CSS closing brace without opening brace');}
}
assert.equal(depth,0,'CSS blocks must be balanced');
console.log('ui-polish.test.js: ok');
