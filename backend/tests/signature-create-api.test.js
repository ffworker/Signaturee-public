'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');

async function freePort(){
  const srv=net.createServer();await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const port=srv.address().port;await new Promise(r=>srv.close(r));return port;
}
(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'signaturee-create-api-'));
  const root=path.join(__dirname,'..','..');
  const templates=path.join(tmp,'templates');
  const port=await freePort();
  const envfile=path.join(tmp,'.env');
  fs.mkdirSync(templates);
  fs.writeFileSync(path.join(templates,'EX_Template.htm'),'<p>$mail</p>');
  fs.writeFileSync(path.join(templates,'EX_Template.txt'),'$mail');
  fs.writeFileSync(envfile,[
    'SIGNATUREE_CONFIG_MODE=env','SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true',
    'SIGNATUREE_AUTO_GROUP_PREFIX=Signatur-',
    'BACKEND_HOST=127.0.0.1','BACKEND_PORT='+port,
    'AUTH_REQUIRED=true','AUTH_DB_LOGIN_ENABLED=true','AUTH_LDAP_ENABLED=false',
    'AUTH_DB_PATH='+path.join(tmp,'auth.db'),'DB_PATH='+path.join(tmp,'store.db'),
    'TEMPLATE_DIR='+templates,'LOCAL_DEPLOYMENT_PATH='+path.join(tmp,'preview'),
    'NETWORK_DEPLOYMENT_PATH=\\\\invalid-host\\signatures',
  ].join('\n')+'\n');
  const env={...process.env,SIGNATUREE_ENV_FILE:envfile};
  for(const key of ['SIGNATUREE_CONFIG_MODE','SIGNATUREE_SIGNATURES_AUTO_DISCOVER',
    'SIGNATUREE_AUTO_GROUP_PREFIX','SIGNATUREE_SIGNATURES_JSON','SIGNATUREE_PROFILE_JSON',
    'TEMPLATE_DIR','BACKEND_HOST','BACKEND_PORT','AUTH_REQUIRED','AUTH_DB_LOGIN_ENABLED',
    'AUTH_LDAP_ENABLED','AUTH_DB_PATH','DB_PATH','LOCAL_DEPLOYMENT_PATH',
    'NETWORK_DEPLOYMENT_PATH'])delete env[key];
  let server;
  try{
    const seed=spawnSync(process.execPath,[path.join(root,'scripts','manage-auth-users.js'),
      'add','--username','test-admin','--role','admin','--password-stdin'],{
      env,encoding:'utf8',input:'some-pass-123\n'});
    assert.equal(seed.status,0,seed.stderr);
    server=spawn(process.execPath,[path.join(root,'backend','server.js')],{
      env,stdio:['ignore','ignore','pipe']});
    let stderr='';server.stderr.on('data',d=>stderr+=d.toString());
    const base='http://127.0.0.1:'+port;
    let ready=false;
    for(let i=0;i<90;i++){
      if(server.exitCode!==null)throw new Error('server failed: '+stderr);
      try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(ready,stderr);
    const login=await fetch(base+'/api/auth/login',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:'test-admin',password:'some-pass-123',source:'local'})});
    assert.equal(login.status,200);
    const token=(await login.json()).token;
    const form=()=>{const f=new FormData();f.append('key','HR');
      f.append('html',new Blob(['<p>$givenname $sn</p>'],{type:'text/html'}),'template.html');
      f.append('txt',new Blob(['$givenname $sn'],{type:'text/plain'}),'template.txt');
      return f;};
    let res=await fetch(base+'/api/v2/signatures/create',{method:'POST',body:form()});
    assert.equal(res.status,401,'Creation must require Admin authentication');
    assert.equal(fs.readdirSync(templates).length,2,'Unauthenticated requests must not write files');
    res=await fetch(base+'/api/v2/signatures/create',{method:'POST',
      headers:{Authorization:'Bearer '+token},body:form()});
    const result=await res.json();
    assert.equal(res.status,201,JSON.stringify(result));
    assert.equal(result.group,'Signatur-HR');
    assert.deepEqual(fs.readdirSync(templates).sort(),[
      'EX_Template.htm','EX_Template.txt','HR_Template.htm','HR_Template.txt']);
    const catalog=await fetch(base+'/api/v2/profile',{headers:{Authorization:'Bearer '+token}});
    assert.equal(catalog.status,200);
    const profile=(await catalog.json()).profile;
    assert.deepEqual(profile.signatures.HR.adGroups,['Signatur-HR']);
    res=await fetch(base+'/api/v2/signatures/create',{method:'POST',
      headers:{Authorization:'Bearer '+token},body:form()});
    assert.equal(res.status,409,'Duplicated uploads must not replace files');
    assert.equal(fs.readFileSync(path.join(templates,'HR_Template.htm'),'utf8'),'<p>$givenname $sn</p>');
    assert.ok(!fs.readFileSync(envfile,'utf8').includes('HR_Template'));
    console.log('signature-create-api.test.js: ok');
  }finally{
    if(server&&server.exitCode===null&&server.signalCode===null){
      const stopped=new Promise(r=>server.once('exit',r));server.kill();await stopped;
    }
    fs.rmSync(tmp,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1});
