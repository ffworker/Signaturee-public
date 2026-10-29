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
