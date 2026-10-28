'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const serverFile = path.join(__dirname, '..', 'server.js');
async function freePort() {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signaturee-config-env-'));
  const envPath = path.join(tmp, '.env');
  const port = await freePort();
  const signatures = { demo: { label: 'Demo', adGroups: ['CN=Demo,DC=example,DC=test'],
    templateHtml: 'demo.htm', templateTxt: 'demo.txt' } };
  const lines = [
    'SIGNATUREE_CONFIG_MODE=env', 'BACKEND_HOST=127.0.0.1', 'BACKEND_PORT=' + port,
    'AUTH_REQUIRED=false', 'AUTH_DB_PATH=' + path.join(tmp, 'auth.db'),
    'DB_PATH=' + path.join(tmp, 'storage.db'),
    'SIGNATUREE_ORGANIZATION_NAME=My Env Organization',
    'AD_SERVER=dc.example.test', 'OU_SEARCH_BASE=OU=Users,DC=example,DC=test',
    'LOCAL_DEPLOYMENT_PATH=preview-directory',
    'NETWORK_DEPLOYMENT_PATH=\\\\fileserver\\Signatures',
    'TEMPLATE_DIR=config/templates', 'SIGNATUREE_SIGNATURES_JSON=' + JSON.stringify(signatures)
  ];
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
  const env = { ...process.env, SIGNATUREE_ENV_FILE: envPath };
  ['SIGNATUREE_CONFIG_MODE','AD_SERVER','OU_SEARCH_BASE','SIGNATUREE_ORGANIZATION_NAME',
    'SIGNATUREE_SIGNATURES_JSON','SIGNATUREE_PROFILE_JSON','SIGNATUREE_VARIABLES_JSON',
    'NETWORK_DEPLOYMENT_PATH','LOCAL_DEPLOYMENT_PATH','TEMPLATE_DIR','BACKEND_PORT',
    'BACKEND_HOST','AUTH_REQUIRED','DB_PATH','AUTH_DB_PATH','AD_QUERY_USERNAME','AD_QUERY_PASSWORD'].forEach(key => delete env[key]);
  let server;
  try {
    const checked = spawnSync(process.execPath, [serverFile, '--check'], { env, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    const config = JSON.parse(checked.stdout);
    assert.equal(config.configMode, 'env');
    assert.equal(config.effectiveProfile.organization.name, 'My Env Organization');
    assert.equal(config.effectiveProfile.targets.production.path, '\\\\fileserver\\Signatures');
    assert.equal(config.effectiveProfile.signatures.demo.templateHtml, 'demo.htm');
    assert.ok(config.templateDirectory.endsWith(path.join('config', 'templates')));
    const additiveEnvPath = path.join(tmp,'additive-vars.env');
    const variableExtras = [
      { id:'standort', displayName:'Standort', placeholders:['$standort'],
        adProperties:['extensionAttribute10'], required:false },
      { id:'mail', displayName:'E-Mail', placeholders:['$mail'],
        adProperties:['userPrincipalName','mail'], required:true },
    ];
    fs.writeFileSync(additiveEnvPath,lines.join('\n') +
      '\nSIGNATUREE_VARIABLES_EXTRA_JSON=' + JSON.stringify(variableExtras) + '\n');
    const extraCheck=spawnSync(process.execPath,[serverFile,'--check'],{
      env:{...env,SIGNATUREE_ENV_FILE:additiveEnvPath},encoding:'utf8',
    });
    assert.equal(extraCheck.status,0,extraCheck.stderr);
    const mergedProfile=JSON.parse(extraCheck.stdout).effectiveProfile;
    assert.ok(mergedProfile.variables.variables.some(v=>v.id==='givenName'),
      'adding variables must retain built-in givenName');
    assert.ok(mergedProfile.variables.variables.some(v=>v.id==='standort'),
      'custom extensionAttribute10 must be available');
    assert.deepEqual(mergedProfile.variables.variables.find(v=>v.id==='mail').adProperties,
      ['userPrincipalName','mail'],'built-in mail AD mapping can be modified without replacing other variables');
    const incompleteEnv = path.join(tmp, 'incomplete-ad.env');
    fs.writeFileSync(incompleteEnv, lines.join('\n') + '\nAD_QUERY_USERNAME=EXAMPLE\\reader\n');
    const incomplete = spawnSync(process.execPath, [serverFile, '--check'], {
      env: { ...env, SIGNATUREE_ENV_FILE: incompleteEnv }, encoding: 'utf8',
    });
    assert.notEqual(incomplete.status, 0, 'AD query username requires matching password');
    const completeEnv = path.join(tmp, 'complete-ad.env');
    fs.writeFileSync(completeEnv, lines.join('\n') +
      '\nAD_QUERY_USERNAME=EXAMPLE\\reader\nAD_QUERY_PASSWORD=not-a-real-secret\n');
    const complete = spawnSync(process.execPath, [serverFile, '--check'], {
      env: { ...env, SIGNATUREE_ENV_FILE: completeEnv }, encoding: 'utf8',
    });
    assert.equal(complete.status, 0, complete.stderr);
    assert.ok(!complete.stdout.includes('not-a-real-secret'), 'no AD password in --check output');
    server = spawn(process.execPath, [serverFile], { env, stdio: ['ignore','ignore','pipe'] });
    let stderr = '';
    server.stderr.on('data', chunk => { stderr += chunk; });
    const base = 'http://127.0.0.1:' + port;
    let ready = false;
    for (let i=0; i<60; i++) {
      if (server.exitCode !== null) throw new Error(stderr);
      try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, stderr);
    const response = await fetch(base + '/api/v2/profile');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.source, 'environment (.env)');
    assert.equal(result.profile.organization.name, 'My Env Organization');
    const put = await fetch(base + '/api/v2/profile', {
      method:'PUT', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ profile:{ organization:{ name:'Should not persist' } } }),
    });
    assert.equal(put.status, 409);
    const after = (await (await fetch(base + '/api/v2/profile')).json()).profile;
    assert.equal(after.organization.name, 'My Env Organization');
    const badFile = path.join(tmp, 'bad.env');
    fs.writeFileSync(badFile, lines.slice(0,-1).join('\n') + '\nSIGNATUREE_SIGNATURES_JSON={oops}\n');
    const bad = spawnSync(process.execPath, [serverFile, '--check'],
      { env: { ...env, SIGNATUREE_ENV_FILE: badFile }, encoding:'utf8' });
    assert.notEqual(bad.status, 0, 'bad JSON must fail, never silently use SQLite');
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill();
      await exited;
    }
    fs.rmSync(tmp, { recursive:true, force:true });
  }
  console.log('config-env.test.js: ok');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
