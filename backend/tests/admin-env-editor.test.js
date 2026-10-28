'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {publicSnapshot,persist,mergeVariables}=require('../admin-env-editor');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'signaturee-admin-env-'));
const previous=process.env.SIGNATUREE_ENV_FILE;
const base={variables:[
  {id:'givenName',displayName:'Vorname',placeholders:['$givenname'],required:true},
  {id:'mail',displayName:'E-Mail',placeholders:['$mail'],adProperties:['mail'],required:true}
],ordering:['givenName','mail']};
const values={
 SIGNATUREE_ORGANIZATION_NAME:'Updated Test GmbH',
 AD_SERVER:'dc.example.local',OU_SEARCH_BASE:'DC=example,DC=local',
 LOCAL_DEPLOYMENT_PATH:'generatedsignatures',
 NETWORK_DEPLOYMENT_PATH:'\\\\fileserver\\share',
 SIGNATUREE_SECONDARY_TITLE_ATTRIBUTES:'',
 SIGNATUREE_AUTO_GROUP_PREFIX:'Signature-',
 AUTH_LDAP_DOMAIN:'example.local',
 AUTH_LDAP_SERVER:'',AUTH_LDAP_CONTAINER:'',AUTH_LDAP_UPN_SUFFIX:''
};
try{
  fs.mkdirSync(path.join(dir,'backend'));
  // Stub validates the child invocation without starting a web server.
  fs.writeFileSync(path.join(dir,'backend','server.js'),
    'if(process.argv.includes("--check"))console.log(JSON.stringify({configMode:process.env.SIGNATUREE_CONFIG_MODE}));else process.exit(42);');
  const file=path.join(dir,'.env');
  fs.writeFileSync(file,
    'SIGNATUREE_CONFIG_MODE=env\nSIGNATUREE_ORGANIZATION_NAME=Old\nAD_SERVER=dc.example.local\n' +
    'OU_SEARCH_BASE=DC=example,DC=local\nLOCAL_DEPLOYMENT_PATH=generatedsignatures\n' +
    'NETWORK_DEPLOYMENT_PATH=\\\\fileserver\\share\nAD_QUERY_PASSWORD=PRIVATE-DONT-SHARE\n' +
    '# keep this comment\n');
  process.env.SIGNATUREE_ENV_FILE=file;
  const initial=publicSnapshot(dir,base);
  assert.equal(initial.values.SIGNATUREE_ORGANIZATION_NAME,'Old');
  assert.equal(Object.keys(initial).includes('AD_QUERY_PASSWORD'),false);
  const vars=[
    {id:'givenName',displayName:'Vorname',placeholders:['$givenname'],
      adProperties:['givenName'],required:true},
    {id:'mail',displayName:'E-Mail',placeholders:['$mail'],
      adProperties:['userPrincipalName','mail'],required:true},
    {id:'standort',displayName:'Standort',placeholders:['$standort'],
      adProperties:['extensionAttribute10'],required:false},
  ];
  const result=persist(dir,initial.revision,values,vars,base);
  assert.equal(result.restartRequired,true);
  const content=fs.readFileSync(file,'utf8');
  assert.match(content,/SIGNATUREE_ORGANIZATION_NAME=Updated Test GmbH/);
  assert.match(content,/AD_QUERY_PASSWORD=PRIVATE-DONT-SHARE/);
  assert.match(content,/# keep this comment/);
  assert.match(content,/SIGNATUREE_VARIABLES_EXTRA_JSON=/);
  const backups=fs.readdirSync(dir).filter(n=>n.startsWith('.env.bak-'));
  assert.equal(backups.length,1);
  assert.match(fs.readFileSync(path.join(dir,backups[0]),'utf8'),/SIGNATUREE_ORGANIZATION_NAME=Old/);
  assert.equal(publicSnapshot(dir,base).variables.length,3);
  assert.equal(mergeVariables(base,vars.slice(1)).variables.length,3);
  assert.throws(()=>persist(dir,initial.revision,values,vars,base),e=>e.status===409);
  assert.throws(()=>persist(dir,result.revision,{...values,AUTH_DB_PATH:'c:\\secrets'},vars,base),/Only approved/);
  assert.throws(()=>persist(dir,result.revision,{...values,AD_SERVER:'bad\nkey'},vars,base),/Invalid value/);
  assert.throws(()=>persist(dir,result.revision,values,vars.filter(v=>v.id!=='mail'),base),/cannot be removed/);
  assert.equal(fs.readdirSync(dir).filter(n=>n.startsWith('.env.bak-')).length,1,'invalid writes create no backups');
  assert.equal(fs.readFileSync(file,'utf8'),content);
  console.log('admin-env-editor.test.js: ok');
}finally{
  if(previous===undefined)delete process.env.SIGNATUREE_ENV_FILE;else process.env.SIGNATUREE_ENV_FILE=previous;
  fs.rmSync(dir,{recursive:true,force:true});
}
