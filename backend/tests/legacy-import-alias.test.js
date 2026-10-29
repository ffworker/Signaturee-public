'use strict';

// Black-box regression: both legacy CSV import URLs share one supported
// implementation, including authentication, validation and file persistence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signaturee-legacy-import-'));
  const repoRoot = path.join(__dirname, '..', '..');
  const templates = path.join(tmp, 'templates');
  const usersFile = path.join(tmp, 'users.csv');
  const envFile = path.join(tmp, '.env');
  const port = await freePort();
  const token = 'compat-test-user-token';
  fs.mkdirSync(templates);
  fs.writeFileSync(path.join(templates, 'EX_Template.htm'), '<p>$mail</p>');
  fs.writeFileSync(path.join(templates, 'EX_Template.txt'), '$mail');
  fs.writeFileSync(envFile, [
    'SIGNATUREE_CONFIG_MODE=env',
    'SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true',
    'BACKEND_HOST=127.0.0.1',
    'BACKEND_PORT=' + port,
    'AUTH_REQUIRED=true',
    'AUTH_DB_LOGIN_ENABLED=false',
    'AUTH_LDAP_ENABLED=false',
    'AUTH_TOKENS=' + token + ':user',
    'AUTH_DB_PATH=' + path.join(tmp, 'auth.db'),
    'DB_PATH=' + path.join(tmp, 'storage.db'),
    'USER_FILE_PATH=' + usersFile,
    'TEMPLATE_DIR=' + templates,
    'LOCAL_DEPLOYMENT_PATH=' + path.join(tmp, 'preview'),
    'NETWORK_DEPLOYMENT_PATH=' + path.join(tmp, 'production'),
  ].join('\n') + '\n');

  const env = { ...process.env, SIGNATUREE_ENV_FILE: envFile };
  for (const key of [
    'SIGNATUREE_CONFIG_MODE', 'SIGNATUREE_SIGNATURES_AUTO_DISCOVER',
    'SIGNATUREE_SIGNATURES_JSON', 'SIGNATUREE_PROFILE_JSON', 'BACKEND_HOST',
    'BACKEND_PORT', 'PORT', 'AUTH_REQUIRED', 'AUTH_TOKENS', 'API_TOKENS',
    'API_TOKEN', 'AUTH_DB_LOGIN_ENABLED', 'AUTH_LDAP_ENABLED', 'AUTH_DB_PATH',
    'DB_PATH', 'USER_FILE_PATH', 'TEMPLATE_DIR', 'LOCAL_DEPLOYMENT_PATH',
    'NETWORK_DEPLOYMENT_PATH',
  ]) delete env[key];

  let server;
  try {
    server = spawn(process.execPath, [path.join(repoRoot, 'backend', 'server.js')], {
      env, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    server.stderr.on('data', (data) => { stderr += data.toString(); });
    const base = 'http://127.0.0.1:' + port;
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (server.exitCode !== null || server.signalCode !== null) {
        throw new Error('Backend exited: ' + stderr);
      }
      try {
        if ((await fetch(base + '/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Backend did not become ready: ' + stderr);

    function csvForm(filename = 'employees.csv') {
      const form = new FormData();
      form.append('file', new Blob(['sAMAccountName,mail\nalice,alice@example.test\n'], {
        type: 'text/csv',
      }), filename);
      return form;
    }

    const routes = ['/api/users/import', '/api/users/import-single'];
    for (const route of routes) {
      const withoutToken = await fetch(base + route, {
        method: 'POST', body: csvForm(),
      });
      assert.equal(withoutToken.status, 401, route + ' must enforce authentication');
      assert.ok(!fs.existsSync(usersFile), 'Unauthorized request must not create users.csv');

      const valid = await fetch(base + route, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: csvForm(),
      });
      const response = await valid.json();
      assert.equal(valid.status, 200, route + ': ' + JSON.stringify(response));
      assert.equal(response.userFilePath, usersFile);
      assert.equal(response.message, 'User data imported. Trigger generation separately via /api/generate.');
      assert.equal(fs.readFileSync(usersFile, 'utf8'),
        'sAMAccountName,mail\nalice,alice@example.test\n');

      const invalid = await fetch(base + route, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: csvForm('employees.txt'),
      });
      assert.equal(invalid.status, 400, route + ' must reject non-CSV uploads');
      assert.equal(fs.readFileSync(usersFile, 'utf8'),
        'sAMAccountName,mail\nalice,alice@example.test\n',
        'Invalid uploads must preserve the previously imported data');

      const json = await fetch(base + route, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      assert.equal(json.status, 415, route + ' must reject unsupported content types');
    }
    console.log('legacy-import-alias.test.js: ok');
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const stopped = new Promise((resolve) => server.once('exit', resolve));
      server.kill();
      await stopped;
    }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
