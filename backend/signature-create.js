'use strict';
const fs = require('node:fs');
const path = require('node:path');

class SignatureCreateError extends Error {
  constructor(message,status=400,code='INVALID_SIGNATURE'){
    super(message);this.status=status;this.code=code;
  }
}
function validateSignatureKey(raw){
  if(typeof raw!=='string'|| !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(raw) ||
    raw.toLowerCase()==='example')
    throw new SignatureCreateError('Signatur-Kürzel: 1–40 Buchstaben/Zahlen, _ oder -. "example" ist reserviert.');
  return raw;
}
function validateSignatureFiles(files){
  if(!Array.isArray(files)||files.length!==2)
    throw new SignatureCreateError('Bitte genau eine HTML- und eine TXT-Datei auswählen.');
  const html=files.filter(f=>f.name==='html' && /\.html?$/i.test(f.filename||''));
  const txt=files.filter(f=>f.name==='txt' && /\.txt$/i.test(f.filename||''));
  if(html.length!==1||txt.length!==1)
    throw new SignatureCreateError('Benötigt je eine .htm/.html und .txt-Datei.');
  for(const f of [html[0],txt[0]]){
    if(!Buffer.isBuffer(f.data)||!f.data.length||f.data.length>1024*1024||f.data.includes(0))
      throw new SignatureCreateError('Die Templates müssen nichtleer sein, dürfen keine NUL-Bytes enthalten und max. 1 MiB groß sein.');
  }
  return {html:html[0],txt:txt[0]};
}
async function createSignaturePair(directory,keyRaw,files,options={}){
  const key=validateSignatureKey(keyRaw),pair=validateSignatureFiles(files);
  if(!fs.existsSync(directory)||!fs.statSync(directory).isDirectory())
    throw new SignatureCreateError('Das aktive Template-Verzeichnis ist nicht vorhanden.',422,'TEMPLATE_DIRECTORY_MISSING');
  const names=fs.readdirSync(directory);
  const stem=key+'_Template';
  // Case-insensitive protection covers Windows and avoids a logically
  // duplicated group even when the server runs on a case-sensitive host.
  if(names.some(name=>name.toLowerCase().startsWith(stem.toLowerCase()+'.'))){
    throw new SignatureCreateError('Signatur '+key+' existiert bereits. Bestehende Dateien bleiben unverändert.',409,'SIGNATURE_EXISTS');
  }
  const htmlPath=path.join(directory,stem+'.htm'),txtPath=path.join(directory,stem+'.txt');
  let htmlCreated=false;
  try{
    await fs.promises.writeFile(htmlPath,pair.html.data,{flag:'wx'});
    htmlCreated=true;
    await fs.promises.writeFile(txtPath,pair.txt.data,{flag:'wx'});
  }catch(error){
    if(htmlCreated)await fs.promises.rm(htmlPath,{force:true}).catch(()=>{});
    if(error.code==='EEXIST')throw new SignatureCreateError('Signatur-Datei existiert bereits.',409,'SIGNATURE_EXISTS');
    throw error;
  }
  return {key,html:stem+'.htm',txt:stem+'.txt',group:options.groupPrefix+key};
}
module.exports={SignatureCreateError,validateSignatureKey,validateSignatureFiles,createSignaturePair};
