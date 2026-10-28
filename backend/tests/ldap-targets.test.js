
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

async function freePort() {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signaturee-ldap-target-test-'));
  const authPath = path.join(tmp, 'auth.db');
  const storagePath = path.join(tmp, 'storage.db');
  const previewPath = path.join(tmp, 'preview-missing');
  const port = await freePort();
  const fixtureEnv = path.join(tmp, '.env');
  const signature = { demo: {
    label: 'Demo',
    adGroups: ['CN=Signaturee,DC=example,DC=test'],
    templateHtml: 'demo.htm',
    templateTxt: 'demo.txt',
  } };
  fs.writeFileSync(fixtureEnv, [
    'SIGNATUREE_CONFIG_MODE=env', 'BACKEND_HOST=127.0.0.1', 'BACKEND_PORT=' + port,
    'AUTH_REQUIRED=true', 'AUTH_DB_LOGIN_ENABLED=true', 'AUTH_LDAP_ENABLED=true',
    'AUTH_LDAP_SERVER=invalid.example.test', 'AUTH_LDAP_DOMAIN=example.test',
    'AUTH_DB_PATH=' + authPath, 'DB_PATH=' + storagePath,
    'LOCAL_DEPLOYMENT_PATH=' + previewPath,
    'NETWORK_DEPLOYMENT_PATH=\\\\invalid-server\\Signatures',
    'TEMPLATE_DIR=' + path.join(tmp, 'templates'),
    'SIGNATUREE_SIGNATURES_JSON=' + JSON.stringify(signature),
  ].join('\n') + '\n');
  const env = { ...process.env, SIGNATUREE_ENV_FILE: fixtureEnv };
  for (const key of [
    'SIGNATUREE_CONFIG_MODE','BACKEND_PORT','BACKEND_HOST','AUTH_REQUIRED',
    'AUTH_DB_LOGIN_ENABLED','AUTH_LDAP_ENABLED','AUTH_LDAP_DOMAIN','AUTH_LDAP_SERVER',
    'AUTH_DB_PATH','DB_PATH','LOCAL_DEPLOYMENT_PATH','NETWORK_DEPLOYMENT_PATH',
    'TEMPLATE_DIR','SIGNATUREE_SIGNATURES_JSON','SIGNATUREE_PROFILE_JSON',
    'AUTH_LDAP_ROLE_RULES_PATH','AUTH_LDAP_ROLE_RULES_JSON',
  ]) delete env[key];
  const projectRoot = path.join(__dirname, '..', '..');
  let server;
  try {
    const seed = spawnSync(process.execPath, [
      path.join(projectRoot, 'scripts', 'manage-auth-users.js'),
      'add', '--username', 'diagnostic-admin', '--role', 'admin', '--password-stdin',
    ], { env, encoding: 'utf8', input: 'example-password-123\n' });
    assert.equal(seed.status, 0, seed.stderr);
    assert.equal(fs.existsSync(previewPath), false, 'preview must start missing');
    server = spawn(process.execPath, [path.join(projectRoot, 'backend', 'server.js')], {
      env, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    server.stderr.on('data', data => { stderr += data.toString(); });
    const base = 'http://127.0.0.1:' + port;
    let ready = false;
    for (let i = 0; i < 70; i++) {
      if (server.exitCode !== null) throw new Error('Backend exited: ' + stderr);
      try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, stderr);
    assert.equal(fs.statSync(previewPath).isDirectory(), true, 'preview folder created at startup');
    fs.rmSync(previewPath, { recursive: true, force: true });
    async function post(route, body, token) {
      const response = await fetch(base + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    assert.equal((await post('/api/v2/ad/test', {})).status, 401, 'AD diagnosis requires local Admin');
    assert.equal((await post('/api/v2/auth/ldap/test', {})).status, 401,
      'test endpoint must require an authenticated admin');
    const login = await post('/api/auth/login', {
      username: 'diagnostic-admin', password: 'example-password-123', source: 'local',
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const token = login.body.token;
    const overview = await post('/api/v2/auth/ldap/test', {}, token);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.ok, true);
    assert.equal(overview.body.code, 'CONFIGURATION_LOADED');
    assert.equal(overview.body.config.server, 'invalid.example.test');
    assert.equal((await post('/api/v2/auth/ldap/test', {username:'some-user'}, token)).status, 400);

    const target = await post('/api/v2/targets/check', {target:'preview'}, token);
    assert.equal(target.status, 200);
    assert.equal(target.body.writable, true, JSON.stringify(target.body));
    assert.equal(target.body.created, true, JSON.stringify(target.body));
    assert.equal(fs.statSync(previewPath).isDirectory(), true);
    assert.ok(!fs.readdirSync(previewPath).some(name => name.startsWith('.signaturee-access-test-')),
      'probe directory must be cleaned up');
    // Trial path is checked directly and NEVER written into the .env.
    const trialPath = path.join(tmp,'separate-test-only');
    assert.equal(fs.existsSync(trialPath), false);
    assert.equal((await post('/api/v2/targets/check', {target:'preview',path:trialPath})).status, 401,
      'unsaved path checks must require an authenticated Admin');
    const trial = await post('/api/v2/targets/check', {target:'preview',path:trialPath}, token);
    assert.equal(trial.status, 200,JSON.stringify(trial.body));
    assert.equal(trial.body.temporaryTest,true);
    assert.equal(trial.body.writable,false,'nonexistent custom path must not be created');
    assert.equal(fs.existsSync(trialPath), false, 'trial path must not be created');
    assert.equal((await post('/api/v2/targets/check',{target:'production',path:'C:\\\\Windows'},token)).status,400,
      'production trials must be UNC only');
    assert.equal((await post('/api/v2/targets/check',{target:'preview',path:'../secret'},token)).status,400,
      'relative path traversal must not be accepted');
    assert.ok(fs.readFileSync(fixtureEnv,'utf8').includes('LOCAL_DEPLOYMENT_PATH='+previewPath),
      'trial checks must leave the original env intact');
    const secondCheck = await post('/api/v2/targets/check', {target:'preview'}, token);
    assert.equal(secondCheck.body.writable, true);
    assert.equal(secondCheck.body.created, false);

    const pathError = await post('/api/v2/targets/check', {target:'invalid'}, token);
    assert.equal(pathError.status, 400);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill();
      await exited;
    }
    fs.rmSync(tmp, {recursive:true, force:true});
  }
  console.log('ldap-targets.test.js: ok');
}
run().catch(e => { console.error(e); process.exitCode=1; });
