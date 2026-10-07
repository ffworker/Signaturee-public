const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_PORT = process.env.FRONTEND_PORT || process.env.PORT || '3000';
const FRONTEND_HOST = process.env.FRONTEND_HOST || '0.0.0.0';
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(ROOT_DIR, 'frontend');

const httpServerBinCandidates = [
  // npm package currently exposes bin/http-server (no extension) on Windows too.
  path.join(ROOT_DIR, 'node_modules', 'http-server', 'bin', 'http-server'),
  // Keep compatibility with older layouts that used .js.
  path.join(ROOT_DIR, 'node_modules', 'http-server', 'bin', 'http-server.js'),
];

const httpServerBin = httpServerBinCandidates.find((candidate) => fs.existsSync(candidate));

if (!httpServerBin) {
  process.stderr.write('Missing dependency: http-server. Run "npm ci --omit=dev" in the repo root first.\n');
  process.exit(1);
}

if (!fs.existsSync(FRONTEND_DIR)) {
  process.stderr.write(`Frontend directory not found: ${FRONTEND_DIR}\n`);
  process.exit(1);
}

const args = [
  httpServerBin,
  FRONTEND_DIR,
  '-p',
  String(FRONTEND_PORT),
  '-a',
  String(FRONTEND_HOST),
  '-c-1',
];

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});
