'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createSignaturePair,validateSignatureKey,validateSignatureFiles}=require('../signature-create');
const {discoverSignatureProfiles}=require('../signature-discovery');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'signaturee-create-'));
  const html=Buffer.from('<p>$givenname $sn</p>');
  const txt=Buffer.from('$givenname $sn\r\n');
  const files=[
    {name:'html',filename:'anything.html',data:html},
    {name:'txt',filename:'anything.txt',data:txt}
  ];
  try{
    assert.throws(()=>validateSignatureKey('../evil'),/Signatur-Kürzel/);
    assert.throws(()=>validateSignatureKey('example'),/reserviert/);
    assert.throws(()=>validateSignatureFiles([files[0]]),/genau eine/);
    assert.throws(()=>validateSignatureFiles([{...files[0],data:Buffer.alloc(0)},files[1]]),/nichtleer/);
    assert.throws(()=>validateSignatureFiles([{...files[0],data:Buffer.from([0])},files[1]]),/NUL/);
    const created=await createSignaturePair(root,'HR',files,{groupPrefix:'Signatur-'});
    assert.deepEqual(created,{key:'HR',html:'HR_Template.htm',txt:'HR_Template.txt',group:'Signatur-HR'});
    assert.deepEqual(fs.readFileSync(path.join(root,created.html)),html);
    assert.deepEqual(fs.readFileSync(path.join(root,created.txt)),txt);
    const catalog=discoverSignatureProfiles(root,{groupPrefix:'Signatur-'});
    assert.equal(catalog.HR.templateHtml,'HR_Template.htm');
    assert.equal(catalog.HR.templateTxt,'HR_Template.txt');
    assert.deepEqual(catalog.HR.adGroups,['Signatur-HR']);
    await assert.rejects(()=>createSignaturePair(root,'hr',files,{groupPrefix:'Signatur-'}),
      error=>error.status===409);
    assert.deepEqual(fs.readdirSync(root).sort(),['HR_Template.htm','HR_Template.txt']);
    await assert.rejects(()=>createSignaturePair(root,'../bad',files,{groupPrefix:'Signatur-'}),
      error=>error.status===400);
    assert.deepEqual(fs.readdirSync(root).sort(),['HR_Template.htm','HR_Template.txt']);
  } finally{fs.rmSync(root,{force:true,recursive:true})}
  console.log('signature-create.test.js: ok');
})().catch(e=>{console.error(e);process.exitCode=1});
