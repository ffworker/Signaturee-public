const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = __dirname;
require('./scripts/load-env').loadEnvironment();

const FRONTEND_PORT = process.env.FRONTEND_PORT || process.env.PORT || '3000';
const FRONTEND_HOST = process.env.FRONTEND_HOST || '0.0.0.0';

const processes = [];
let isShuttingDown = false;
let exitCode = 0;

function log(label, message) {
  process.stdout.write(`[${label}] ${message}`);
}

function startProcess(label, command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  processes.push({ label, child });

  child.stdout.on('data', (data) => log(label, data.toString()));
  child.stderr.on('data', (data) => log(label, data.toString()));
  child.on('exit', (code, signal) => {
    log(label, `exited with ${signal || code}\n`);
    if (!isShuttingDown) {
      exitCode = Number.isInteger(code) ? code : 1;
      shutdown(`${label} stopped unexpectedly`);
    }
  });

  return child;
}

function shutdown(reason = '') {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (reason) log('runner', `${reason}\n`);

  processes.forEach(({ child }) => {
    if (!child.killed) {
      child.kill(process.platform === 'win32' ? undefined : 'SIGINT');
    }
  });

  setTimeout(() => process.exit(exitCode), 100);
}

process.on('SIGINT', () => {
  exitCode = 0;
  shutdown('received SIGINT');
});
process.on('SIGTERM', () => {
  exitCode = 0;
  shutdown('received SIGTERM');
});
process.on('exit', () => {
  isShuttingDown = true;
});

startProcess('backend', process.execPath, [path.join(ROOT_DIR, 'backend', 'server.js')], {
  env: { ...process.env },
});

startProcess('frontend', process.execPath, [path.join(ROOT_DIR, 'scripts', 'start-frontend.js')], {
  env: {
    ...process.env,
    FRONTEND_PORT: String(FRONTEND_PORT),
    FRONTEND_HOST: String(FRONTEND_HOST),
  },
});
