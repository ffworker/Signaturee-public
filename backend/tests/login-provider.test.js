'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signaturee-login-provider-'));
  const port = await unusedPort();
  const env = {
    ...process.env,
    BACKEND_HOST: '127.0.0.1',
    BACKEND_PORT: String(port),
    AUTH_REQUIRED: 'true',
    AUTH_DB_LOGIN_ENABLED: 'true',
    AUTH_LDAP_ENABLED: 'true',
    AUTH_LDAP_SERVER: 'invalid.example.test',
    AUTH_LDAP_DOMAIN: 'invalid.example.test',
    AUTH_DB_PATH: path.join(dir, 'auth.db'),
    DB_PATH: path.join(dir, 'data.db'),
  };
  const seed = spawnSync(process.execPath, [
    path.join(__dirname, '../../scripts/manage-auth-users.js'),
    'add', '--db', env.AUTH_DB_PATH, '--username', 'colliding-user',
    '--password-stdin', '--role', 'admin',
  ], { env, encoding: 'utf8', input: 'test-local-pass-123\n' });
  assert.equal(seed.status, 0, seed.stderr);

  const server = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
    env, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let serverError = '';
  server.stderr.on('data', chunk => { serverError += chunk.toString(); });
  const stopped = new Promise(resolve => server.once('exit', resolve));
  const url = `http://127.0.0.1:${port}`;
  async function login(source, password = 'test-local-pass-123') {
    return fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'colliding-user', password, ...(source === null ? {} : { source }) }),
    });
  }
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Backend exited: ${serverError}`);
      try { ready = (await fetch(`${url}/health`)).ok; if (ready) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, serverError);

    for (const source of ['local', 'db', null]) {
      const response = await login(source);
      assert.equal(response.status, 200, `local provider ${source} should work`);
      const body = await response.json();
      assert.equal(body.source, 'db');
      assert.equal(body.role, 'admin');
    }
    assert.equal((await login('local', 'wrong-password')).status, 401);
    assert.equal((await login('auto', 'wrong-password')).status, 401,
      'auto mode must not fall through a colliding local admin to LDAP');
    assert.equal((await login('unknown')).status, 400);

    // Must attempt LDAP rather than granting the matching local admin.
    const ldapResponse = await login('ldap');
    const ldapBody = await ldapResponse.json();
    assert.notEqual(ldapBody.source, 'db',
      'explicit LDAP must never resolve to the local account');
    assert.notEqual(ldapBody.role, 'admin',
      'LDAP must never grant an admin session from a colliding local user');
    assert.notEqual(ldapResponse.status, 200,
      'invalid fixture domain must not authenticate the local password via LDAP');
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await stopped;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('login-provider.test.js: ok');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
