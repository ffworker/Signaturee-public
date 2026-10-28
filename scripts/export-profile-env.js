#!/usr/bin/env node
'use strict';

// Export NON-SECRET business configuration from an old v1/v2 installation.
// No modifications to the source installation; output can be reviewed/pasted
// into a fresh installation's ignored .env file.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
function argValue(key) {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : null;
}
if (args.includes('--help') || !argValue('--root')) {
  process.stderr.write('Usage: node scripts/export-profile-env.js --root "C:\\\\old-Signaturee" [--db path-to-signaturee.db]\n');
  process.exitCode = args.includes('--help') ? 0 : 2;
} else {
  const sourceRoot = path.resolve(argValue('--root'));
  const databaseFile = path.resolve(argValue('--db') || path.join(sourceRoot, 'config', 'signaturee.db'));
  function readJson(file) {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  }
  function fromDatabase() {
    if (!fs.existsSync(databaseFile)) return null;
    const db = new DatabaseSync(databaseFile, { readOnly: true });
    try {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_kv'").get();
      if (!exists) return null;
      const row = db.prepare("SELECT value FROM app_kv WHERE key = 'profile_v2'").get();
      return row?.value ? JSON.parse(row.value) : null;
    } finally {
      db.close();
    }
  }
  try {
    let profile = fromDatabase();
    let source = 'v2 SQLite profile_v2';
    if (!profile) {
      const config = readJson(path.join(sourceRoot, 'config', 'config.json'));
      if (!config || !config.domains) {
        throw new Error('No v2 profile in SQLite and no v1 config/config.json found. Check the --root folder.');
      }
      const signatures = {};
      const map = config.securityGroupMapping || {};
      for (const [key, cfg] of Object.entries(config.domains)) {
        signatures[key] = {
          label: key,
          adGroups: Object.entries(map).filter(([, domain]) => domain === key).map(([group]) => group),
          templateHtml: cfg.templateHtml || '',
          templateTxt: cfg.templateTxt || '',
          resourceFolder: cfg.resourceFolder || '',
          faxFallback: cfg.faxFallback || '',
          customTitleAttr: cfg.customTitleAttr || '',
        };
      }
      profile = {
        organization: { name: 'Example Organization' },
        directory: { server: '', searchBase: config.ouSearchBase || '' },
        targets: { preview: { path: '' }, production: { path: '' } },
        signatures,
        secondaryTitleAttributes: config.secondaryTitleAttributes || [],
        variables: readJson(path.join(sourceRoot, 'config', 'variables.json')) || undefined,
      };
      source = 'v1 config/config.json';
    }
    const emit = (key, val) => process.stdout.write(key + '=' + String(val ?? '') + '\n');
    process.stdout.write('# Signaturee profile export from: ' + source + '\n');
    process.stdout.write('# Non-secret business config only. Review all paths, group names and template references.\n');
    process.stdout.write('# Paste these lines into your NEW .env, replacing the corresponding example settings.\n');
    emit('SIGNATUREE_CONFIG_MODE', 'env');
    emit('SIGNATUREE_ORGANIZATION_NAME', profile.organization?.name || '');
    emit('AD_SERVER', profile.directory?.server || '');
    emit('OU_SEARCH_BASE', profile.directory?.searchBase || '');
    emit('LOCAL_DEPLOYMENT_PATH', profile.targets?.preview?.path || '');
    emit('NETWORK_DEPLOYMENT_PATH', profile.targets?.production?.path || '');
    emit('SIGNATUREE_SIGNATURES_JSON', JSON.stringify(profile.signatures || {}));
    emit('SIGNATUREE_SECONDARY_TITLE_ATTRIBUTES', (profile.secondaryTitleAttributes || []).join(','));
    if (profile.variables) emit('SIGNATUREE_VARIABLES_JSON', JSON.stringify(profile.variables));
  } catch (error) {
    process.stderr.write('Could not export profile: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
