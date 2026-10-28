'use strict';
// Restricted admin editor for the ONE project-root .env. Secrets and runtime
// bindings are never returned to the browser or included in the allowlist.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const FIELDS = Object.freeze([
  'SIGNATUREE_ORGANIZATION_NAME', 'AD_SERVER', 'OU_SEARCH_BASE',
  'LOCAL_DEPLOYMENT_PATH', 'NETWORK_DEPLOYMENT_PATH',
  'SIGNATUREE_SECONDARY_TITLE_ATTRIBUTES', 'SIGNATUREE_AUTO_GROUP_PREFIX',
  'AUTH_LDAP_DOMAIN', 'AUTH_LDAP_SERVER', 'AUTH_LDAP_CONTAINER', 'AUTH_LDAP_UPN_SUFFIX'
]);
const VARIABLES_KEY = 'SIGNATUREE_VARIABLES_EXTRA_JSON';
function failure(message, status=400, code='INVALID_CONFIG_EDIT') {
  const error = new Error(message);
  error.status=status; error.code=code;
  return error;
}
function sha(v){return crypto.createHash('sha256').update(v).digest('hex');}
function envPath(root){
  const selected = process.env.SIGNATUREE_ENV_FILE
    ? path.resolve(process.env.SIGNATUREE_ENV_FILE) : path.join(root,'.env');
  // Deliberately allow editing ONLY the repo-root .env, not an arbitrary env
  // file that might be provided through SIGNATUREE_ENV_FILE.
  if(path.resolve(selected).toLowerCase()!==path.join(root,'.env').toLowerCase())
    throw failure('Admin .env editor only supports the project-root .env.',403,'ENV_PATH_NOT_EDITABLE');
  const stat=fs.lstatSync(selected);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1)
    throw failure('The .env must be a regular file, not a link.',403,'ENV_FILE_UNSAFE');
  return selected;
}
function readRoot(root){
  const file=envPath(root);
  const source=fs.readFileSync(file,'utf8');
  if(Buffer.byteLength(source)>256*1024)throw failure('The .env is too large for the Admin editor.');
  const keys=new Map();
  const lines=source.replace(/^\uFEFF/,'').split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();
    if(!line||line.startsWith('#'))continue;
    const sep=line.indexOf('=');
    if(sep<1)throw failure('Invalid .env assignment at line '+(i+1));
    const key=line.slice(0,sep).trim();
    if(!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(key))
      throw failure('Invalid .env key at line '+(i+1));
    if(keys.has(key))throw failure('Duplicate .env key: '+key);
    let value=line.slice(sep+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))
      value=value.slice(1,-1);
    keys.set(key,{index:i,value});
  }
  return {file,source,lines,keys,revision:sha(source)};
}
function validateValue(key,value){
  if(typeof value!=='string' || value.length>2048 || /[\r\n\0]/.test(value))
    throw failure('Invalid value for '+key);
  const v=value.trim();
  if(key==='SIGNATUREE_ORGANIZATION_NAME' && !v)throw failure('Organization name is required.');
  if(['AD_SERVER','AUTH_LDAP_SERVER','AUTH_LDAP_DOMAIN','AUTH_LDAP_UPN_SUFFIX'].includes(key)&&v&&!/^[a-zA-Z0-9_.-]+$/.test(v))
    throw failure(key+' must be a DNS name/domain.');
  if(['OU_SEARCH_BASE','AUTH_LDAP_CONTAINER'].includes(key)&&v&&!/^(?:DC|OU|CN)=[^=,\n]+(?:,(?:DC|OU|CN)=[^=,\n]+)*$/i.test(v))
    throw failure('Invalid AD distinguished name for '+key);
  if(key==='NETWORK_DEPLOYMENT_PATH'&&(!v.startsWith('\\\\')||v.length<5))
    throw failure('Network output must be a Windows UNC path (\\\\server\\share).');
  if(key==='LOCAL_DEPLOYMENT_PATH'&&!v)throw failure('Local output folder is required.');
  if(key==='SIGNATUREE_AUTO_GROUP_PREFIX'&&v&&!/^[a-zA-Z][a-zA-Z0-9_-]*-$/.test(v))
    throw failure('Signature group prefix must be like Signature- or Signatur-.');
  if(key==='SIGNATUREE_SECONDARY_TITLE_ATTRIBUTES'&&v&&!/^[a-zA-Z0-9_,;\s-]+$/.test(v))
    throw failure('Invalid AD title attribute list.');
  if(/["']/.test(v))throw failure('Quotes are not accepted in '+key);
  return v;
}
function safeVariable(v){
  if(!v||typeof v!=='object'||Array.isArray(v))throw failure('Variable must be an object.');
  const id=String(v.id||'').trim();
  if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id))throw failure('Invalid variable ID: '+id);
  const arr=(name,pattern,max=12)=>{
    const a=v[name];
    if(!Array.isArray(a)||a.length<1||a.length>max||a.some(x=>typeof x!=='string'||x.length>100||!pattern.test(x)))
      throw failure('Invalid '+name+' for '+id);
    return [...new Set(a.map(x=>x.trim()))];
  };
  const value={
    id,
    displayName:String(v.displayName||id).trim(),
    required:v.required===true,
    placeholders:arr('placeholders',/^\$[A-Za-z][A-Za-z0-9_]*$/),
    adProperties:arr('adProperties',/^[A-Za-z][A-Za-z0-9_-]*$/),
  };
  if(value.displayName.length>120 || !value.displayName)throw failure('Invalid display name for '+id);
  if(v.csvHeader){
    if(typeof v.csvHeader!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v.csvHeader))
      throw failure('Invalid CSV header for '+id);
    value.csvHeader=v.csvHeader;
  }
  if(v.description){
    if(typeof v.description!=='string'||v.description.length>400||/[\r\n\0]/.test(v.description))
      throw failure('Invalid variable description for '+id);
    value.description=v.description;
  }
  return value;
}
function computeOverrides(base,requested){
  if(!Array.isArray(requested)||requested.length>100)throw failure('Invalid variable list.');
  const baseIds=new Map(base.map(v=>[v.id.toLowerCase(),v]));
  const seen=new Set(),overrides=[];
  for(const raw of requested){
    const v=safeVariable(raw),k=v.id.toLowerCase();
    if(seen.has(k))throw failure('Duplicate variable ID: '+v.id);
    seen.add(k);
    const standard=baseIds.get(k);
    if(standard){
      // Only explicit differences from the shipped default are persisted.
      // Default fields not shown in Admin are inherited from the base.
      const normalized= safeVariable({
        id:standard.id,displayName:standard.displayName,
        placeholders:standard.placeholders||['$'+standard.id],
        adProperties:standard.adProperties||[standard.id],
        required:standard.required===true,
        csvHeader:standard.csvHeader||'',description:standard.description||''
      });
      const candidate={...v,id:standard.id};
      if(JSON.stringify(candidate)!==JSON.stringify(normalized))overrides.push(candidate);
    } else overrides.push(v);
  }
  for(const id of baseIds.keys())if(!seen.has(id))
    throw failure('Built-in variable '+id+' cannot be removed; it can be edited.');
  return overrides;
}
function mergeVariables(baseSchema,extra){
  const base=baseSchema.variables.map(v=>({...v}));
  if(!Array.isArray(extra))throw failure('SIGNATUREE_VARIABLES_EXTRA_JSON must be an array.');
  const result=[...base];
  const seen=new Set();
  for(const raw of extra){
    const v=safeVariable(raw);
    const k=v.id.toLowerCase();
    if(seen.has(k))throw failure('Duplicate variable override: '+v.id);
    seen.add(k);
    const i=result.findIndex(s=>s.id.toLowerCase()===k);
    if(i<0)result.push(v);
    else result[i]={...result[i],...v,id:result[i].id};
  }
  const placeholders=new Map();
  for(const variable of result){
    const names=variable.placeholders?.length?variable.placeholders:['
}
function publicSnapshot(root,baseSchema){
  const current=readRoot(root);
  const values={};
  for(const field of FIELDS)values[field]=current.keys.get(field)?.value??'';
  const extrasRaw=current.keys.get(VARIABLES_KEY)?.value||'[]';
  let extras;
  try{extras=JSON.parse(extrasRaw);}catch{throw failure('Existing variable additions JSON is invalid.');}
  return {
    revision:current.revision,values,baseVariables:baseSchema.variables,
    variables:mergeVariables(baseSchema,extras).variables,
    // Never return the raw .env: it may contain AD read credentials.
  };
}
function editEnvSource(current,values,overrides){
  const change=new Map();
  for(const field of FIELDS){
    if(!Object.prototype.hasOwnProperty.call(values,field))
      throw failure('Missing editable field: '+field);
    change.set(field,validateValue(field,values[field]));
  }
  change.set(VARIABLES_KEY,JSON.stringify(overrides));
  const lines=[...current.lines];
  // Appending only missing fields keeps all unrelated values, comments and secrets untouched.
  for(const [key,value]of change){
    const encoded=value;
    const entry=key+'='+encoded;
    const match=current.keys.get(key);
    if(match)lines[match.index]=entry;
    else lines.push(entry);
  }
  const sep=current.source.includes('\r\n')?'\r\n':'\n';
  return lines.join(sep).replace(/\n*$/,'')+sep;
}
function validateCandidate(root,file,content,keys){
  const tmp=path.join(root,'.env.validate-'+crypto.randomBytes(8).toString('hex'));
  fs.writeFileSync(tmp,content,{flag:'wx',mode:0o600});
  try{
    const env={...process.env,SIGNATUREE_ENV_FILE:tmp};
    for(const key of keys)delete env[key];
    for(const key of FIELDS)delete env[key];
    delete env[VARIABLES_KEY];
    // Use real config checker, including template discovery, with edited env.
    const result=spawnSync(process.execPath,[path.join(root,'backend','server.js'),'--check'],
      {env,timeout:15000,encoding:'utf8',maxBuffer:1024*1024});
    if(result.error||result.status!==0){
      // Do not echo stdout/stderr: .env can contain sensitive fields.
      throw failure('Candidate .env failed backend configuration validation; file unchanged.',422,'ENV_CHECK_FAILED');
    }
  }finally{fs.rmSync(tmp,{force:true});}
}
function persist(root,revision,values,variables,baseSchema){
  const current=readRoot(root);
  if(typeof revision!=='string'||revision!==current.revision)
    throw failure('.env was changed by another editor. Reload this page before saving.',409,'ENV_CONFLICT');
  if(!values||typeof values!=='object'||Array.isArray(values)||
     Object.keys(values).some(k=>!FIELDS.includes(k)))
    throw failure('Only approved settings can be changed via Admin.');
  if(current.keys.has('SIGNATUREE_VARIABLES_JSON')||current.keys.has('SIGNATUREE_PROFILE_JSON'))
    throw failure('Advanced full-profile JSON is active. Remove those overrides manually before using the variable editor.',409,'FULL_PROFILE_ACTIVE');
  const overrides=computeOverrides(baseSchema.variables,variables);
  const content=editEnvSource(current,values,overrides);
  if(Buffer.byteLength(content)>256*1024)throw failure('Resulting .env is too large.');
  const keys=new Set(current.keys.keys());
  validateCandidate(root,current.file,content,keys);
  // Lock out writes from a second API call and direct edits as far as possible.
  if(readRoot(root).revision!==current.revision)
    throw failure('.env changed during validation. Reload and retry.',409,'ENV_CONFLICT');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backup=current.file+'.bak-'+stamp+'-'+crypto.randomBytes(3).toString('hex');
  const temp=current.file+'.new-'+crypto.randomBytes(6).toString('hex');
  // Backups stay alongside .env, are ignored by Git and inherit the same ACL
  // model; mode 0600 for platforms supporting Unix permissions.
  fs.copyFileSync(current.file,backup,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup,0o600);
  try{
    fs.writeFileSync(temp,content,{flag:'wx',mode:0o600});
    fs.renameSync(temp,current.file);
  }finally{fs.rmSync(temp,{force:true});}
  return {revision:sha(content),restartRequired:true,backupCreated:true,updatedKeys:[...FIELDS,VARIABLES_KEY]};
}
module.exports={FIELDS,VARIABLES_KEY,publicSnapshot,persist,mergeVariables,computeOverrides,validateValue};
+variable.id];
    for(const name of names){
      const key=name.toLowerCase();
      if(placeholders.has(key)&&placeholders.get(key)!==variable.id){
        throw failure('Template placeholder '+name+' is assigned to multiple variables.');
      }
      placeholders.set(key,variable.id);
    }
  }
  return {...baseSchema,variables:result,ordering:result.map(v=>v.id)};
}
function publicSnapshot(root,baseSchema){
  const current=readRoot(root);
  const values={};
  for(const field of FIELDS)values[field]=current.keys.get(field)?.value??'';
  const extrasRaw=current.keys.get(VARIABLES_KEY)?.value||'[]';
  let extras;
  try{extras=JSON.parse(extrasRaw);}catch{throw failure('Existing variable additions JSON is invalid.');}
  return {
    revision:current.revision,values,baseVariables:baseSchema.variables,
    variables:mergeVariables(baseSchema,extras).variables,
    // Never return the raw .env: it may contain AD read credentials.
  };
}
function editEnvSource(current,values,overrides){
  const change=new Map();
  for(const field of FIELDS){
    if(!Object.prototype.hasOwnProperty.call(values,field))
      throw failure('Missing editable field: '+field);
    change.set(field,validateValue(field,values[field]));
  }
  change.set(VARIABLES_KEY,JSON.stringify(overrides));
  const lines=[...current.lines];
  // Appending only missing fields keeps all unrelated values, comments and secrets untouched.
  for(const [key,value]of change){
    const encoded=value;
    const entry=key+'='+encoded;
    const match=current.keys.get(key);
    if(match)lines[match.index]=entry;
    else lines.push(entry);
  }
  const sep=current.source.includes('\r\n')?'\r\n':'\n';
  return lines.join(sep).replace(/\n*$/,'')+sep;
}
function validateCandidate(root,file,content,keys){
  const tmp=path.join(root,'.env.validate-'+crypto.randomBytes(8).toString('hex'));
  fs.writeFileSync(tmp,content,{flag:'wx',mode:0o600});
  try{
    const env={...process.env,SIGNATUREE_ENV_FILE:tmp};
    for(const key of keys)delete env[key];
    for(const key of FIELDS)delete env[key];
    delete env[VARIABLES_KEY];
    // Use real config checker, including template discovery, with edited env.
    const result=spawnSync(process.execPath,[path.join(root,'backend','server.js'),'--check'],
      {env,timeout:15000,encoding:'utf8',maxBuffer:1024*1024});
    if(result.error||result.status!==0){
      // Do not echo stdout/stderr: .env can contain sensitive fields.
      throw failure('Candidate .env failed backend configuration validation; file unchanged.',422,'ENV_CHECK_FAILED');
    }
  }finally{fs.rmSync(tmp,{force:true});}
}
function persist(root,revision,values,variables,baseSchema){
  const current=readRoot(root);
  if(typeof revision!=='string'||revision!==current.revision)
    throw failure('.env was changed by another editor. Reload this page before saving.',409,'ENV_CONFLICT');
  if(!values||typeof values!=='object'||Array.isArray(values)||
     Object.keys(values).some(k=>!FIELDS.includes(k)))
    throw failure('Only approved settings can be changed via Admin.');
  if(current.keys.has('SIGNATUREE_VARIABLES_JSON')||current.keys.has('SIGNATUREE_PROFILE_JSON'))
    throw failure('Advanced full-profile JSON is active. Remove those overrides manually before using the variable editor.',409,'FULL_PROFILE_ACTIVE');
  const overrides=computeOverrides(baseSchema.variables,variables);
  const content=editEnvSource(current,values,overrides);
  if(Buffer.byteLength(content)>256*1024)throw failure('Resulting .env is too large.');
  const keys=new Set(current.keys.keys());
  validateCandidate(root,current.file,content,keys);
  // Lock out writes from a second API call and direct edits as far as possible.
  if(readRoot(root).revision!==current.revision)
    throw failure('.env changed during validation. Reload and retry.',409,'ENV_CONFLICT');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backup=current.file+'.bak-'+stamp+'-'+crypto.randomBytes(3).toString('hex');
  const temp=current.file+'.new-'+crypto.randomBytes(6).toString('hex');
  // Backups stay alongside .env, are ignored by Git and inherit the same ACL
  // model; mode 0600 for platforms supporting Unix permissions.
  fs.copyFileSync(current.file,backup,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup,0o600);
  try{
    fs.writeFileSync(temp,content,{flag:'wx',mode:0o600});
    fs.renameSync(temp,current.file);
  }finally{fs.rmSync(temp,{force:true});}
  return {revision:sha(content),restartRequired:true,backupCreated:true,updatedKeys:[...FIELDS,VARIABLES_KEY]};
}
module.exports={FIELDS,VARIABLES_KEY,publicSnapshot,persist,mergeVariables,computeOverrides,validateValue};
