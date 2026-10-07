const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function run() {
  const temp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'signaturee-auth-test-'));
  const port = await unusedPort();
  const env = { ...process.env, BACKEND_HOST: '127.0.0.1', BACKEND_PORT: String(port),
    AUTH_REQUIRED: 'true', AUTH_TOKENS: 'static-admin:admin', AUTH_DB_PATH: path.join(temp, 'auth.db'),
    DB_PATH: path.join(temp, 'data.db') };
  const seed = spawnSync(process.execPath, [path.join(__dirname, '../../scripts/manage-auth-users.js'),
    'add', '--username', 'test-admin', '--password-stdin', '--role', 'admin',
    '--db', env.AUTH_DB_PATH], { env, encoding: 'utf8', input: 'fixture-password-123\n' });
  assert.strictEqual(seed.status, 0, seed.stderr);
  const unsafe = spawnSync(process.execPath, [path.join(__dirname, '../server.js')], {
    env: { ...env, AUTH_REQUIRED: 'false', BACKEND_HOST: '0.0.0.0' },
    encoding: 'utf8', timeout: 1200,
  });
  assert.ok(unsafe.status !== null && unsafe.status !== 0 && /loopback/i.test(unsafe.stderr),
    'authentication-disabled backend must refuse non-loopback binding');
  const server = spawn(process.execPath, [path.join(__dirname, '../server.js')],
    { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let backendError = '';
  server.stderr.on('data', (data) => { backendError += data.toString(); });
  const stopped = new Promise((resolve) => server.once('exit', resolve));
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Backend exited: ${backendError}`);
      try { ready = (await fetch(`${base}/health`)).ok; if (ready) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'backend must start');

    const configuredDbPath = path.join(temp, 'configured-auth.db');
    const runnerEnvPath = path.join(temp, 'runner.env');
    fs.writeFileSync(runnerEnvPath, `AUTH_DB_PATH=${configuredDbPath}\n`, 'utf8');
    const bootstrapEnv = { ...process.env, SIGNATUREE_ENV_FILE: runnerEnvPath };
    delete bootstrapEnv.AUTH_DB_PATH;
    const bootstrap = spawnSync(process.execPath, [
      path.join(__dirname, '../../scripts/manage-auth-users.js'),
      'list',
    ], {
      env: bootstrapEnv,
      encoding: 'utf8',
    });
    assert.strictEqual(bootstrap.status, 0, bootstrap.stderr);
    assert.ok(bootstrap.stdout.includes(`Auth DB: ${configuredDbPath}`),
      'auth bootstrap must load AUTH_DB_PATH from runner.env');
    assert.ok(fs.existsSync(configuredDbPath), 'auth bootstrap must create the configured database');

    const staticAdmin = await fetch(`${base}/api/v2/auth/users`,
      { headers: { Authorization: 'Bearer static-admin' } });
    assert.strictEqual(staticAdmin.status, 403, 'static tokens must not access local-admin endpoints');
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test-admin', password: 'fixture-password-123' }),
    });
    assert.strictEqual(login.status, 200, 'local Admin login must work');
    const session = await login.json();
    const localAdmin = await fetch(`${base}/api/v2/auth/users`,
      { headers: { Authorization: `Bearer ${session.token}` } });
    assert.strictEqual(localAdmin.status, 200, 'local Admin must retain administration access');
    const me = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${session.token}` } });
    assert.strictEqual((await me.json()).source, 'db', 'session must retain its local-account origin');
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await stopped;
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('admin-source.test.js: ok');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
