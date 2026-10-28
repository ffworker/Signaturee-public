'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

// Precedence: pre-existing process environment > explicit SIGNATUREE_ENV_FILE >
// project .env > legacy config/runner.env. Never silently combine both files.
// This module is idempotent and safe for backend, frontend and npm start.
function loadEnvironment() {
  const selected = process.env.SIGNATUREE_ENV_FILE
    ? path.resolve(process.env.SIGNATUREE_ENV_FILE)
    : (fs.existsSync(path.join(ROOT, '.env'))
      ? path.join(ROOT, '.env')
      : path.join(ROOT, 'config', 'runner.env'));
  const explicit = Boolean(process.env.SIGNATUREE_ENV_FILE);
  if (!explicit && selected === path.join(ROOT, '.env') &&
      fs.existsSync(path.join(ROOT, 'config', 'runner.env'))) {
    process.stderr.write('[config] Using root .env; ignoring old config/runner.env. Do not maintain both.\n');
  }
  if (!fs.existsSync(selected)) {
    if (explicit) throw new Error('SIGNATUREE_ENV_FILE not found: ' + selected);
    return { path: null, legacy: false };
  }
  const raw = fs.readFileSync(selected, 'utf8').replace(/^\uFEFF/, '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) throw new Error('Invalid .env assignment in ' + selected + ': ' + trimmed.slice(0, 40));
    const key = trimmed.slice(0, separator).trim();
    if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(key)) throw new Error('Invalid .env variable name: ' + key);
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
  return { path: selected, legacy: path.basename(selected).toLowerCase() !== '.env' };
}

module.exports = { loadEnvironment };
