require('../scripts/load-env').loadEnvironment();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { parseLdapRoleRules, resolveLdapRuleRole } = require('./ldap-roles');
const adminEnvEditor = require('./admin-env-editor');
const {createSignaturePair, SignatureCreateError} = require('./signature-create');
const { discoverSignatureProfiles } = require('./signature-discovery');

const HOST = process.env.BACKEND_HOST || '0.0.0.0';
const PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 3001);
const BASE_PATH_RAW = process.env.BACKEND_BASE_PATH || '/';
const USE_TEST_TEMPLATES = (process.env.USE_TEST_TEMPLATES || '').toLowerCase() === 'true';
const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_INSTANCE_ID = crypto.randomBytes(12).toString('hex');
const STARTUP_ENV_REVISION = (() => {
  const selected = process.env.SIGNATUREE_ENV_FILE
    ? path.resolve(process.env.SIGNATUREE_ENV_FILE) : path.join(ROOT_DIR,'.env');
  try { return require('node:crypto').createHash('sha256').update(fs.readFileSync(selected,'utf8')).digest('hex'); }
  catch { return null; }
})();
const CONFIG_MODE = String(process.env.SIGNATUREE_CONFIG_MODE || (fs.existsSync(path.join(ROOT_DIR, '.env')) ? 'env' : 'database')).toLowerCase();
if (!['env', 'database'].includes(CONFIG_MODE)) throw new Error('SIGNATUREE_CONFIG_MODE must be env or database.');
const SECRETS_PATH = path.isAbsolute(process.env.SECRETS_PATH || '')
  ? process.env.SECRETS_PATH
  : path.join(ROOT_DIR, process.env.SECRETS_PATH || 'config/secrets.env');

// Legacy secrets.env is supported only for installations without a root .env.
// A fresh .env installation never combines config from multiple local files.
if (CONFIG_MODE === 'database' && !fs.existsSync(path.join(ROOT_DIR, '.env')) && !process.env.SIGNATUREE_ENV_FILE) loadSecretsEnv(SECRETS_PATH);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || process.env.FRONTEND_URL || '';
const CORS_ORIGINS_RAW = process.env.CORS_ORIGINS || FRONTEND_ORIGIN || '';
const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const CORS_ORIGINS = parseCorsOrigins(CORS_ORIGINS_RAW, DEFAULT_CORS_ORIGINS);
const CORS_ALLOW_ALL_ORIGINS = CORS_ORIGINS.includes('*');
const CORS_ALLOW_CREDENTIALS = parseBooleanFlag(process.env.CORS_ALLOW_CREDENTIALS || false);
const REQUEST_TIMEOUT_MS = Number.isFinite(Number(process.env.REQUEST_TIMEOUT_MS))
  ? Math.max(Number(process.env.REQUEST_TIMEOUT_MS), 1000)
  : 120000;
const MAX_JSON_BODY_BYTES = parseByteLimit(process.env.MAX_JSON_BODY_BYTES || process.env.MAX_BODY_BYTES, 1024 * 1024);
const MAX_FORM_BODY_BYTES = parseByteLimit(process.env.MAX_FORM_BODY_BYTES || process.env.MAX_BODY_BYTES, 1024 * 1024);
const MAX_MULTIPART_BODY_BYTES = parseByteLimit(process.env.MAX_MULTIPART_BODY_BYTES || process.env.MAX_UPLOAD_BYTES, 25 * 1024 * 1024);
const AUTH_REQUIRED = !['false', '0', 'no', 'n', 'off'].includes(
  String(process.env.AUTH_REQUIRED ?? process.env.API_AUTH_REQUIRED ?? 'true').trim().toLowerCase()
);
const AUTH_TOKENS = parseAuthTokens(process.env.AUTH_TOKENS || process.env.API_TOKENS || process.env.API_TOKEN || '');
const AUTH_DB_PATH = resolvePath(process.env.AUTH_DB_PATH || path.join(ROOT_DIR, 'config', 'signaturee_auth.db'));
const AUTH_DB_LOGIN_ENABLED = process.env.AUTH_DB_LOGIN_ENABLED === undefined
  ? true
  : parseBooleanFlag(process.env.AUTH_DB_LOGIN_ENABLED);
const AUTH_LDAP_ENABLED = parseBooleanFlag(process.env.AUTH_LDAP_ENABLED || false);
const AUTH_LDAP_DOMAIN = String(process.env.AUTH_LDAP_DOMAIN || '').trim();
const AUTH_LDAP_SERVER = String(process.env.AUTH_LDAP_SERVER || process.env.AD_SERVER || '').trim();
const AUTH_LDAP_CONTAINER = String(process.env.AUTH_LDAP_CONTAINER || '').trim();
const AUTH_LDAP_UPN_SUFFIX = String(process.env.AUTH_LDAP_UPN_SUFFIX || '').trim();
const AUTH_LDAP_ROLE_MAP = parseAuthRoleMap(process.env.AUTH_LDAP_ROLE_MAP || '');
const AUTH_LDAP_ROLE_RULES_PATH = String(process.env.AUTH_LDAP_ROLE_RULES_PATH || '').trim();
const AUTH_LDAP_ROLE_RULES = process.env.AUTH_LDAP_ROLE_RULES_JSON
  ? parseLdapRoleRules(JSON.parse(process.env.AUTH_LDAP_ROLE_RULES_JSON))
  : (AUTH_LDAP_ROLE_RULES_PATH
    ? parseLdapRoleRules(JSON.parse(fs.readFileSync(resolvePath(AUTH_LDAP_ROLE_RULES_PATH), 'utf8')))
    : []);
const AUTH_LDAP_ROLE_ATTRIBUTES = [...new Set(AUTH_LDAP_ROLE_RULES.map((rule) => rule.attribute).filter(Boolean))];
const AUTH_LDAP_FALLBACK_TO_DB = process.env.AUTH_LDAP_FALLBACK_TO_DB === undefined
  ? true
  : parseBooleanFlag(process.env.AUTH_LDAP_FALLBACK_TO_DB);
const AUTH_SESSION_TTL_MINUTES = Number.isFinite(Number(process.env.AUTH_SESSION_TTL_MINUTES))
  ? Math.max(5, Number(process.env.AUTH_SESSION_TTL_MINUTES))
  : 8 * 60;
const AUTH_SESSION_TTL_MS = AUTH_SESSION_TTL_MINUTES * 60 * 1000;
const AUTH_ROLE_LEVELS = { selfservice: 0, viewer: 1, it: 2, user: 2, operator: 2, admin: 3 };
const authSessions = new Map();

const BASE_PATH = normalizeBasePath(BASE_PATH_RAW);
const TEMPLATE_DIRECTORY = resolvePath(
  process.env.TEMPLATE_DIR || path.join(ROOT_DIR, CONFIG_MODE === 'env'
    ? 'config/templates'
    : (USE_TEST_TEMPLATES ? 'Templatefiles_test' : 'Templatefiles')),
);
const V2_TEMPLATE_DIRECTORY = TEMPLATE_DIRECTORY;
const CONFIG_PATH = resolvePath(process.env.CONFIG_PATH || path.join(ROOT_DIR, 'config', 'config.json'));
const VARIABLE_CONFIG_DIR = path.dirname(resolvePath(process.env.VARIABLES_PATH || path.join(ROOT_DIR, 'config', 'variables.json')));
const LOG_DIR = resolvePath(process.env.LOG_DIR || path.join(ROOT_DIR, 'Logs'));
const LOG_TAIL_BYTES = Number.isFinite(Number(process.env.LOG_TAIL_BYTES))
  ? Number(process.env.LOG_TAIL_BYTES)
  : 4000;
// Compatibility path for older file-based flows. Signaturee v2 resolves users live from AD.
const USER_FILE_PATH = resolvePath(process.env.USER_FILE_PATH || path.join(ROOT_DIR, 'config', 'users.csv'));
const AD_USER_FILE_PATH = USER_FILE_PATH;
const VARIABLES_JSON_PATH = resolvePath(process.env.VARIABLES_PATH || path.join(ROOT_DIR, 'config', 'variables.json'));
const MERGED_USER_FILE_PATH = resolvePath(
  process.env.MERGED_USER_FILE_PATH || path.join(ROOT_DIR, 'config', 'users.merged.csv'),
);
const OU_SEARCH_BASE = process.env.OU_SEARCH_BASE || '';
const AD_SERVER = process.env.AD_SERVER || '';
// Optional least-privilege account used ONLY by Get-ADUser searches. LDAP login
// still validates each end user's own credentials; SMB uses the task identity.
const AD_QUERY_USERNAME = String(process.env.AD_QUERY_USERNAME || '').trim();
const AD_QUERY_PASSWORD = String(process.env.AD_QUERY_PASSWORD || '');
if (Boolean(AD_QUERY_USERNAME) !== Boolean(AD_QUERY_PASSWORD)) {
  throw new Error('Set both AD_QUERY_USERNAME and AD_QUERY_PASSWORD, or leave both unset.');
}
const LOCAL_DEPLOYMENT_PATH = resolvePath(
  process.env.LOCAL_DEPLOYMENT_PATH || path.join(ROOT_DIR, 'generatedsignatures'),
);
const NETWORK_DEPLOYMENT_PATH = resolvePath(
  process.env.NETWORK_DEPLOYMENT_PATH || path.join(ROOT_DIR, 'generatedsignatures'),
);
const SELF_SERVICE_ARTIFACT_PATH = resolvePath(
  process.env.SELF_SERVICE_ARTIFACT_PATH || path.join(ROOT_DIR, 'generatedsignatures', '_selfservice_downloads'),
);
const GENERATE_SCRIPT_PATH = resolvePath(
  process.env.GENERATE_SCRIPT_PATH || path.join(ROOT_DIR, 'GenerateSignatures.ps1'),
);
const TAR_CMD = process.env.TAR_CMD || 'tar';
const ALLOWED_IMPORT_MODES = ['userFile', 'mass'];
const ALLOWED_DEPLOYMENT_MODES = ['Local', 'Network', 'Prompt'];
const VARIABLE_PRESET_DIR = resolvePath(
  process.env.VARIABLE_PRESET_DIR || path.join(ROOT_DIR, 'config', 'presets', 'variables'),
);
const RUNNER_BACKEND_TASK_NAME = String(process.env.RUNNER_BACKEND_TASK_NAME || 'Signaturee-Backend-Runner').trim() || 'Signaturee-Backend-Runner';
const RUNNER_FRONTEND_TASK_NAME = String(process.env.RUNNER_FRONTEND_TASK_NAME || 'Signaturee-Frontend-Runner').trim() || 'Signaturee-Frontend-Runner';
const RUNNER_FRONTEND_STATUS_URL = String(
  process.env.RUNNER_FRONTEND_STATUS_URL
  || `http://127.0.0.1:${process.env.FRONTEND_PORT || 3000}/login.html`,
).trim();
const RUNNER_STATUS_TIMEOUT_MS = Number.isFinite(Number(process.env.RUNNER_STATUS_TIMEOUT_MS))
  ? Math.max(Number(process.env.RUNNER_STATUS_TIMEOUT_MS), 1000)
  : 3000;
const RUNNER_CONTROL_START_SCRIPT = path.join(ROOT_DIR, 'scripts', 'start-runner-tasks.ps1');
const RUNNER_CONTROL_STOP_SCRIPT = path.join(ROOT_DIR, 'scripts', 'stop-runner-tasks.ps1');
function resolveDomainPresetDir() {
  if (process.env.DOMAIN_PRESET_DIR) {
    return resolvePath(process.env.DOMAIN_PRESET_DIR);
  }
  const singular = path.join(ROOT_DIR, 'config', 'presets', 'domain');
  const plural = path.join(ROOT_DIR, 'config', 'presets', 'domains');
  // Prefer existing directory (plural fallback for older layouts)
  if (fs.existsSync(plural)) return resolvePath(plural);
  return resolvePath(singular);
}
const DOMAIN_PRESET_DIR = resolveDomainPresetDir();
const DB_PATH = resolvePath(process.env.DB_PATH || path.join(ROOT_DIR, 'config', 'signaturee.db'));
const STORE_KEYS = {
  config: 'config_json',
  variables: 'variables_json',
  usersCsv: 'users_csv',
  v2Profile: 'profile_v2',
};
const PRESET_TYPES = {
  variable: 'variable',
  domain: 'domain',
};
const STORAGE_BACKUP_FORMAT = 'signaturee.storage.backup';
const STORAGE_BACKUP_VERSION = 2;
let storageDb = null;
let authDb = null;
let storageInitialized = false;
let lastVariableSchemaSave = null;
let lastVariablePresetSave = null;
let lastVariablePresetLoad = null;
let lastDomainPresetSave = null;
let lastDomainPresetLoad = null;
let lastDomainConfigSave = null;
const DEFAULT_VARIABLE_SCHEMA = {
  variables: [
    {
      id: 'givenName',
      displayName: 'Vorname',
      placeholders: ['$givenname'],
      required: true,
    },
    {
      id: 'sn',
      displayName: 'Nachname',
      placeholders: ['$sn'],
      required: true,
    },
    {
      id: 'mail',
      displayName: 'E-Mail',
      placeholders: ['$mail'],
      adProperties: ['mail', 'userPrincipalName'],
      required: true,
    },
    {
      id: 'domain',
      displayName: 'E-Mail-Domain',
      placeholders: ['$domain'],
      adProperties: ['mail'],
      required: false,
    },
    {
      id: 'department',
      displayName: 'Abteilung',
      placeholders: ['$department'],
      required: false,
    },
    {
      id: 'description',
      displayName: 'Titel/Beschreibung',
      placeholders: ['$description'],
      required: false,
    },
    {
      id: 'telephoneNumber',
      displayName: 'Telefon',
      placeholders: ['$telephonenumber'],
      adProperties: ['telephoneNumber', 'otherTelephone', 'businessPhone', 'phone'],
      required: false,
    },
    {
      id: 'mobile',
      displayName: 'Mobil',
      placeholders: ['$mobile'],
      required: false,
    },
    {
      id: 'fax',
      displayName: 'Fax',
      placeholders: ['$fax'],
      adProperties: ['facsimileTelephoneNumber', 'fax', 'otherFacsimileTelephoneNumber'],
      csvHeader: 'facsimileTelephoneNumber',
      required: false,
    },
    {
      id: 'sAMAccountName',
      displayName: 'sAMAccountName',
      placeholders: ['$sAMAccountName'],
      required: true,
    },
  ],
  ordering: ['sAMAccountName', 'mail', 'givenName', 'sn', 'department', 'description', 'telephoneNumber', 'mobile', 'fax'],
};
const BASE_AD_PROPERTIES = [
  'sAMAccountName',
  'mail',
  'givenName',
  'sn',
  'displayName',
  'userPrincipalName',
  'memberOf',
  'SID',
  'Enabled',
  'department',
  'description',
  'distinguishedName',
  'telephoneNumber',
  'otherTelephone',
  'mobile',
  'facsimileTelephoneNumber',
  'fax',
  'otherFacsimileTelephoneNumber',
];
// Import-only aliases that can break Get-ADUser when passed to -Properties.
const UNSUPPORTED_AD_PROPERTIES = new Set(['businessphone', 'phone']);

function parseDomainList(input) {
  if (Array.isArray(input)) {
    return input.map((d) => String(d).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeBasePath(input) {
  if (!input) return '/';
  let normalized = input.trim();
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function resolvePath(targetPath) {
  if (!targetPath) return targetPath;
  return path.isAbsolute(targetPath) ? targetPath : path.join(ROOT_DIR, targetPath);
}

function sanitizeFileSegment(input, fallback = 'item') {
  const cleaned = String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function resolveUserScopedPath(rootDir, username) {
  const rawUsername = String(username || '').trim();
  if (!rawUsername) {
    const error = new Error('Authenticated username missing.');
    error.status = 400;
    throw error;
  }
  const absoluteRoot = path.resolve(rootDir);
  const scoped = path.resolve(absoluteRoot, rawUsername);
  const prefix = absoluteRoot.endsWith(path.sep) ? absoluteRoot : `${absoluteRoot}${path.sep}`;
  if (!scoped.startsWith(prefix)) {
    const error = new Error('Invalid username path segment.');
    error.status = 400;
    throw error;
  }
  return scoped;
}

function resolveSelfSignatureRoot({ useOutlookFolder, deploymentMode }) {
  if (useOutlookFolder) {
    const appData = String(process.env.APPDATA || '').trim();
    if (appData) return path.join(appData, 'Microsoft', 'Signatures');
  }
  return deploymentMode === 'Network' ? NETWORK_DEPLOYMENT_PATH : LOCAL_DEPLOYMENT_PATH;
}

function resolveSelfSignatureSourceDir({ username, useOutlookFolder, deploymentMode }) {
  const root = resolveSelfSignatureRoot({ useOutlookFolder, deploymentMode });
  return resolveUserScopedPath(root, username);
}

async function snapshotSelfServiceSignatures({ username, domain, domains, deploymentMode, useOutlookFolder, sourceDirOverride }) {
  const sourceDir = sourceDirOverride || resolveSelfSignatureSourceDir({ username, useOutlookFolder, deploymentMode });
  if (!fs.existsSync(sourceDir)) {
    const error = new Error(`Generated signature folder not found: ${sourceDir}`);
    error.status = 404;
    throw error;
  }

  const userRoot = path.join(SELF_SERVICE_ARTIFACT_PATH, sanitizeFileSegment(username, 'user'));
  const latestDir = path.join(userRoot, 'latest');
  await fs.promises.rm(latestDir, { recursive: true, force: true });
  await ensureDirExists(userRoot);
  await fs.promises.cp(sourceDir, latestDir, { recursive: true, force: true });

  const createdAt = new Date().toISOString();
  const manifest = {
    username,
    domain: domain || (Array.isArray(domains) ? domains.join('-') : ''),
    domains: Array.isArray(domains) ? domains : (domain ? [domain] : []),
    deploymentMode,
    useOutlookFolder,
    createdAt,
    sourceDir,
    snapshotDir: latestDir,
  };
  await fs.promises.writeFile(path.join(userRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function buildSelfSignatureDownloadPath() {
  return '/api/self/signature/download';
}

function loadSecretsEnv(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        const idx = line.indexOf('=');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      });
  } catch (err) {
    console.warn(`Could not load secrets from ${filePath}: ${err.message}`);
  }
}
function parseBooleanFlag(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
  }
  return Boolean(value);
}

function parseCorsOrigins(raw, fallback = []) {
  const value = String(raw || '').trim();
  const base = value
    ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
    : fallback;
  return Array.from(new Set(base));
}

function parseByteLimit(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1024, Math.floor(raw));
  }
  const normalized = String(raw).trim().toLowerCase();
  const match = normalized.match(/^(\d+)(b|kb|mb|gb)?$/);
  if (!match) return fallback;
  const value = Number(match[1]);
  const unit = match[2] || 'b';
  const multiplier = unit === 'gb'
    ? 1024 * 1024 * 1024
    : unit === 'mb'
      ? 1024 * 1024
      : unit === 'kb'
        ? 1024
        : 1;
  return Math.max(1024, value * multiplier);
}

function normalizeAuthRole(input) {
  const role = String(input || '').trim().toLowerCase();
  if (role === 'admin' || role === 'it' || role === 'operator' || role === 'viewer' || role === 'user' || role === 'selfservice') return role;
  return '';
}

function parseAuthTokens(raw) {
  const value = String(raw || '').trim();
  if (!value) return new Map();
  const map = new Map();
  value.split(',').forEach((entry) => {
    const tokenEntry = String(entry || '').trim();
    if (!tokenEntry) return;
    let token = tokenEntry;
    let role = 'it';
    if (tokenEntry.includes(':')) {
      const idx = tokenEntry.indexOf(':');
      token = tokenEntry.slice(0, idx).trim();
      role = normalizeAuthRole(tokenEntry.slice(idx + 1));
    }
    if (!token || !role) return;
    map.set(token, role === 'admin' ? 'it' : role);
  });
  return map;
}

function parseAuthRoleMap(raw) {
  const value = String(raw || '').trim();
  if (!value) return new Map();
  const map = new Map();
  value.split(',').forEach((entry) => {
    const rawEntry = String(entry || '').trim();
    if (!rawEntry || !rawEntry.includes(':')) return;
    const idx = rawEntry.indexOf(':');
    const identity = rawEntry.slice(0, idx).trim().toLowerCase();
    const role = normalizeAuthRole(rawEntry.slice(idx + 1));
    if (!identity || !role) return;
    map.set(identity, role);
  });
  return map;
}

function verifyAuthPassword(password, storedHash) {
  const rawHash = String(storedHash || '').trim();
  const value = String(password || '');
  if (!rawHash || !value) return false;
  const parts = rawHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const expectedHex = parts[2];
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(value, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function getBearerToken(req) {
  const authHeader = String(req?.headers?.authorization || '').trim();
  if (/^bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^bearer\s+/i, '').trim();
  }
  const fallback = String(req?.headers?.['x-api-token'] || '').trim();
  return fallback || '';
}

function cleanupExpiredAuthSessions() {
  const now = Date.now();
  authSessions.forEach((record, token) => {
    if (!record || !record.expiresAt || record.expiresAt <= now) {
      authSessions.delete(token);
    }
  });
}

function resolveRequestAuth(req) {
  cleanupExpiredAuthSessions();
  const token = getBearerToken(req);
  if (!token) {
    return { role: '', username: '', source: '', token: '' };
  }
  const staticRole = normalizeAuthRole(AUTH_TOKENS.get(token));
  if (staticRole) {
    return {
      role: staticRole,
      username: staticRole === 'admin' ? 'token-admin' : `token-${staticRole}`,
      source: 'static-token',
      token,
    };
  }
  const session = authSessions.get(token);
  if (session && session.role && session.expiresAt > Date.now()) {
    return {
      role: normalizeAuthRole(session.role),
      username: String(session.username || ''),
      source: session.source || 'session',
      token,
      expiresAt: session.expiresAt,
    };
  }
  if (session) authSessions.delete(token);
  return { role: '', username: '', source: '', token };
}

function resolveRequestRole(req) {
  return resolveRequestAuth(req).role;
}

function issueAuthSessionToken({ role, username, source }) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + AUTH_SESSION_TTL_MS;
  authSessions.set(token, {
    role: normalizeAuthRole(role) || 'selfservice',
    username: String(username || ''),
    source: source === 'db' ? 'db' : 'ldap',
    issuedAt: Date.now(),
    expiresAt,
  });
  return { token, expiresAt };
}

function requireRole(req, res, requiredRole = 'viewer') {
  if (!AUTH_REQUIRED) return true;
  const required = normalizeAuthRole(requiredRole) || 'viewer';
  const auth = resolveRequestAuth(req);
  const callerRole = auth.role;
  if (!callerRole) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="signaturee-api"');
    sendJson(res, 401, { error: 'Authentication required.' });
    return false;
  }
  const callerLevel = AUTH_ROLE_LEVELS[callerRole] || 0;
  const requiredLevel = AUTH_ROLE_LEVELS[required] || 1;
  if (callerLevel < requiredLevel || (required === 'admin' && auth.source !== 'db')) {
    sendJson(res, 403, { error: `Insufficient role. Required: ${required}.` });
    return false;
  }
  return true;
}

function requireAnyRole(req, res, allowedRoles = []) {
  if (!AUTH_REQUIRED) return true;
  const resolvedAllowed = Array.from(new Set((allowedRoles || [])
    .map((role) => normalizeAuthRole(role))
    .filter(Boolean)));
  if (!resolvedAllowed.length) {
    sendJson(res, 500, { error: 'Server role policy misconfiguration.' });
    return false;
  }
  const auth = resolveRequestAuth(req);
  if (!auth.role) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="signaturee-api"');
    sendJson(res, 401, { error: 'Authentication required.' });
    return false;
  }
  if (!resolvedAllowed.includes(auth.role)) {
    sendJson(res, 403, { error: `Insufficient role. Allowed: ${resolvedAllowed.join(', ')}.` });
    return false;
  }
  return true;
}

function escapePowerShellString(value) {
  return String(value || '')
    .replace(/'/g, "''")
    .replace(/[\r\n]+/g, '');
}

function deriveSamAccountNameCandidate(username) {
  const raw = String(username || '').trim();
  if (!raw) return '';
  const slashIdx = raw.lastIndexOf('\\');
  const withoutDomain = slashIdx >= 0 ? raw.slice(slashIdx + 1) : raw;
  const atIdx = withoutDomain.indexOf('@');
  return (atIdx >= 0 ? withoutDomain.slice(0, atIdx) : withoutDomain).trim();
}

function buildLdapBindIdentity(username) {
  const raw = String(username || '').trim();
  if (!raw) return '';
  if (raw.includes('\\') || raw.includes('@')) return raw;
  if (AUTH_LDAP_UPN_SUFFIX) {
    return `${raw}@${AUTH_LDAP_UPN_SUFFIX}`;
  }
  if (AUTH_LDAP_DOMAIN) {
    if (AUTH_LDAP_DOMAIN.includes('.')) {
      return `${raw}@${AUTH_LDAP_DOMAIN}`;
    }
    return `${AUTH_LDAP_DOMAIN}\\${raw}`;
  }
  return raw;
}

function resolveLdapDefaultRole() {
  return 'selfservice';
}

function resolveLdapRole({ samAccountName, userPrincipalName, attributes = {}, groupDns = [] }) {
  if (resolveLdapRuleRole(AUTH_LDAP_ROLE_RULES, { attributes, groupDns }) === 'it') return 'it';
  const candidates = uniqueCaseInsensitive([
    String(samAccountName || '').toLowerCase(),
    String(userPrincipalName || '').toLowerCase(),
  ]);
  for (const identity of candidates) {
    if (AUTH_LDAP_ROLE_MAP.get(identity) === 'it') return 'it';
  }
  return resolveLdapDefaultRole();
}

async function authenticateLdapUser({ username, password, timeoutMs = 0 }) {
  const inputUsername = String(username || '').trim();
  const inputPassword = String(password || '');
  if (!AUTH_LDAP_ENABLED || !inputUsername || !inputPassword) {
    return { attempted: false, authenticated: false };
  }
  const contextName = AUTH_LDAP_SERVER || AUTH_LDAP_DOMAIN || '';
  const bindIdentity = buildLdapBindIdentity(inputUsername);
  const samCandidate = deriveSamAccountNameCandidate(inputUsername);
  const { command: powershellCommand, attempted } = await resolvePowerShellCommand();

  const psScript = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.DirectoryServices.AccountManagement',
    '$contextType = [System.DirectoryServices.AccountManagement.ContextType]::Domain',
    `$contextName = '${escapePowerShellString(contextName)}'`,
    `$container = '${escapePowerShellString(AUTH_LDAP_CONTAINER)}'`,
    'if ([string]::IsNullOrWhiteSpace($contextName)) {',
    '  if ([string]::IsNullOrWhiteSpace($container)) {',
    '    $ctx = New-Object System.DirectoryServices.AccountManagement.PrincipalContext($contextType)',
    '  } else {',
    '    $ctx = New-Object System.DirectoryServices.AccountManagement.PrincipalContext($contextType, $null, $container)',
    '  }',
    '} elseif ([string]::IsNullOrWhiteSpace($container)) {',
    '  $ctx = New-Object System.DirectoryServices.AccountManagement.PrincipalContext($contextType, $contextName)',
    '} else {',
    '  $ctx = New-Object System.DirectoryServices.AccountManagement.PrincipalContext($contextType, $contextName, $container)',
    '}',
    `$bindIdentity = '${escapePowerShellString(bindIdentity)}'`,
    '$plainPassword = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))',
    `$samCandidate = '${escapePowerShellString(samCandidate)}'`,
    `$attributeNames = @(${AUTH_LDAP_ROLE_ATTRIBUTES.map((name) => `'${name}'`).join(',')})`,
    '$user = $null',
    'if ($bindIdentity.Contains("@")) {',
    '  $user = [System.DirectoryServices.AccountManagement.UserPrincipal]::FindByIdentity($ctx, [System.DirectoryServices.AccountManagement.IdentityType]::UserPrincipalName, $bindIdentity)',
    '} elseif ($samCandidate) {',
    '  $user = [System.DirectoryServices.AccountManagement.UserPrincipal]::FindByIdentity($ctx, [System.DirectoryServices.AccountManagement.IdentityType]::SamAccountName, $samCandidate)',
    '}',
    'if (-not $user) { throw "DIRECTORY_USER_NOT_FOUND" }',
    // ValidateCredentials explicitly requires a simple SAM username, not a UPN
    // or DOMAIN\username. Resolve the identity first to prevent wrong-user binds.
    '$sam = [string]$user.SamAccountName',
    '$ok = $ctx.ValidateCredentials($sam, $plainPassword)',
    'if (-not $ok) { throw "INVALID_CREDENTIALS" }',
    '$display = [string]$user.DisplayName',
    '$upn = [string]$user.UserPrincipalName',
    '$entry = $user.GetUnderlyingObject()',
    '$attributes = @{}',
    'foreach ($name in $attributeNames) {',
    '  $attributes[$name] = @($entry.Properties[$name] | ForEach-Object { [string]$_ })',
    '}',
    '$groupDns = @($entry.Properties["memberOf"] | ForEach-Object { [string]$_ })',
    '$payload = @{',
    '  authenticated = $true',
    '  samAccountName = $sam',
    '  displayName = $display',
    '  userPrincipalName = $upn',
    '  attributes = $attributes',
    '  groupDns = $groupDns',
    '  bindIdentity = $bindIdentity',
    '}',
    '$payload | ConvertTo-Json -Compress -Depth 5',
  ].join('\n');

  return new Promise((resolve, reject) => {
    const child = spawn(powershellCommand, ['-NoLogo', '-NoProfile', '-Command', psScript]);
    let timedOut = false;
    const timeout = timeoutMs > 0 ? setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs) : null;
    child.stdin.on('error', () => {});
    child.stdin.end(`${Buffer.from(inputPassword, 'utf8').toString('base64')}\n`);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString('utf8');
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString('utf8');
    });
    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      const unavailableError = new Error(`LDAP auth unavailable: ${error.message}`);
      unavailableError.status = 503;
      unavailableError.code = 'LDAP_AUTH_UNAVAILABLE';
      unavailableError.attemptedPowerShellCommands = attempted;
      unavailableError.stderr = stderr;
      reject(unavailableError);
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (timedOut) {
        resolve({ attempted: true, authenticated: false, timeout: true });
        return;
      }
      if (code !== 0) {
        const invalidCreds = /INVALID_CREDENTIALS/i.test(stderr);
        resolve({
          attempted: true,
          authenticated: false,
          source: 'ldap',
          invalidCredentials: invalidCreds,
          stderr,
          stdout,
          attemptedPowerShellCommands: attempted,
        });
        return;
      }
      let payload = {};
      try {
        payload = stdout.trim() ? JSON.parse(stdout) : {};
      } catch {
        payload = {};
      }
      if (payload.authenticated !== true || !String(payload.samAccountName || '').trim()) {
        resolve({ attempted: true, authenticated: false, source: 'ldap', invalidCredentials: false });
        return;
      }
      const samAccountName = String(payload.samAccountName).trim();
      const userPrincipalName = String(payload.userPrincipalName || '').trim();
      const resolvedUsername = samAccountName;
      const role = resolveLdapRole({
        samAccountName,
        userPrincipalName,
        attributes: payload.attributes,
        groupDns: payload.groupDns,
      });
      resolve({
        attempted: true,
        authenticated: true,
        source: 'ldap',
        role,
        username: resolvedUsername,
        displayName: String(payload.displayName || '').trim(),
        userPrincipalName,
      });
    });
  });
}

function normalizeAdCredentials(input) {
  if (!input || typeof input !== 'object') return null;
  const username = String(input.username || '').trim();
  const password = String(input.password || '');
  if (!username || !password) return null;
  return { username, password };
}

function parseInvalidAdProperty(stderr) {
  if (!stderr) return null;
  const patterns = [/Parametername:\s*([^\s\)\],;]+)/i, /Parameter name:\s*([^\s\)\],;]+)/i];
  for (const pattern of patterns) {
    const match = stderr.match(pattern);
    if (match && match[1]) {
      return match[1].trim().replace(/[.'"]+$/g, '');
    }
  }
  return null;
}

function isSameHostOrigin(req, requestOrigin) {
  if (!requestOrigin) return false;
  try {
    const originUrl = new URL(requestOrigin);
    const hostHeader = String(req?.headers?.host || '').trim();
    if (!hostHeader) return false;
    const backendUrl = new URL(`http://${hostHeader}`);
    return originUrl.origin === backendUrl.origin;
  } catch {
    return false;
  }
}

function setCors(req, res) {
  const requestOrigin = String(req?.headers?.origin || '').trim();
  const hasOrigin = Boolean(requestOrigin);
  const originAllowed = !hasOrigin
    || CORS_ALLOW_ALL_ORIGINS
    || CORS_ORIGINS.includes(requestOrigin)
    || isSameHostOrigin(req, requestOrigin);

  if (hasOrigin) {
    res.setHeader('Vary', 'Origin');
  }
  if (!originAllowed) {
    return false;
  }

  if (hasOrigin) {
    if (CORS_ALLOW_ALL_ORIGINS && !CORS_ALLOW_CREDENTIALS) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Token');
  if (CORS_ALLOW_CREDENTIALS) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  return true;
}

function buildUserFilePath(preferredExtension) {
  const configuredExtension = path.extname(USER_FILE_PATH) || '.csv';
  const extension = preferredExtension || configuredExtension || '.csv';
  const directory = path.dirname(USER_FILE_PATH);
  const basename = path.basename(USER_FILE_PATH, configuredExtension) || 'users';
  return path.join(directory, `${basename}${extension}`);
}

function loadConfigJson() {
  if (CONFIG_MODE === 'env') return profileToLegacyConfig(getV2Profile());
  try {
    const fromDb = dbGetJson(STORE_KEYS.config);
    if (fromDb && typeof fromDb === 'object') {
      return fromDb;
    }
    if (!CONFIG_PATH || !fs.existsSync(CONFIG_PATH)) return {};
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      dbSetJson(STORE_KEYS.config, parsed);
    }
    return parsed;
  } catch (error) {
    console.warn('Unable to read config.json for OU_SEARCH_BASE:', error.message);
    return {};
  }
}

function getOuSearchBase() {
  if (OU_SEARCH_BASE) return OU_SEARCH_BASE;
  const cfg = loadConfigJson();
  return (cfg && cfg.ouSearchBase) || '';
}

function buildAdSearchFilter(search, limit) {
  return `$users = $users | Where-Object { $_.mail -like '*${search}*' -or $_.sAMAccountName -like '*${search}*' -or $_.userPrincipalName -like '*${search}*' -or $_.displayName -like '*${search}*' } | Select-Object -First ${limit}`;
}

async function queryAdUsers({
  limit = 200,
  search = '',
  searchBase = '',
  server = '',
  adProperties = [],
  credentials = null,
  runQuery: runQueryOverride = null,
  allowDefaultFallback = true,
}) {
  const cappedLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const resolvedSearchBase = searchBase || (allowDefaultFallback ? getOuSearchBase() : '');
  if (/[\r\n]/.test(String(resolvedSearchBase))) {
    const error = new Error('AD search base must be a single line.');
    error.status = 400;
    throw error;
  }
  const resolvedServer = server || (allowDefaultFallback ? AD_SERVER : '');
  const searchSafe = (search || '').replace(/['"]/g, '');
  const props = uniqueCaseInsensitive([...BASE_AD_PROPERTIES, ...(adProperties || [])]);
  const filteredProps = props.filter((prop) => {
    const key = String(prop || '').trim().toLowerCase();
    return key && !UNSUPPORTED_AD_PROPERTIES.has(key);
  });
  const credential = normalizeAdCredentials(credentials) ||
    normalizeAdCredentials({ username: AD_QUERY_USERNAME, password: AD_QUERY_PASSWORD });
  let remainingProps = filteredProps.slice();
  const skippedProperties = [];

  const { command: powershellCommand, attempted } = runQueryOverride
    ? { command: '', attempted: [] }
    : await resolvePowerShellCommand();

  const defaultRunQuery = (currentProps) => {
    const propsList = currentProps.join("','");
    const psScript = [
      '$ErrorActionPreference = "Stop"',
      '$WarningPreference = "SilentlyContinue"',
      '$VerbosePreference = "SilentlyContinue"',
      '$ProgressPreference = "SilentlyContinue"',
      'Import-Module ActiveDirectory -ErrorAction Stop -WarningAction SilentlyContinue',
      "$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      credential
        ? '$plainPassword = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine())); $securePassword = ConvertTo-SecureString $plainPassword -AsPlainText -Force'
        : '',
      credential
        ? `$adCredential = New-Object System.Management.Automation.PSCredential('${escapePowerShellString(
            credential.username
          )}', $securePassword)`
        : '',
      `$props = '${propsList}'`,
      `$params = @{ Filter = 'Enabled -eq $true' }`,
      searchSafe ? '' : `$params['ResultSetSize'] = ${cappedLimit}`,
      `$params['Properties'] = $props`,
      resolvedSearchBase ? `$params['SearchBase'] = @'\n${resolvedSearchBase}\n'@` : '',
      resolvedServer ? `$params['Server'] = '${resolvedServer.replace(/'/g, "''")}'` : '',
      credential ? `$params['Credential'] = $adCredential` : '',
      `$users = Get-ADUser @params -WarningAction SilentlyContinue`,
      searchSafe ? buildAdSearchFilter(searchSafe, cappedLimit) : '',
      `$users | Select-Object ${currentProps.join(',')} | ConvertTo-Json -Depth 4`
    ]
      .filter(Boolean)
      .join('; ');

    return new Promise((resolve, reject) => {
      const child = spawn(powershellCommand, ['-NoLogo', '-NoProfile', '-Command', psScript]);
      if (credential) {
        child.stdin.on('error', () => {});
        child.stdin.end(`${Buffer.from(credential.password, 'utf8').toString('base64')}\n`);
      } else {
        child.stdin.end();
      }
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString('utf8');
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.on('error', (error) => {
        error.status = 503;
        error.attemptedPowerShellCommands = attempted;
        error.stderr = `${stderr}${stderr ? '\n' : ''}${error.message}`.trim();
        reject(error);
      });
    });
  };

  const runQuery = runQueryOverride || defaultRunQuery;

  let lastStdout = '';
  let lastStderr = '';

  while (remainingProps.length > 0) {
    const { code, stdout, stderr } = await runQuery(remainingProps);
    lastStdout = stdout;
    lastStderr = stderr;
    if (code === 0) {
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : [];
        const rawUsers = Array.isArray(parsed) ? parsed : [parsed];
        const shaped = rawUsers
          .map((entry) => shapeUserListEntry(entry))
          .filter(Boolean);
        return { users: shaped, rawUsers, stdout, attempted, skippedProperties };
      } catch (error) {
        error.status = 500;
        error.stdout = stdout;
        error.stderr = stderr;
        throw error;
      }
    }

    const invalidProp = parseInvalidAdProperty(stderr);
    if (!invalidProp) break;
    const index = remainingProps.findIndex(
      (prop) => String(prop || '').trim().toLowerCase() === invalidProp.toLowerCase()
    );
    if (index === -1) break;
    const [removed] = remainingProps.splice(index, 1);
    skippedProperties.push(removed);
  }

  const error = new Error('AD query failed');
  error.status = 500;
  error.stdout = lastStdout;
  error.stderr = lastStderr;
  error.attemptedPowerShellCommands = attempted;
  if (skippedProperties.length) error.skippedProperties = skippedProperties;
  throw error;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  if (res.writableEnded || res.destroyed) {
    return;
  }
  if (res.headersSent) {
    res.end(body);
    return;
  }
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function getErrorStatus(error, fallback = 500) {
  const code = Number(error?.status);
  return Number.isFinite(code) && code >= 100 && code <= 599 ? code : fallback;
}

function readBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        const error = new Error(`Payload too large (${total} bytes). Limit is ${maxBytes} bytes.`);
        error.status = 413;
        error.code = 'PAYLOAD_TOO_LARGE';
        settled = true;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

function parseJsonBody(req) {
  return readBody(req, MAX_JSON_BODY_BYTES)
    .then((buffer) => {
      if (!buffer.length) return {};
      return JSON.parse(buffer.toString('utf8'));
    })
    .catch((error) => {
      if (error?.status) {
        throw error;
      }
      const wrapped = new Error(`Invalid JSON body: ${error.message}`);
      wrapped.status = 400;
      wrapped.code = 'INVALID_JSON_BODY';
      throw wrapped;
    });
}

function parseUrlEncodedBody(req) {
  return readBody(req, MAX_FORM_BODY_BYTES).then((buffer) => {
    const params = new URLSearchParams(buffer.toString('utf8'));
    const result = {};
    params.forEach((value, key) => {
      if (result[key]) {
        result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
      } else {
        result[key] = value;
      }
    });
    return result;
  });
}

function normalizeSelectionList(input) {
  if (Array.isArray(input)) {
    return input
      .map((value) => String(value).trim())
      .filter(Boolean)
      .join(',');
  }
  if (typeof input === 'string') {
    return input.trim();
  }
  return '';
}

function getLatestLogFile() {
  try {
    if (!LOG_DIR || !fs.existsSync(LOG_DIR)) return null;
    const entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.log'))
      .map((entry) => {
        const fullPath = path.join(LOG_DIR, entry.name);
        const stats = fs.statSync(fullPath);
        return {
          name: entry.name,
          fullPath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        };
      });

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0];
  } catch (error) {
    console.warn('Could not read log directory:', error);
    return null;
  }
}

function readLogTail(filePath, tailBytes) {
  const stats = fs.statSync(filePath);
  const size = stats.size || 0;
  if (size === 0) {
    return { data: '', start: 0, bytesRead: 0, size };
  }

  const start = Math.max(0, size - tailBytes);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, length, start);
  fs.closeSync(fd);

  return {
    data: buffer.toString('utf8'),
    start,
    bytesRead: length,
    size,
    modified: stats.mtime.toISOString(),
  };
}

function normalizeUsersPayload(payload, singleMode) {
  if (payload === undefined || payload === null) return null;
  if (singleMode) return [payload];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === 'object') return [payload];
  return null;
}

async function parseMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new Error('Missing multipart boundary');
  }
  const boundary = `--${boundaryMatch[1]}`;
  const bodyBuffer = await readBody(req, MAX_MULTIPART_BODY_BYTES);
  const bodyString = bodyBuffer.toString('binary');
  const rawParts = bodyString.split(boundary).slice(1, -1);
  const fields = {};
  const files = [];

  rawParts.forEach((part) => {
    const cleaned = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    if (!cleaned) return;
    const [rawHeaders, ...rest] = cleaned.split('\r\n\r\n');
    const content = rest.join('\r\n\r\n');
    const headers = rawHeaders.split('\r\n');
    const dispositionHeader = headers.find((line) => line.toLowerCase().startsWith('content-disposition'));
    if (!dispositionHeader) return;
    const nameMatch = dispositionHeader.match(/name="?([^"]+)"?/i);
    const filenameMatch = dispositionHeader.match(/filename="?([^";]+)"?/i);
    const contentTypeHeader = headers.find((line) => line.toLowerCase().startsWith('content-type'));
    const entryContentType = contentTypeHeader ? contentTypeHeader.split(':')[1].trim() : 'application/octet-stream';
    const valueBuffer = Buffer.from(content.replace(/\r\n$/, ''), 'binary');

    if (filenameMatch) {
      files.push({
        name: nameMatch ? nameMatch[1] : 'file',
        filename: filenameMatch[1],
        contentType: entryContentType,
        data: valueBuffer,
      });
    } else if (nameMatch) {
      const key = nameMatch[1];
      const value = valueBuffer.toString('utf8');
      if (fields[key]) {
        fields[key] = Array.isArray(fields[key]) ? [...fields[key], value] : [fields[key], value];
      } else {
        fields[key] = value;
      }
    }
  });

  return { fields, files };
}

async function ensureDirectory(filePath) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

async function ensureDirExists(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

function initStorageDb() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    storageDb = new DatabaseSync(DB_PATH);
    storageDb.exec(`
      CREATE TABLE IF NOT EXISTS app_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_presets (
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (type, name)
      );
    `);
  } catch (error) {
    storageDb = null;
    console.warn(`SQLite storage unavailable; falling back to file storage: ${error.message}`);
  }
}

function initAuthDb() {
  try {
    fs.mkdirSync(path.dirname(AUTH_DB_PATH), { recursive: true });
    authDb = new DatabaseSync(AUTH_DB_PATH);
    authDb.exec(`
      CREATE TABLE IF NOT EXISTS auth_users (
        username TEXT PRIMARY KEY COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        display_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } catch (error) {
    authDb = null;
    console.warn(`SQLite auth storage unavailable; login disabled: ${error.message}`);
  }
}

function getAuthUserByUsername(username) {
  if (!authDb) return null;
  const safeUsername = String(username || '').trim();
  if (!safeUsername) return null;
  const row = authDb
    .prepare(
      `SELECT username, password_hash AS passwordHash, role, enabled, display_name AS displayName, created_at AS createdAt, updated_at AS updatedAt
       FROM auth_users
       WHERE username = ?
       LIMIT 1`,
    )
    .get(safeUsername);
  if (!row) return null;
  const role = normalizeAuthRole(row.role);
  if (!role) return null;
  return {
    username: String(row.username || ''),
    passwordHash: String(row.passwordHash || ''),
    role,
    enabled: Number(row.enabled || 0) === 1,
    displayName: String(row.displayName || ''),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
  };
}

function getAuthUserCount() {
  if (!authDb) return 0;
  const row = authDb.prepare('SELECT COUNT(*) AS count FROM auth_users').get();
  return Number(row?.count || 0);
}

function hashAuthPassword(password) {
  const value = String(password || '');
  if (!value) {
    const error = new Error('Password is required.');
    error.status = 400;
    throw error;
  }
  if (value.length < 8) {
    const error = new Error('Password must be at least 8 characters.');
    error.status = 400;
    throw error;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(value, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function listLocalAuthUsers() {
  if (!authDb) return [];
  return authDb.prepare(
    `SELECT username, role, enabled, display_name AS displayName, created_at AS createdAt, updated_at AS updatedAt
     FROM auth_users
     ORDER BY username COLLATE NOCASE ASC`
  ).all().map((row) => ({
    username: String(row.username || ''),
    role: normalizeAuthRole(row.role) || 'selfservice',
    enabled: Number(row.enabled || 0) === 1,
    displayName: String(row.displayName || ''),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
    source: 'local',
  }));
}

function enabledAdminCount(excludingUsername = '') {
  if (!authDb) return 0;
  const excluded = String(excludingUsername || '').trim();
  const row = excluded
    ? authDb.prepare("SELECT COUNT(*) AS count FROM auth_users WHERE enabled = 1 AND role = 'admin' AND username <> ? COLLATE NOCASE").get(excluded)
    : authDb.prepare("SELECT COUNT(*) AS count FROM auth_users WHERE enabled = 1 AND role = 'admin'").get();
  return Number(row?.count || 0);
}

function normalizeManagedAuthRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'admin') return 'admin';
  if (role === 'it' || role === 'operator' || role === 'user') return 'it';
  return '';
}

function authSystemSnapshot() {
  return {
    localLoginEnabled: AUTH_DB_LOGIN_ENABLED,
    ldap: {
      enabled: AUTH_LDAP_ENABLED,
      domain: AUTH_LDAP_DOMAIN,
      server: AUTH_LDAP_SERVER,
      container: AUTH_LDAP_CONTAINER,
      defaultRole: resolveLdapDefaultRole(),
      roleRules: AUTH_LDAP_ROLE_RULES.length,
      upnSuffix: AUTH_LDAP_UPN_SUFFIX,
      fallbackToLocal: AUTH_LDAP_FALLBACK_TO_DB,
    },
  };
}

// Admin-only diagnostic. Never returns, persists or logs the submitted password;
// an attempted LDAP bind is performed by the same function used for real logins.
let lastLdapDiagnosticAt = 0;
let ldapDiagnosticBusy = false;
function classifyLdapDiagnosticFailure(result) {
  const detail = String(result?.stderr || '');
  if (result?.timeout) {
    return {
      code: 'LDAP_TIMEOUT',
      message: 'Zeitüberschreitung beim LDAP-Test (25 Sekunden).',
      hint: 'DC-Erreichbarkeit, DNS und LDAP-Kontext prüfen.',
    };
  }
  if (result?.invalidCredentials) {
    return {
      code: 'INVALID_CREDENTIALS',
      message: 'AD-Anmeldedaten wurden abgelehnt.',
      hint: 'Benutzername/UPN, Passwort und Kontostatus prüfen. Gegebenenfalls AUTH_LDAP_UPN_SUFFIX prüfen.',
    };
  }
  if (/DIRECTORY_USER_NOT_FOUND|AUTHENTICATED_USER_NOT_FOUND/i.test(detail)) {
    return {
      code: 'USER_LOOKUP_FAILED',
      message: 'Der AD-Benutzer konnte anhand des angegebenen Namens oder UPN nicht gefunden werden (vor der Passwortprüfung).',
      hint: 'AUTH_LDAP_CONTAINER testweise weglassen und kontrollieren, ob die Benutzer-OU den Account enthält.',
    };
  }
  if (/server.*(not operational|could not be contacted)|domain.*(not.*available|not.*exist)|LDAP_SERVER_DOWN|0x8007203a/i.test(detail)) {
    return {
      code: 'DIRECTORY_UNAVAILABLE',
      message: 'Domänencontroller oder LDAP-Dienst nicht erreichbar.',
      hint: 'DNS, Domain-Join, Netzwerk und AUTH_LDAP_SERVER / AUTH_LDAP_DOMAIN prüfen.',
    };
  }
  if (/container|distinguished name|0x80072030|0x8007054b/i.test(detail)) {
    return {
      code: 'DIRECTORY_CONTEXT_ERROR',
      message: 'LDAP-Kontext oder Suchcontainer konnte nicht geöffnet werden.',
      hint: 'AUTH_LDAP_CONTAINER prüfen oder vorübergehend auskommentieren; Domain und DC prüfen.',
    };
  }
  return {
    code: 'LDAP_BIND_OR_LOOKUP_FAILED',
    message: 'Die LDAP-Authentifizierung oder anschließende Benutzerauflösung ist fehlgeschlagen.',
    hint: 'AUTH_LDAP_DOMAIN/SERVER, UPN-Suffix und Container prüfen; ggf. Server-Ereignisprotokoll für Details ansehen.',
  };
}

async function handleV2LdapTest(req, res) {
  if (!AUTH_LDAP_ENABLED) {
    return sendJson(res, 200, {
      ok: false, mode: 'configuration', code: 'LDAP_DISABLED',
      message: 'LDAP ist deaktiviert. AUTH_LDAP_ENABLED=true in .env setzen und Backend neu starten.',
      config: authSystemSnapshot().ldap,
    });
  }
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return sendJson(res, 415, { error: 'LDAP-Test erwartet application/json.' });
  }
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (error) {
    return sendJson(res, getErrorStatus(error, 400), { error: 'Ungültiger JSON-Body.' });
  }
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  if (!username && !password) {
    return sendJson(res, 200, {
      ok: true, mode: 'configuration', code: 'CONFIGURATION_LOADED',
      message: 'LDAP-Konfiguration geladen. Das bestätigt noch KEINE Verbindung oder Anmeldung. Für einen echten Test AD-Konto und Passwort eingeben.',
      config: authSystemSnapshot().ldap,
    });
  }
  if (!username || !password) {
    return sendJson(res, 400, { error: 'Für einen echten LDAP-Test Benutzername UND Passwort angeben.' });
  }
  if (username.length > 256 || password.length > 1024) {
    return sendJson(res, 400, { error: 'Eingabe zu lang.' });
  }
  if (ldapDiagnosticBusy || Date.now() - lastLdapDiagnosticAt < 4000) {
    return sendJson(res, 429, { error: 'LDAP-Test läuft bereits oder wurde kürzlich ausgeführt. Bitte kurz warten.' });
  }
  ldapDiagnosticBusy = true;
  lastLdapDiagnosticAt = Date.now();
  try {
    const result = await authenticateLdapUser({ username, password, timeoutMs: 25000 });
    if (result.authenticated) {
      return sendJson(res, 200, {
        ok: true, mode: 'credentials', code: 'LDAP_AUTHENTICATED',
        message: 'AD-Anmeldung und Benutzerauflösung erfolgreich.',
        account: { username: result.username, role: result.role, displayName: result.displayName },
      });
    }
    const failure = classifyLdapDiagnosticFailure(result);
    return sendJson(res, 200, { ok: false, mode: 'credentials', ...failure });
  } catch (error) {
    // Powershell child-process errors may contain system details. Do not reflect raw
    // stderr, PowerShell invocation or any submitted credentials to the browser.
    return sendJson(res, 200, {
      ok: false, mode: 'credentials', code: error.code === 'POWERSHELL_NOT_AVAILABLE' ? 'POWERSHELL_UNAVAILABLE' : 'LDAP_DIAGNOSTIC_ERROR',
      message: error.code === 'POWERSHELL_NOT_AVAILABLE'
        ? 'PowerShell ist auf dem Backend nicht verfügbar.'
        : 'LDAP-Test konnte nicht ausgeführt werden.',
      hint: 'Backend-Dienstkonto, PowerShell-Installation und AD/LDAP-Konfiguration prüfen.',
    });
  } finally {
    ldapDiagnosticBusy = false;
  }
}

async function handleV2AuthUsersList(_req, res) {
  if (!authDb) return sendJson(res, 503, { error: 'Auth database unavailable.' });
  return sendJson(res, 200, {
    users: listLocalAuthUsers(),
    system: authSystemSnapshot(),
  });
}

async function handleV2AuthUserCreate(req, res) {
  try {
    if (!authDb) return sendJson(res, 503, { error: 'Auth database unavailable.' });
    const body = await parseJsonBody(req);
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    const role = normalizeManagedAuthRole(body?.role || 'it');
    const displayName = String(body?.displayName || '').trim();
    const enabled = body?.enabled === undefined ? true : parseBooleanFlag(body.enabled);
    if (!username) return sendJson(res, 400, { error: 'Username is required.' });
    if (!role) return sendJson(res, 400, { error: 'Role must be admin or it.' });
    if (getAuthUserByUsername(username)) return sendJson(res, 409, { error: 'User already exists.' });

    const now = new Date().toISOString();
    authDb.prepare(
      `INSERT INTO auth_users (username, password_hash, role, enabled, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(username, hashAuthPassword(password), role, enabled ? 1 : 0, displayName, now, now);

    return sendJson(res, 201, {
      message: 'Local Signaturee user created.',
      user: listLocalAuthUsers().find((entry) => entry.username.toLowerCase() === username.toLowerCase()),
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message, code: error.code });
  }
}

async function handleV2AuthUserUpdate(req, res, usernameRaw) {
  try {
    if (!authDb) return sendJson(res, 503, { error: 'Auth database unavailable.' });
    const username = decodeURIComponent(String(usernameRaw || '')).trim();
    const existing = getAuthUserByUsername(username);
    if (!existing) return sendJson(res, 404, { error: 'User not found.' });
    const body = await parseJsonBody(req);
    const nextRole = body?.role === undefined ? existing.role : normalizeManagedAuthRole(body.role);
    const nextEnabled = body?.enabled === undefined ? existing.enabled : parseBooleanFlag(body.enabled);
    const nextDisplayName = body?.displayName === undefined ? existing.displayName : String(body.displayName || '').trim();

    if (!nextRole) return sendJson(res, 400, { error: 'Role must be admin or it.' });
    const removingLastAdmin = existing.role === 'admin'
      && existing.enabled
      && (nextRole !== 'admin' || !nextEnabled)
      && enabledAdminCount(existing.username) === 0;
    if (removingLastAdmin) {
      return sendJson(res, 409, { error: 'Cannot disable or demote the last enabled admin.' });
    }

    const updates = ['role = ?', 'enabled = ?', 'display_name = ?', 'updated_at = ?'];
    const values = [nextRole, nextEnabled ? 1 : 0, nextDisplayName, new Date().toISOString()];
    if (body?.password !== undefined && String(body.password || '')) {
      updates.push('password_hash = ?');
      values.push(hashAuthPassword(body.password));
    }
    values.push(existing.username);
    authDb.prepare(`UPDATE auth_users SET ${updates.join(', ')} WHERE username = ?`).run(...values);

    return sendJson(res, 200, {
      message: 'Local Signaturee user updated.',
      user: listLocalAuthUsers().find((entry) => entry.username.toLowerCase() === existing.username.toLowerCase()),
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message, code: error.code });
  }
}

async function handleV2AuthUserDelete(_req, res, usernameRaw) {
  try {
    if (!authDb) return sendJson(res, 503, { error: 'Auth database unavailable.' });
    const username = decodeURIComponent(String(usernameRaw || '')).trim();
    const existing = getAuthUserByUsername(username);
    if (!existing) return sendJson(res, 404, { error: 'User not found.' });
    if (existing.role === 'admin' && existing.enabled && enabledAdminCount(existing.username) === 0) {
      return sendJson(res, 409, { error: 'Cannot delete the last enabled admin.' });
    }
    authDb.prepare('DELETE FROM auth_users WHERE username = ?').run(existing.username);
    return sendJson(res, 200, { message: 'Local Signaturee user deleted.' });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message, code: error.code });
  }
}

function dbGetText(key) {
  if (!storageDb) return null;
  const row = storageDb.prepare('SELECT value FROM app_kv WHERE key = ?').get(key);
  return row ? String(row.value || '') : null;
}

function dbSetText(key, value) {
  if (!storageDb) return;
  storageDb
    .prepare(
      `INSERT INTO app_kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, String(value ?? ''), new Date().toISOString());
}

function dbGetJson(key) {
  const raw = dbGetText(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function dbSetJson(key, value) {
  dbSetText(key, JSON.stringify(value));
}

function dbListPresetNames(type) {
  if (!storageDb) return [];
  const rows = storageDb
    .prepare('SELECT name FROM app_presets WHERE type = ? ORDER BY name COLLATE NOCASE ASC')
    .all(type);
  return rows.map((row) => String(row.name || '')).filter(Boolean);
}

function dbGetPreset(type, name) {
  if (!storageDb) return null;
  const row = storageDb
    .prepare('SELECT payload FROM app_presets WHERE type = ? AND name = ?')
    .get(type, name);
  if (!row) return null;
  try {
    return JSON.parse(String(row.payload || ''));
  } catch {
    return null;
  }
}

function dbSavePreset(type, name, payload) {
  if (!storageDb) return;
  storageDb
    .prepare(
      `INSERT INTO app_presets (type, name, payload, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(type, name) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    )
    .run(type, name, JSON.stringify(payload), new Date().toISOString());
}

function dbDeletePreset(type, name) {
  if (!storageDb) return;
  storageDb.prepare('DELETE FROM app_presets WHERE type = ? AND name = ?').run(type, name);
}

function dbDeletePresetsByType(type) {
  if (!storageDb) return;
  storageDb.prepare('DELETE FROM app_presets WHERE type = ?').run(type);
}

function dbGetLatestUpdate(type = null) {
  if (!storageDb) return null;
  let row;
  if (type) {
    row = storageDb
      .prepare('SELECT MAX(updated_at) AS updatedAt FROM app_presets WHERE type = ?')
      .get(type);
  } else {
    row = storageDb.prepare('SELECT MAX(updated_at) AS updatedAt FROM app_kv').get();
  }
  return row && row.updatedAt ? String(row.updatedAt) : null;
}

function dbGetKeyUpdatedAt(key) {
  if (!storageDb) return null;
  const row = storageDb.prepare('SELECT updated_at AS updatedAt FROM app_kv WHERE key = ?').get(key);
  return row && row.updatedAt ? String(row.updatedAt) : null;
}

function getIsoMtimeSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.statSync(filePath).mtime.toISOString();
    }
  } catch {
    // ignore
  }
  return null;
}

function getNewestPresetMtime(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return null;
    const entries = fs.readdirSync(dirPath).filter((name) => name.toLowerCase().endsWith('.json'));
    if (!entries.length) return null;
    let latest = null;
    entries.forEach((name) => {
      const full = path.join(dirPath, name);
      const stat = fs.statSync(full);
      if (!latest || stat.mtime > latest) {
        latest = stat.mtime;
      }
    });
    return latest ? latest.toISOString() : null;
  } catch {
    return null;
  }
}

function sanitizeSegments(filename) {
  const segments = filename.split(/\\|\//).filter((segment) => segment && segment !== '..');
  return segments;
}

async function saveIncomingFile(file, targetDirectory) {
  const segments = sanitizeSegments(file.filename);
  const targetPath = path.join(targetDirectory, ...segments);
  await ensureDirectory(targetPath);
  await fs.promises.writeFile(targetPath, file.data);
  return targetPath;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toBackupTimestampLabel(inputDate = new Date()) {
  const date = inputDate instanceof Date ? inputDate : new Date(inputDate);
  if (Number.isNaN(date.getTime())) return `${Date.now()}`;
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '')
    .replace(/-/g, '')
    .replace('T', '-');
}

function getPresetDirectoryForType(type) {
  if (type === PRESET_TYPES.domain) return DOMAIN_PRESET_DIR;
  if (type === PRESET_TYPES.variable) return VARIABLE_PRESET_DIR;
  return '';
}

function getPresetFilterForType(type) {
  if (type === PRESET_TYPES.variable) {
    return (name) => name.toLowerCase() !== 'variables';
  }
  return null;
}

function readPresetMapFromDb(type) {
  const filterFn = getPresetFilterForType(type);
  const map = {};
  dbListPresetNames(type).forEach((name) => {
    if (filterFn && !filterFn(name)) return;
    const payload = dbGetPreset(type, name);
    if (payload === null || payload === undefined) return;
    map[name] = payload;
  });
  return map;
}

function readPresetMapFromFiles(type) {
  const dirPath = getPresetDirectoryForType(type);
  const filterFn = getPresetFilterForType(type);
  const map = {};
  if (!dirPath || !fs.existsSync(dirPath)) return map;
  const names = fs.readdirSync(dirPath).filter((name) => name.toLowerCase().endsWith('.json'));
  names.forEach((filename) => {
    const name = path.basename(filename, '.json');
    if (filterFn && !filterFn(name)) return;
    try {
      const raw = fs.readFileSync(path.join(dirPath, filename), 'utf8');
      map[name] = JSON.parse(raw);
    } catch (error) {
      console.warn(`Skipping unreadable preset file ${type}/${name}: ${error.message}`);
    }
  });
  return map;
}

function readPresetMap(type) {
  const dirPath = getPresetDirectoryForType(type);
  const filterFn = getPresetFilterForType(type);
  importPresetDirectoryToDb(type, dirPath, filterFn);
  const fromDb = readPresetMapFromDb(type);
  if (Object.keys(fromDb).length) return fromDb;
  return readPresetMapFromFiles(type);
}

async function clearPresetStorage(type) {
  const dirPath = getPresetDirectoryForType(type);
  const filterFn = getPresetFilterForType(type);
  if (storageDb) {
    if (filterFn) {
      dbListPresetNames(type).forEach((name) => {
        if (filterFn(name)) dbDeletePreset(type, name);
      });
    } else {
      dbDeletePresetsByType(type);
    }
  }

  if (!dirPath || !fs.existsSync(dirPath)) return;
  const names = await fs.promises.readdir(dirPath);
  for (const filename of names) {
    if (!filename.toLowerCase().endsWith('.json')) continue;
    const name = path.basename(filename, '.json');
    if (filterFn && !filterFn(name)) continue;
    await fs.promises.unlink(path.join(dirPath, filename)).catch(() => {});
  }
}

function normalizePresetMap(raw, label, errors) {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) {
    errors.push(`${label} must be an object map.`);
    return {};
  }

  const normalized = {};
  Object.entries(raw).forEach(([name, payload]) => {
    const safeName = String(name || '').trim();
    if (!safeName || !/^[a-zA-Z0-9._-]+$/.test(safeName)) {
      errors.push(`Invalid preset name in ${label}: ${name}`);
      return;
    }
    if (!isPlainObject(payload)) {
      errors.push(`Preset "${safeName}" in ${label} must be a JSON object.`);
      return;
    }
    normalized[safeName] = payload;
  });
  return normalized;
}

function normalizeStorageBackupPayload(rawPayload) {
  const errors = [];
  const payload = isPlainObject(rawPayload) ? rawPayload : null;
  if (!payload) {
    return { errors: ['Backup payload must be a JSON object.'] };
  }

  const data = isPlainObject(payload.data) ? payload.data : payload;
  const config = data.config;
  const variables = data.variables;
  const v2Profile = data.v2Profile ?? data.profileV2 ?? data.profile_v2;
  const presets = isPlainObject(data.presets) ? data.presets : {};
  const domainPresetsRaw = presets.domain ?? presets.domains;
  const variablePresetsRaw = presets.variable ?? presets.variables;
  const domainPresets = normalizePresetMap(domainPresetsRaw, 'presets.domain', errors);
  const variablePresets = normalizePresetMap(variablePresetsRaw, 'presets.variable', errors);

  if (config !== undefined && !isPlainObject(config)) {
    errors.push('config must be an object when provided.');
  }
  if (variables !== undefined) {
    if (!isPlainObject(variables) || !Array.isArray(variables.variables)) {
      errors.push('variables must be an object with a variables array.');
    }
  }
  if (v2Profile !== undefined && !isPlainObject(v2Profile)) {
    errors.push('v2Profile must be an object when provided.');
  }

  const hasData =
    config !== undefined ||
    variables !== undefined ||
    v2Profile !== undefined ||
    Object.keys(domainPresets).length > 0 ||
    Object.keys(variablePresets).length > 0;
  if (!hasData) {
    errors.push('Backup payload has no restorable data.');
  }

  return {
    errors,
    backup: {
      config: config !== undefined ? config : null,
      variables: variables !== undefined ? variables : null,
      v2Profile: v2Profile !== undefined ? v2Profile : null,
      presets: {
        domain: domainPresets,
        variable: variablePresets,
      },
    },
  };
}

function buildStorageBackupPayload() {
  return {
    format: STORAGE_BACKUP_FORMAT,
    version: STORAGE_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    source: {
      dbPath: DB_PATH,
      hasDb: Boolean(storageDb),
    },
    data: {
      config: loadConfigJson(),
      variables: loadVariableSchema(),
      v2Profile: getV2Profile(),
      presets: {
        domain: readPresetMap(PRESET_TYPES.domain),
        variable: readPresetMap(PRESET_TYPES.variable),
      },
    },
  };
}

async function restoreStorageFromBackup(backup, options = {}) {
  const replacePresets = options.replacePresets !== false;
  const nowIso = new Date().toISOString();

  const config = isPlainObject(backup.config) ? backup.config : null;
  const variables = isPlainObject(backup.variables) ? backup.variables : null;
  const v2Profile = isPlainObject(backup.v2Profile) ? normalizeV2Profile(backup.v2Profile) : null;
  const domainPresets = isPlainObject(backup.presets?.domain) ? backup.presets.domain : {};
  const variablePresets = isPlainObject(backup.presets?.variable) ? backup.presets.variable : {};

  if (config) {
    await persistConfigJson(config);
    lastDomainConfigSave = nowIso;
  }
  if (variables) {
    await persistVariableSchema(variables);
    lastVariableSchemaSave = nowIso;
  }
  if (v2Profile) {
    dbSetJson(STORE_KEYS.v2Profile, v2Profile);
  }

  if (replacePresets) {
    await clearPresetStorage(PRESET_TYPES.domain);
    await clearPresetStorage(PRESET_TYPES.variable);
  }
  await ensureDirExists(DOMAIN_PRESET_DIR);
  await ensureDirExists(VARIABLE_PRESET_DIR);

  for (const [name, payload] of Object.entries(domainPresets)) {
    dbSavePreset(PRESET_TYPES.domain, name, payload);
    await fs.promises.writeFile(path.join(DOMAIN_PRESET_DIR, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  for (const [name, payload] of Object.entries(variablePresets)) {
    dbSavePreset(PRESET_TYPES.variable, name, payload);
    await fs.promises.writeFile(path.join(VARIABLE_PRESET_DIR, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  if (Object.keys(domainPresets).length) lastDomainPresetSave = nowIso;
  if (Object.keys(variablePresets).length) lastVariablePresetSave = nowIso;

  syncDbStorageToFiles();

  return {
    replacedPresets: replacePresets,
    domainPresetCount: Object.keys(domainPresets).length,
    variablePresetCount: Object.keys(variablePresets).length,
    restoredConfig: Boolean(config),
    restoredVariables: Boolean(variables),
    restoredV2Profile: Boolean(v2Profile),
  };
}

let detectedPowerShellPromise;
let lastUserFilePath = USER_FILE_PATH;
const DEFAULT_USER_FILE_CANDIDATES = [
  path.join(ROOT_DIR, 'config', 'users.csv'),
  path.join(ROOT_DIR, 'config', 'users.json'),
  path.join(ROOT_DIR, 'config', 'users.yml'),
  path.join(ROOT_DIR, 'config', 'users.yaml'),
];

function loadVariableSchema() {
  if (CONFIG_MODE === 'env') return getV2Profile().variables;
  try {
    const fromDb = dbGetJson(STORE_KEYS.variables);
    if (fromDb && Array.isArray(fromDb.variables)) {
      return normalizeVariableSchemaPayload(fromDb);
    }
    if (fs.existsSync(VARIABLES_JSON_PATH)) {
      const raw = fs.readFileSync(VARIABLES_JSON_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.variables)) {
        const normalized = normalizeVariableSchemaPayload(parsed);
        dbSetJson(STORE_KEYS.variables, normalized);
        return normalized;
      }
    }
  } catch (error) {
    console.warn('Failed to read variables.json:', error.message);
  }
  const normalizedDefault = normalizeVariableSchemaPayload(DEFAULT_VARIABLE_SCHEMA);
  dbSetJson(STORE_KEYS.variables, normalizedDefault);
  return normalizedDefault;
}

function loadVariableCatalogMap() {
  const schema = loadVariableSchema();
  const map = {};
  (schema.variables || []).forEach((v) => {
    if (!v || !v.id) return;
    map[v.id] = v;
  });
  return { schema, map };
}

function buildVariableMappingsFromSchema(schema) {
  const mappings = {};
  const csvHeaders = [];
  const adProperties = [];

  (schema.variables || []).forEach((variable) => {
    const placeholders =
      Array.isArray(variable.placeholders) && variable.placeholders.length
        ? variable.placeholders
        : variable.id
          ? [`$${variable.id}`]
          : [];
    const attrs =
      Array.isArray(variable.adProperties) && variable.adProperties.length
        ? variable.adProperties.map((v) => String(v).trim()).filter(Boolean)
        : variable.id
          ? [String(variable.id).trim()]
          : [];
    const header = String(variable.csvHeader || variable.id || '').trim();
    if (header) {
      csvHeaders.push(header);
    }
    attrs.forEach((attr) => adProperties.push(attr));
    placeholders.forEach((placeholder) => {
      if (!placeholder) return;
      mappings[placeholder] = attrs;
    });
  });

  const csvHeadersUnique = uniqueCaseInsensitive(csvHeaders);
  const adPropsUnique = uniqueCaseInsensitive([...BASE_AD_PROPERTIES, ...adProperties]);

  return { mappings, csvHeaders: csvHeadersUnique, adProperties: adPropsUnique };
}

function uniqueCaseInsensitive(arr = []) {
  const seen = new Set();
  const result = [];
  arr.forEach((item) => {
    const key = String(item || '').toLowerCase();
    if (!key) return;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function normalizeVariableForStorage(variable = {}) {
  const id = String(variable?.id || '').trim();
  if (!id) return null;

  const normalized = {
    id,
    required: Boolean(variable?.required),
  };

  const displayName = String(variable?.displayName || '').trim();
  if (displayName) normalized.displayName = displayName;

  const description = String(variable?.description || '').trim();
  if (description) normalized.description = description;

  const csvHeader = String(variable?.csvHeader || '').trim();
  if (csvHeader && csvHeader.toLowerCase() !== id.toLowerCase()) {
    normalized.csvHeader = csvHeader;
  }

  const placeholders = Array.isArray(variable?.placeholders)
    ? variable.placeholders.map((v) => String(v || '').trim()).filter(Boolean)
    : [];
  if (placeholders.length) normalized.placeholders = placeholders;

  const adProperties = Array.isArray(variable?.adProperties)
    ? uniqueCaseInsensitive(variable.adProperties.map((v) => String(v || '').trim()).filter(Boolean))
    : [];
  if (!(adProperties.length === 1 && adProperties[0].toLowerCase() === id.toLowerCase()) && adProperties.length) {
    normalized.adProperties = adProperties;
  }

  const validation = String(variable?.validation || '').trim();
  if (validation) normalized.validation = validation;

  const domains = Array.isArray(variable?.domains)
    ? uniqueCaseInsensitive(variable.domains.map((v) => String(v || '').trim()).filter(Boolean))
    : [];
  if (domains.length) normalized.domains = domains;

  return normalized;
}

function normalizeVariableSchemaPayload(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const variables = Array.isArray(source.variables)
    ? source.variables.map((variable) => normalizeVariableForStorage(variable)).filter(Boolean)
    : [];
  const idSet = new Set(variables.map((v) => v.id.toLowerCase()));
  const ordering = Array.isArray(source.ordering)
    ? uniqueCaseInsensitive(source.ordering.map((v) => String(v || '').trim()).filter(Boolean)).filter(
        (id) => idSet.has(id.toLowerCase()),
      )
    : variables.map((v) => v.id);

  return {
    ...source,
    variables,
    ordering,
  };
}

async function persistConfigJson(config) {
  dbSetJson(STORE_KEYS.config, config);
  await ensureDirectory(CONFIG_PATH);
  await fs.promises.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function persistVariableSchema(schema) {
  const normalized = normalizeVariableSchemaPayload(schema);
  dbSetJson(STORE_KEYS.variables, normalized);
  await ensureDirectory(VARIABLES_JSON_PATH);
  await fs.promises.writeFile(VARIABLES_JSON_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

async function persistUsersCsv(csv) {
  const normalized = String(csv || '');
  dbSetText(STORE_KEYS.usersCsv, normalized);
  await ensureDirectory(USER_FILE_PATH);
  await fs.promises.writeFile(USER_FILE_PATH, normalized, 'utf8');
  lastUserFilePath = USER_FILE_PATH;
  return USER_FILE_PATH;
}

function importPresetDirectoryToDb(type, dirPath, filterFn = null) {
  if (!storageDb || !fs.existsSync(dirPath)) return;
  const names = fs.readdirSync(dirPath).filter((name) => name.toLowerCase().endsWith('.json'));
  names.forEach((filename) => {
    const name = path.basename(filename, '.json');
    if (filterFn && !filterFn(name)) return;
    try {
      const raw = fs.readFileSync(path.join(dirPath, filename), 'utf8');
      const payload = JSON.parse(raw);
      dbSavePreset(type, name, payload);
    } catch (error) {
      console.warn(`Skipping preset migration for ${type}/${name}: ${error.message}`);
    }
  });
}

function migrateStorageToDb() {
  if (!storageDb) return;

  try {
    if (!dbGetJson(STORE_KEYS.config) && fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        dbSetJson(STORE_KEYS.config, parsed);
      }
    }
  } catch (error) {
    console.warn(`Config DB migration failed: ${error.message}`);
  }

  try {
    if (!dbGetJson(STORE_KEYS.variables) && fs.existsSync(VARIABLES_JSON_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(VARIABLES_JSON_PATH, 'utf8'));
      if (parsed && Array.isArray(parsed.variables)) {
        dbSetJson(STORE_KEYS.variables, normalizeVariableSchemaPayload(parsed));
      }
    }
  } catch (error) {
    console.warn(`Variables DB migration failed: ${error.message}`);
  }

  try {
    if (!dbGetText(STORE_KEYS.usersCsv) && fs.existsSync(USER_FILE_PATH)) {
      dbSetText(STORE_KEYS.usersCsv, fs.readFileSync(USER_FILE_PATH, 'utf8'));
    }
  } catch (error) {
    console.warn(`Users DB migration failed: ${error.message}`);
  }

  importPresetDirectoryToDb(PRESET_TYPES.variable, VARIABLE_PRESET_DIR, (name) => name.toLowerCase() !== 'variables');
  importPresetDirectoryToDb(PRESET_TYPES.domain, DOMAIN_PRESET_DIR);
}

function syncDbStorageToFiles() {
  if (!storageDb) return;
  try {
    const config = dbGetJson(STORE_KEYS.config);
    if (config && typeof config === 'object') {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    }
  } catch (error) {
    console.warn(`Failed to mirror config from DB to file: ${error.message}`);
  }

  try {
    const schema = CONFIG_MODE === 'env' ? null : dbGetJson(STORE_KEYS.variables);
    if (schema && Array.isArray(schema.variables)) {
      fs.mkdirSync(path.dirname(VARIABLES_JSON_PATH), { recursive: true });
      fs.writeFileSync(VARIABLES_JSON_PATH, `${JSON.stringify(normalizeVariableSchemaPayload(schema), null, 2)}\n`, 'utf8');
    }
  } catch (error) {
    console.warn(`Failed to mirror variables from DB to file: ${error.message}`);
  }

  try {
    const usersCsv = dbGetText(STORE_KEYS.usersCsv);
    if (usersCsv && usersCsv.trim()) {
      fs.mkdirSync(path.dirname(USER_FILE_PATH), { recursive: true });
      fs.writeFileSync(USER_FILE_PATH, usersCsv, 'utf8');
      lastUserFilePath = USER_FILE_PATH;
    }
  } catch (error) {
    console.warn(`Failed to mirror users from DB to file: ${error.message}`);
  }

  try {
    fs.mkdirSync(VARIABLE_PRESET_DIR, { recursive: true });
    dbListPresetNames(PRESET_TYPES.variable).forEach((name) => {
      const payload = dbGetPreset(PRESET_TYPES.variable, name);
      if (!payload) return;
      fs.writeFileSync(path.join(VARIABLE_PRESET_DIR, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    });
  } catch (error) {
    console.warn(`Failed to mirror variable presets from DB to files: ${error.message}`);
  }

  try {
    fs.mkdirSync(DOMAIN_PRESET_DIR, { recursive: true });
    dbListPresetNames(PRESET_TYPES.domain).forEach((name) => {
      const payload = dbGetPreset(PRESET_TYPES.domain, name);
      if (!payload) return;
      fs.writeFileSync(path.join(DOMAIN_PRESET_DIR, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    });
  } catch (error) {
    console.warn(`Failed to mirror domain presets from DB to files: ${error.message}`);
  }
}

function initializeStorage() {
  if (storageInitialized) return;
  initStorageDb();
  initAuthDb();
  if (CONFIG_MODE !== 'env') {
    // Legacy migration/mirroring may modify tracked sample presets/variables.
    // Env mode must never rewrite repository files during startup.
    migrateStorageToDb();
    syncDbStorageToFiles();
  }
  storageInitialized = true;
}

function buildAttributeAliasMap(schema) {
  const aliasMap = {};
  (schema?.variables || []).forEach((variable) => {
    const header = String(variable?.csvHeader || variable?.id || '').trim();
    const id = String(variable?.id || '').trim();
    if (!header) return;
    const normalizedHeader = header.toLowerCase();
    if (!aliasMap[normalizedHeader]) {
      aliasMap[normalizedHeader] = new Set();
    }
    aliasMap[normalizedHeader].add(normalizedHeader);
    if (id) {
      aliasMap[normalizedHeader].add(id.toLowerCase());
    }
    (variable.placeholders || []).forEach((placeholder) => {
      const cleaned = String(placeholder || '').replace(/^\$/, '').trim().toLowerCase();
      if (cleaned) {
        aliasMap[normalizedHeader].add(cleaned);
      }
    });
  });
  return Object.fromEntries(
    Object.entries(aliasMap).map(([key, set]) => [key, Array.from(set)]),
  );
}

function findValueByAliases(source, targetKey, aliasMap = {}) {
  const normalized = String(targetKey || '').toLowerCase();
  const candidates = [];
  const addCandidate = (value) => {
    const key = String(value || '').toLowerCase();
    if (key && !candidates.includes(key)) {
      candidates.push(key);
    }
  };
  addCandidate(normalized);
  (aliasMap[normalized] || []).forEach((alias) => addCandidate(alias));

  for (const candidate of candidates) {
    const matchKey = Object.keys(source || {}).find(
      (k) => k && k.toLowerCase() === candidate,
    );
    if (matchKey) {
      const value = source[matchKey];
      return value === undefined ? '' : value;
    }
  }
  return '';
}

async function loadVariableMappings() {
  try {
    const schema = loadVariableSchema();
    const { mappings, csvHeaders, adProperties } = buildVariableMappingsFromSchema(schema);
    return { mappings, attributes: csvHeaders, adProperties, schema };
  } catch (error) {
    console.warn('Failed to load variable mappings', error);
    return { mappings: {}, attributes: [], adProperties: BASE_AD_PROPERTIES, schema: DEFAULT_VARIABLE_SCHEMA };
  }
}

function getExistingUserFilePath() {
  const candidates = [];
  if (lastUserFilePath) candidates.push(lastUserFilePath);
  if (USER_FILE_PATH) candidates.push(USER_FILE_PATH);
  if (AD_USER_FILE_PATH) candidates.push(AD_USER_FILE_PATH);
  DEFAULT_USER_FILE_CANDIDATES.forEach((c) => candidates.push(c));

  const firstExisting = candidates.filter(Boolean).find((p) => fs.existsSync(p));
  return firstExisting || null;
}

async function probePowerShellCommand(candidate) {
  return new Promise((resolve) => {
    const probe = spawn(candidate, ['-Command', '$PSVersionTable'], { stdio: 'ignore' });
    let settled = false;

    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    probe.on('error', () => finish(false));
    probe.on('close', (code) => finish(code === 0));
  });
}

function powerShellCandidates(platform, configured) {
  const candidates = configured ? [configured] : [];
  const platformDefaults = platform === 'win32' ? ['powershell', 'pwsh'] : ['pwsh', 'powershell'];
  for (const candidate of platformDefaults) {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

async function resolvePowerShellCommand() {
  if (detectedPowerShellPromise) return detectedPowerShellPromise;

  const candidates = powerShellCandidates(process.platform, (process.env.POWERSHELL_CMD || '').trim());

  detectedPowerShellPromise = (async () => {
    const attempted = [];
    for (const candidate of candidates) {
      attempted.push(candidate);
      // Prefer a quick command probe over filesystem checks so absolute paths also work.
      const available = await probePowerShellCommand(candidate);
      if (available) {
        return { command: candidate, attempted };
      }
    }

    const unavailableError = new Error(
      'PowerShell executable not found. Set POWERSHELL_CMD to a valid PowerShell binary and try again.',
    );
    unavailableError.status = 503;
    unavailableError.code = 'POWERSHELL_NOT_AVAILABLE';
    unavailableError.attemptedPowerShellCommands = attempted;
    throw unavailableError;
  })();

  return detectedPowerShellPromise;
}

async function runPowerShellCommand(args, options = {}) {
  const { command: powershellCommand, attempted } = await resolvePowerShellCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(powershellCommand, args, {
      cwd: ROOT_DIR,
      ...options,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          code,
          stdout,
          stderr,
          powershellCommand,
          attemptedPowerShellCommands: attempted,
        });
        return;
      }
      const error = new Error(`PowerShell command failed with code ${code}`);
      error.status = 500;
      error.code = 'POWERSHELL_COMMAND_FAILED';
      error.exitCode = code;
      error.stdout = stdout;
      error.stderr = stderr;
      error.powershellCommand = powershellCommand;
      error.attemptedPowerShellCommands = attempted;
      reject(error);
    });
    child.on('error', (error) => {
      const unavailableError = new Error(`PowerShell execution failed: ${error.message}`);
      unavailableError.status = 503;
      unavailableError.code = 'POWERSHELL_NOT_AVAILABLE';
      unavailableError.stdout = stdout;
      unavailableError.stderr = stderr;
      unavailableError.powershellCommand = powershellCommand;
      unavailableError.attemptedPowerShellCommands = attempted;
      reject(unavailableError);
    });
  });
}

function toPowerShellSingleQuoted(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

async function runPowerShellInline(psScript) {
  return runPowerShellCommand(['-NoLogo', '-NoProfile', '-Command', psScript]);
}

async function runPowerShellScriptFile(scriptPath, args = []) {
  return runPowerShellCommand([
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    ...args,
  ]);
}

async function runNodeScriptFile(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT_DIR,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      const error = new Error(`Node script failed with code ${code}`);
      error.status = 500;
      error.code = 'NODE_SCRIPT_FAILED';
      error.exitCode = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
    child.on('error', (error) => {
      const executionError = new Error(`Node script execution failed: ${error.message}`);
      executionError.status = 500;
      executionError.code = 'NODE_SCRIPT_EXECUTION_FAILED';
      executionError.stdout = stdout;
      executionError.stderr = stderr;
      reject(executionError);
    });
  });
}

function getRunnerTaskNames() {
  return [RUNNER_BACKEND_TASK_NAME, RUNNER_FRONTEND_TASK_NAME];
}

function getRunnerTaskScriptArgs() {
  return [
    '-BackendTaskName',
    RUNNER_BACKEND_TASK_NAME,
    '-FrontendTaskName',
    RUNNER_FRONTEND_TASK_NAME,
  ];
}

async function queryRunnerTaskStates() {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      reason: 'Scheduled task status is available on Windows only.',
      tasks: [],
    };
  }

  const taskNames = getRunnerTaskNames();
  const taskLiteral = taskNames.map((name) => toPowerShellSingleQuoted(name)).join(', ');
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$taskNames = @(${taskLiteral})
$out = foreach ($taskName in $taskNames) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -eq $task) {
    [PSCustomObject]@{
      taskName = $taskName
      exists = $false
      state = 'Missing'
      lastTaskResult = $null
      lastRunTime = $null
      nextRunTime = $null
    }
    continue
  }
  $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
  [PSCustomObject]@{
    taskName = $taskName
    exists = $true
    state = [string]$task.State
    lastTaskResult = if ($info) { [int]$info.LastTaskResult } else { $null }
    lastRunTime = if ($info -and $info.LastRunTime) { $info.LastRunTime.ToString('o') } else { $null }
    nextRunTime = if ($info -and $info.NextRunTime) { $info.NextRunTime.ToString('o') } else { $null }
  }
}
$out | ConvertTo-Json -Compress -Depth 4
  `.trim();

  try {
    const result = await runPowerShellInline(psScript);
    const trimmed = String(result.stdout || '').trim();
    if (!trimmed) {
      return { supported: true, tasks: [] };
    }
    const parsed = JSON.parse(trimmed);
    const tasks = Array.isArray(parsed) ? parsed : [parsed];
    return { supported: true, tasks };
  } catch (error) {
    return {
      supported: false,
      reason: error.message,
      tasks: [],
      stderr: error.stderr || '',
      stdout: error.stdout || '',
    };
  }
}

async function probeRunnerUrl(url) {
  const target = String(url || '').trim();
  if (!target) {
    return { url: '', healthy: false, error: 'URL not configured', statusCode: null, responseMs: null };
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNNER_STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: '*/*' },
    });
    const responseMs = Date.now() - startedAt;
    const healthy = response.status >= 200 && response.status < 400;
    return {
      url: target,
      healthy,
      statusCode: response.status,
      statusText: response.statusText || '',
      responseMs,
      error: '',
    };
  } catch (error) {
    const responseMs = Date.now() - startedAt;
    return {
      url: target,
      healthy: false,
      statusCode: null,
      statusText: '',
      responseMs,
      error: error?.name === 'AbortError' ? 'timeout' : (error?.message || 'unreachable'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRunnerAction(value) {
  const action = String(value || '').trim().toLowerCase();
  if (action === 'start' || action === 'stop' || action === 'restart') return action;
  return '';
}

function normalizeRunnerScope(value) {
  const scope = String(value || '').trim().toLowerCase();
  if (scope === 'backend' || scope === 'frontend') return scope;
  return '';
}

function runnerTaskNameForScope(scope) {
  if (scope === 'backend') return RUNNER_BACKEND_TASK_NAME;
  if (scope === 'frontend') return RUNNER_FRONTEND_TASK_NAME;
  return '';
}

async function executeScopedRunnerAction(scopeRaw, actionRaw) {
  if (process.platform !== 'win32') {
    const error = new Error('Runner actions are supported on Windows only.');
    error.status = 400;
    error.code = 'RUNNER_ACTION_UNSUPPORTED';
    throw error;
  }

  const scope = normalizeRunnerScope(scopeRaw);
  const action = normalizeRunnerAction(actionRaw);
  const taskName = runnerTaskNameForScope(scope);
  if (!scope || !taskName) {
    const error = new Error('Invalid runner scope. Use backend or frontend.');
    error.status = 400;
    error.code = 'RUNNER_SCOPE_INVALID';
    throw error;
  }
  if (!action) {
    const error = new Error('Invalid action. Use start, stop, or restart.');
    error.status = 400;
    error.code = 'RUNNER_ACTION_INVALID';
    throw error;
  }
  if (scope === 'backend' && action !== 'restart') {
    const error = new Error('The backend may only restart itself from the web UI.');
    error.status = 400;
    error.code = 'BACKEND_SELF_CONTROL_RESTRICTED';
    throw error;
  }

  const taskLiteral = toPowerShellSingleQuoted(taskName);

  if (scope === 'backend') {
    // A child process launched by the backend's own Scheduled Task can be
    // terminated when Stop-ScheduledTask stops the task's entire process tree.
    // Instead ask Windows Task Scheduler to start a separate one-shot task.
    const helperName = 'Signaturee-Backend-Restart-Once';
    const helperScript = path.join(ROOT_DIR, 'scripts', 'restart-backend-once.ps1');
    if (!fs.existsSync(helperScript)) {
      const error = new Error('Backend restart helper script missing.');
      error.status=500; error.code='RESTART_HELPER_MISSING';
      throw error;
    }
    const task = toPowerShellSingleQuoted(taskName);
    const onceTask = toPowerShellSingleQuoted(helperName);
    const scriptLiteral = toPowerShellSingleQuoted(helperScript);
    const rootLiteral = toPowerShellSingleQuoted(ROOT_DIR);
    const psScript = [
      "$ErrorActionPreference = 'Stop'",
      `$existing = Get-ScheduledTask -TaskName ${onceTask} -ErrorAction SilentlyContinue`,
      "if ($existing) { throw 'A backend restart is already pending. Check Logs/backend-restart.log.' }",
      `$backend = Get-ScheduledTask -TaskName ${task} -ErrorAction Stop`,
      "$taskArgs = [string](($backend.Actions | ForEach-Object { $_.Arguments }) -join ' ')",
      `$expected = Join-Path ${rootLiteral} 'scripts\\run-backend.ps1'`,
      "if ($taskArgs.IndexOf($expected,[StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'Backend Scheduled Task points to a different installation.' }",
      "$psExe = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
      `$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ${scriptLiteral} + '" -TargetTask "' + ${task} + '" -HelperTask "' + ${onceTask} + '" -RepoRoot "' + ${rootLiteral} + '"'`,
      `$actionDef = New-ScheduledTaskAction -Execute $psExe -Argument $arguments -WorkingDirectory ${rootLiteral}`,
      // Task Scheduler, not the backend's process tree, starts the helper.
      // A short delay leaves time for the API to respond before shutdown.
      "$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(8)",
      "$trigger.EndBoundary = (Get-Date).AddMinutes(2).ToString('s')",
      "$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest",
      "$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -DeleteExpiredTaskAfter (New-TimeSpan -Minutes 5)",
      `Register-ScheduledTask -TaskName ${onceTask} -Action $actionDef -Trigger $trigger -Principal $principal -Settings $settings -ErrorAction Stop | Out-Null`,
      "'Independent backend restart helper registered' ",
    ].join('; ');
    // Await registration errors. Never tell the UI that a restart was queued
    // when the helper task could not be registered or started.
    const result = await runPowerShellInline(psScript);
    return { scope, action, taskName, queued: true, helperTask: helperName,
      stdout: result.stdout };
  }

  const commands = [
    "$ErrorActionPreference = 'Stop'",
    `$task = Get-ScheduledTask -TaskName ${taskLiteral} -ErrorAction Stop`,
  ];
  if (action === 'stop' || action === 'restart') {
    commands.push(`Stop-ScheduledTask -TaskName ${taskLiteral} -ErrorAction SilentlyContinue`);
  }
  if (action === 'restart') commands.push('Start-Sleep -Milliseconds 500');
  if (action === 'start' || action === 'restart') {
    commands.push(`Start-ScheduledTask -TaskName ${taskLiteral} -ErrorAction Stop`);
  }
  commands.push(`$updated = Get-ScheduledTask -TaskName ${taskLiteral} -ErrorAction SilentlyContinue`);
  commands.push(`[PSCustomObject]@{ taskName = ${taskLiteral}; state = [string]$updated.State } | ConvertTo-Json -Compress`);

  const result = await runPowerShellInline(commands.join('; '));
  return {
    scope,
    action,
    taskName,
    queued: false,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function executeRunnerAction(action) {
  if (process.platform !== 'win32') {
    const error = new Error('Runner actions are supported on Windows only.');
    error.status = 400;
    error.code = 'RUNNER_ACTION_UNSUPPORTED';
    throw error;
  }

  const normalized = normalizeRunnerAction(action);
  if (!normalized) {
    const error = new Error('Invalid action. Use start, stop, or restart.');
    error.status = 400;
    error.code = 'RUNNER_ACTION_INVALID';
    throw error;
  }

  const args = getRunnerTaskScriptArgs();
  const scriptExists = (scriptPath) => fs.existsSync(scriptPath);

  if ((normalized === 'start' || normalized === 'restart') && !scriptExists(RUNNER_CONTROL_START_SCRIPT)) {
    const error = new Error(`Missing runner control script: ${RUNNER_CONTROL_START_SCRIPT}`);
    error.status = 500;
    error.code = 'RUNNER_SCRIPT_MISSING';
    throw error;
  }
  if ((normalized === 'stop' || normalized === 'restart') && !scriptExists(RUNNER_CONTROL_STOP_SCRIPT)) {
    const error = new Error(`Missing runner control script: ${RUNNER_CONTROL_STOP_SCRIPT}`);
    error.status = 500;
    error.code = 'RUNNER_SCRIPT_MISSING';
    throw error;
  }

  const steps = [];
  if (normalized === 'start') {
    const result = await runPowerShellScriptFile(RUNNER_CONTROL_START_SCRIPT, args);
    steps.push({ step: 'start', stdout: result.stdout, stderr: result.stderr, code: result.code });
  } else if (normalized === 'stop') {
    const result = await runPowerShellScriptFile(RUNNER_CONTROL_STOP_SCRIPT, args);
    steps.push({ step: 'stop', stdout: result.stdout, stderr: result.stderr, code: result.code });
  } else {
    const stopResult = await runPowerShellScriptFile(RUNNER_CONTROL_STOP_SCRIPT, args);
    steps.push({ step: 'stop', stdout: stopResult.stdout, stderr: stopResult.stderr, code: stopResult.code });
    const startResult = await runPowerShellScriptFile(RUNNER_CONTROL_START_SCRIPT, args);
    steps.push({ step: 'start', stdout: startResult.stdout, stderr: startResult.stderr, code: startResult.code });
  }

  return {
    action: normalized,
    steps,
  };
}

async function buildRunnerStatusSnapshot() {
  const [frontend, tasks] = await Promise.all([
    probeRunnerUrl(RUNNER_FRONTEND_STATUS_URL),
    queryRunnerTaskStates(),
  ]);
  const backend = {
    url: `http://127.0.0.1:${PORT}${BASE_PATH === '/' ? '' : BASE_PATH}/health`,
    healthy: true,
    statusCode: 200,
    statusText: 'OK',
    responseMs: 0,
    error: '',
  };
  const serviceList = [backend, frontend];
  const servicesHealthy = serviceList.every((entry) => entry.healthy);
  const tasksHealthy = tasks.supported
    ? tasks.tasks.every((task) => task.exists && String(task.state || '').toLowerCase() === 'running')
    : false;
  return {
    checkedAt: new Date().toISOString(),
    services: {
      backend,
      frontend,
    },
    tasks,
    summary: {
      servicesHealthy,
      tasksHealthy,
      healthy: servicesHealthy && tasksHealthy,
    },
    config: {
      backendTaskName: RUNNER_BACKEND_TASK_NAME,
      frontendTaskName: RUNNER_FRONTEND_TASK_NAME,
      frontendStatusUrl: RUNNER_FRONTEND_STATUS_URL,
    },
  };
}

async function runGenerateScript(options = {}) {
  const {
    userFilePath = lastUserFilePath,
    domainSelection,
    userSelection,
    mode = 'userFile',
    deploymentMode,
    server,
    useOutlookFolder,
    useTestTemplates,
    refreshGroupMembership,
    validateOnly,
    skipAcls,
    respectUserDomains,
    configFilePath,
    variablesFilePath,
    localDeploymentPath,
    networkDeploymentPath,
    previewOnly = false,
    allowGlobalTestTemplates = true,
  } = options;
  if (!ALLOWED_IMPORT_MODES.includes(mode)) {
    const error = new Error(`Unsupported import mode: ${mode}`);
    error.status = 400;
    error.code = 'INVALID_MODE';
    throw error;
  }
  if (mode === 'userFile' && !userFilePath) {
    const error = new Error('User file path missing for userFile mode');
    error.status = 400;
    error.code = 'MISSING_USER_FILE';
    throw error;
  }
  const { command: powershellCommand, attempted } = await resolvePowerShellCommand();

  return new Promise((resolve, reject) => {
    const args = ['-File', GENERATE_SCRIPT_PATH, '-TemplateDirectory', TEMPLATE_DIRECTORY];
  // Explicitly set UseUserFile to bypass interactive prompt inside the script
  if (mode === 'userFile') {
    args.push('-UseUserFile');
    if (userFilePath) {
      args.push('-UserFilePath', userFilePath);
    }
    if (respectUserDomains) {
      // MassGeneration + UseUserFile makes the PowerShell core honor each CSV row's Domains field.
      // The v2 run file contains only the explicitly selected users, so this never broadens scope.
      args.push('-MassGeneration');
    }
  } else if (mode === 'mass') {
    args.push('-MassGeneration');
  }
  if (deploymentMode && ALLOWED_DEPLOYMENT_MODES.includes(deploymentMode)) {
    args.push('-DeploymentMode', deploymentMode);
  }
  if (domainSelection) {
    args.push('-DomainSelection', domainSelection);
  }
  if (userSelection) {
    args.push('-UserSelection', userSelection);
  }
  if (server) {
    args.push('-Server', server);
  }
  if (useOutlookFolder) {
    args.push('-UseOutlookFolder');
  }
  if (useTestTemplates) {
    args.push('-UseTestTemplates');
  }
  if (refreshGroupMembership) {
    args.push('-RefreshGroupMembership');
  }
  if (validateOnly) {
    args.push('-ValidateOnly');
  }
  if (skipAcls) {
    args.push('-SkipAcls');
  }
  if (configFilePath) {
    args.push('-ConfigFilePath', configFilePath);
  }
  if (variablesFilePath) {
    args.push('-VariablesFilePath', variablesFilePath);
  }
  if (localDeploymentPath) {
    args.push('-LocalDeploymentPath', localDeploymentPath);
  }
  if (networkDeploymentPath) {
    args.push('-NetworkDeploymentPath', networkDeploymentPath);
  }
  if (previewOnly) {
    args.push('-PreviewOnly');
  }
  if (USE_TEST_TEMPLATES && allowGlobalTestTemplates) {
    args.push('-UseTestTemplates');
  }
    const child = spawn(powershellCommand, args, { cwd: ROOT_DIR });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => {
      if (stdout) {
        console.log('GenerateSignatures stdout:', stdout);
      }
      if (stderr) {
        console.error('GenerateSignatures stderr:', stderr);
      }
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        const error = new Error(`GenerateSignatures exited with code ${code}`);
        error.status = 422;
        error.code = 'SCRIPT_FAILED';
        error.stdout = stdout;
        error.stderr = stderr;
        error.powershellCommand = powershellCommand;
        error.attemptedPowerShellCommands = attempted;
        reject(error);
      }
    });
    child.on('error', (error) => {
      const unavailableError = new Error('PowerShell not available');
      unavailableError.status = 503;
      unavailableError.code = 'POWERSHELL_NOT_AVAILABLE';
      unavailableError.stdout = stdout;
      unavailableError.stderr = `${stderr}${stderr ? '\n' : ''}${error.message}`.trim();
      unavailableError.powershellCommand = powershellCommand;
      unavailableError.attemptedPowerShellCommands = attempted;
      reject(unavailableError);
    });
  });
}

let generationQueue = Promise.resolve();

function queueGenerateScript(options = {}) {
  const execute = () => runGenerateScript(options);
  const queued = generationQueue.catch(() => {}).then(execute);
  generationQueue = queued.catch(() => {});
  return queued;
}

async function handleUserImport(req, res, singleMode = false) {
  try {
    const contentType = req.headers['content-type'] || '';
    let userFilePath = USER_FILE_PATH;

    if (contentType.includes('multipart/form-data')) {
      const { files, fields } = await parseMultipart(req);
      if (files.length > 0) {
        const extension = (path.extname(files[0].filename) || '.csv').toLowerCase();
        if (extension !== '.csv') {
          return sendJson(res, 400, { error: 'Only CSV upload is supported.' });
        }
        userFilePath = await persistUsersCsv(files[0].data.toString('utf8'));
      } else {
        return sendJson(res, 400, { error: 'No file or users data provided' });
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const fields = await parseUrlEncodedBody(req);
      if (!fields.users) {
        return sendJson(res, 400, { error: 'Missing users field' });
      }
      return sendJson(res, 400, { error: 'Only CSV upload is supported.' });
    } else {
      return sendJson(res, 415, { error: 'Unsupported Content-Type' });
    }

    return sendJson(res, 200, {
      message: 'User data imported. Trigger generation separately via /api/generate.',
      userFilePath,
    });
  } catch (error) {
    const status = error.status || 500;
    const payload = {
      error: error.message,
      code: error.code,
    };
    if (error.stdout) payload.stdout = error.stdout;
    if (error.stderr) payload.stderr = error.stderr;
    if (error.powershellCommand) payload.powershellCommand = error.powershellCommand;
    if (error.attemptedPowerShellCommands) payload.attemptedPowerShellCommands = error.attemptedPowerShellCommands;
    return sendJson(res, status, payload);
  }
}

async function handleTemplateImport(req, res) {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return sendJson(res, 415, { error: 'Templates import expects multipart/form-data' });
    }
    const { files } = await parseMultipart(req);
    if (!files.length) {
      return sendJson(res, 400, { error: 'No template files provided' });
    }
    const savedPaths = [];
    for (const file of files) {
      const saved = await saveIncomingFile(file, TEMPLATE_DIRECTORY);
      savedPaths.push(saved);
    }
    return sendJson(res, 200, { message: 'Templates imported', savedPaths, templateDirectory: TEMPLATE_DIRECTORY });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleTemplateExport(_req, res) {
  try {
    if (!fs.existsSync(TEMPLATE_DIRECTORY)) {
      return sendJson(res, 404, { error: 'Template directory not found' });
    }
    res.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="templates.tar.gz"`,
    });
    const tar = spawn(TAR_CMD, ['-czf', '-', '-C', TEMPLATE_DIRECTORY, '.']);
    tar.stdout.pipe(res);
    tar.stderr.on('data', (data) => {
      console.error(data.toString());
    });
    tar.on('error', (error) => {
      console.error(error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: error.message });
      } else {
        res.destroy(error);
      }
    });
    tar.on('close', (code) => {
      if (code !== 0 && !res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `tar exited with code ${code}` }));
      }
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleDomainImport(req, res) {
  try {
    if (CONFIG_MODE === 'env') {
      return sendJson(res, 409, { error: 'Business configuration is managed by .env; legacy API writes are disabled.' });
    }
    const contentType = req.headers['content-type'] || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await parseJsonBody(req);
    } else if (contentType.includes('multipart/form-data')) {
      const { files, fields } = await parseMultipart(req);
      if (files.length) {
        data = JSON.parse(files[0].data.toString('utf8'));
      } else if (fields.config) {
        data = JSON.parse(fields.config);
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const fields = await parseUrlEncodedBody(req);
      if (fields.config) data = JSON.parse(fields.config);
    }
    if (!data) {
      return sendJson(res, 400, { error: 'No configuration payload received' });
    }
    await persistConfigJson(data);
    lastDomainConfigSave = new Date().toISOString();
    return sendJson(res, 200, { message: 'Configuration saved', configPath: CONFIG_PATH });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleDomainExport(_req, res) {
  try {
    const data = loadConfigJson();
    if (!data || !Object.keys(data).length) {
      return sendJson(res, 404, { error: 'Configuration not found' });
    }
    return sendJson(res, 200, { config: data, configPath: CONFIG_PATH });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleVariablesGet(_req, res) {
  try {
    const { mappings, attributes, schema } = await loadVariableMappings();
    return sendJson(res, 200, { mappings, attributes, schema });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

function handleVariableCatalog(_req, res) {
  try {
    const schema = loadVariableSchema();
    return sendJson(res, 200, { variables: schema.variables || [] });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleVariables(req, res) {
  try {
    if (CONFIG_MODE === 'env') {
      return sendJson(res, 409, { error: 'Business configuration is managed by .env; legacy API writes are disabled.' });
    }
    const contentType = req.headers['content-type'] || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await parseJsonBody(req);
    } else if (contentType.includes('multipart/form-data')) {
      const { files, fields } = await parseMultipart(req);
      if (files.length) {
        data = JSON.parse(files[0].data.toString('utf8'));
      } else if (fields.variables) {
        data = JSON.parse(fields.variables);
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const fields = await parseUrlEncodedBody(req);
      if (fields.variables) data = JSON.parse(fields.variables);
    }
    if (!data || !Array.isArray(data.variables)) {
      return sendJson(res, 400, { error: 'No variables payload received or payload is invalid (expected { variables: [...] })' });
    }
    await persistVariableSchema(data);
    lastVariableSchemaSave = new Date().toISOString();
    return sendJson(res, 200, { message: 'Variables saved', variablesPath: VARIABLES_JSON_PATH });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleVariablePresetList(_req, res) {
  try {
    importPresetDirectoryToDb(PRESET_TYPES.variable, VARIABLE_PRESET_DIR, (name) => name.toLowerCase() !== 'variables');
    const dbPresets = dbListPresetNames(PRESET_TYPES.variable).filter((name) => name.toLowerCase() !== 'variables');
    if (dbPresets.length) {
      return sendJson(res, 200, { presets: dbPresets });
    }
    await ensureDirExists(VARIABLE_PRESET_DIR);
    const entries = await fs.promises.readdir(VARIABLE_PRESET_DIR, { withFileTypes: true });
    const presets = entries
      .filter((ent) => ent.isFile() && ent.name.toLowerCase().endsWith('.json'))
      .map((ent) => path.basename(ent.name, '.json'))
      .filter((name) => name.toLowerCase() !== 'variables');
    return sendJson(res, 200, { presets });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleVariablePresetLoad(_req, res, name) {
  try {
    const safe = (name || '').trim();
    if (!safe || !/^[a-zA-Z0-9._-]+$/.test(safe)) {
      return sendJson(res, 400, { error: 'Invalid preset name' });
    }

    importPresetDirectoryToDb(PRESET_TYPES.variable, VARIABLE_PRESET_DIR, (presetName) => presetName.toLowerCase() !== 'variables');
    const storedSchema = dbGetPreset(PRESET_TYPES.variable, safe);
    if (storedSchema) {
      let resolved = null;
      if (Array.isArray(storedSchema?.variables) && storedSchema.variables.every((v) => typeof v === 'string')) {
        const { map } = loadVariableCatalogMap();
        resolved = storedSchema.variables.map((id) => map[id]).filter(Boolean);
      }
      lastVariablePresetLoad = new Date().toISOString();
      return sendJson(res, 200, { name: safe, schema: storedSchema, resolved, path: DB_PATH, storage: 'db' });
    }

    const filePath = path.join(VARIABLE_PRESET_DIR, `${safe}.json`);
    if (!fs.existsSync(filePath)) {
      return sendJson(res, 404, { error: 'Preset not found' });
    }
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const schema = JSON.parse(raw);
    let resolved = null;
    if (Array.isArray(schema?.variables) && schema.variables.every((v) => typeof v === 'string')) {
      const { map } = loadVariableCatalogMap();
      resolved = schema.variables.map((id) => map[id]).filter(Boolean);
    }
    dbSavePreset(PRESET_TYPES.variable, safe, schema);
    lastVariablePresetLoad = new Date().toISOString();
    return sendJson(res, 200, { name: safe, schema, resolved, path: filePath, storage: 'file' });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleVariablePresetSave(req, res) {
  try {
    if (CONFIG_MODE === 'env') {
      return sendJson(res, 409, { error: 'Business configuration is managed by .env; legacy API writes are disabled.' });
    }
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'application/json expected' });
    }
    const body = await parseJsonBody(req);
    const name = (body.name || '').trim();
    const schema = body.schema;
    let presetVariableIds = Array.isArray(body.presetVariableIds)
      ? body.presetVariableIds.map((id) => String(id).trim()).filter(Boolean)
      : null;
    const catalogUpdates = Array.isArray(body.catalogUpdates)
      ? body.catalogUpdates
          .map((v) => (v && v.id ? v : null))
          .filter(Boolean)
      : [];
    if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
      return sendJson(res, 400, { error: 'Invalid preset name (use a-z, A-Z, 0-9, . _ -)' });
    }
    const filePath = path.join(VARIABLE_PRESET_DIR, `${name}.json`);
    await ensureDirExists(VARIABLE_PRESET_DIR);

    // Accept legacy full-schema format as a source for IDs
    let schemaVariables = Array.isArray(schema?.variables) ? schema.variables : [];
    if (!presetVariableIds && schemaVariables.length && schemaVariables.every((v) => typeof v === 'string')) {
      presetVariableIds = schemaVariables.map((v) => String(v).trim()).filter(Boolean);
      schemaVariables = [];
    }
    if (!presetVariableIds && schemaVariables.length) {
      presetVariableIds = schemaVariables
        .map((v) => (v && v.id ? String(v.id).trim() : ''))
        .filter(Boolean);
    }

    if (!presetVariableIds || !presetVariableIds.length) {
      return sendJson(res, 400, { error: 'Preset requires at least one variable ID.' });
    }

    // Merge catalog updates + inline schema definitions into the central catalog
    const { map } = loadVariableCatalogMap();
    const mergedMap = { ...map };
    schemaVariables.forEach((variable) => {
      if (variable && variable.id) mergedMap[variable.id] = variable;
    });
    catalogUpdates.forEach((variable) => {
      if (!variable?.id) return;
      mergedMap[variable.id] = variable;
    });
    const mergedSchema = normalizeVariableSchemaPayload({ variables: Object.values(mergedMap) });
    await persistVariableSchema(mergedSchema);
    lastVariableSchemaSave = new Date().toISOString();

    // Persist preset referencing IDs only
    const presetPayload = { format: 'ids', variables: Array.from(new Set(presetVariableIds)) };
    dbSavePreset(PRESET_TYPES.variable, name, presetPayload);
    await fs.promises.writeFile(filePath, `${JSON.stringify(presetPayload, null, 2)}\n`, 'utf8');
    lastVariablePresetSave = new Date().toISOString();
    return sendJson(res, 200, { message: 'Preset saved', name, path: filePath, variablesPath: VARIABLES_JSON_PATH });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleGenerate(req, res) {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'Generation expects application/json' });
    }
    const body = await parseJsonBody(req);
    const modeRaw = (body.mode || 'userFile').toString().trim().toLowerCase();
    const mode = ALLOWED_IMPORT_MODES.includes(modeRaw) ? modeRaw : 'userFile';

    let domainSelection = normalizeSelectionList(body.domains) || 'ALL';
    let userSelection = normalizeSelectionList(body.userSelection) || 'ALL';

    let deploymentMode = 'Local';
    if (body.deploymentMode) {
      const deploymentModeRaw = String(body.deploymentMode).trim();
      const match = ALLOWED_DEPLOYMENT_MODES.find(
        (mode) => mode.toLowerCase() === deploymentModeRaw.toLowerCase(),
      );
      if (match) deploymentMode = match;
    }
    const server = body.server ? String(body.server).trim() : '';
    const useOutlookFolder = parseBooleanFlag(body.useOutlookFolder);
    const useTestTemplates = parseBooleanFlag(body.useTestTemplates);
    const refreshGroupMembership = parseBooleanFlag(body.refreshGroupMembership);
    const validateOnly = parseBooleanFlag(body.validateOnly);
    const skipAcls = parseBooleanFlag(body.skipAcls);
    let userFilePath = USER_FILE_PATH;

    if (mode === 'mass') {
      // Mass generation relies on AD; no user file required
      userFilePath = undefined;
      domainSelection = domainSelection || 'ALL';
      userSelection = 'ALL';
    } else {
      if (!fs.existsSync(USER_FILE_PATH) && !fs.existsSync(AD_USER_FILE_PATH)) {
        return sendJson(res, 404, { error: 'Keine Benutzerdaten gefunden. Bitte zuerst CSV importieren oder AD-Import ausführen.' });
      }
      if (fs.existsSync(USER_FILE_PATH)) {
        userFilePath = USER_FILE_PATH;
      } else if (fs.existsSync(AD_USER_FILE_PATH)) {
        userFilePath = AD_USER_FILE_PATH;
      }
      lastUserFilePath = userFilePath;
    }

    const scriptResult = await queueGenerateScript({
      userFilePath,
      domainSelection,
      userSelection,
      mode,
      deploymentMode,
      server,
      useOutlookFolder,
      useTestTemplates,
      refreshGroupMembership,
      validateOnly,
      skipAcls,
    });

    return sendJson(res, 200, {
      message: 'Signature generation completed.',
      mode,
      domains: domainSelection || undefined,
      userSelection: userSelection || undefined,
      deploymentMode: deploymentMode || undefined,
      userFilePath,
      script: scriptResult,
    });
  } catch (error) {
    const status = error.status || 500;
    const payload = {
      error: error.message,
      code: error.code,
    };
    if (error.stdout) payload.stdout = error.stdout;
    if (error.stderr) payload.stderr = error.stderr;
    if (error.powershellCommand) payload.powershellCommand = error.powershellCommand;
    if (error.attemptedPowerShellCommands) payload.attemptedPowerShellCommands = error.attemptedPowerShellCommands;
    return sendJson(res, status, payload);
  }
}

function isSafeUsernameSegment(value) {
  const name = String(value || '');
  return Boolean(name && name === name.trim() && name !== '.' && name !== '..'
    && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name));
}

async function handleGenerateSingle(req, res) {
  let tempPath = null;
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'Generation expects application/json' });
    }
    const body = await parseJsonBody(req);
    const domainRaw = (body.domain || '').trim();
    if (!domainRaw) {
      return sendJson(res, 400, { error: 'Domain is required.' });
    }

    const cfg = loadConfigJson();
    if (!cfg || !Object.keys(cfg).length) {
      return sendJson(res, 404, { error: 'config.json not found.' });
    }
    const domains = cfg.domains || {};
    const domainKey =
      Object.keys(domains).find((key) => key.toLowerCase() === domainRaw.toLowerCase()) || '';
    if (!domainKey) {
      return sendJson(res, 404, { error: 'Domain not found in config.json.' });
    }

    const user = body.user || {};
    const { attributes: mappedAttributes, schema } = await loadVariableMappings();
    const aliasMap = buildAttributeAliasMap(schema);
    const preferredHeaders = buildPreferredHeaders(mappedAttributes);
    const headers = uniqueCaseInsensitive([...preferredHeaders, 'Domains']);

    const row = {};
    headers.forEach((header) => {
      row[header] = findValueByAliases(user, header, aliasMap);
    });
    row.Domains = domainKey;

    const missing = ['sAMAccountName', 'mail', 'givenName', 'sn'].filter(
      (key) => !String(row[key] || '').trim(),
    );
    if (missing.length) {
      return sendJson(res, 400, { error: `Missing required fields: ${missing.join(', ')}` });
    }
    if (!isSafeUsernameSegment(row.sAMAccountName)) {
      return sendJson(res, 400, { error: 'Invalid account name for output directory.' });
    }

    const csv = convertObjectsToCsv([row], headers);
    tempPath = path.join(ROOT_DIR, 'config', `single-${Date.now()}.csv`);
    await ensureDirectory(tempPath);
    await fs.promises.writeFile(tempPath, csv, 'utf8');

    let deploymentMode = 'Local';
    if (body.deploymentMode) {
      const rawMode = String(body.deploymentMode).trim();
      const match = ALLOWED_DEPLOYMENT_MODES.find(
        (mode) => mode.toLowerCase() === rawMode.toLowerCase(),
      );
      if (match) deploymentMode = match;
    }
    const server = body.server ? String(body.server).trim() : '';
    const useOutlookFolder = parseBooleanFlag(body.useOutlookFolder);
    const useTestTemplates = parseBooleanFlag(body.useTestTemplates);
    const validateOnly = parseBooleanFlag(body.validateOnly);
    const skipAcls = parseBooleanFlag(body.skipAcls);

    const scriptResult = await queueGenerateScript({
      userFilePath: tempPath,
      domainSelection: domainKey,
      userSelection: 'ALL',
      mode: 'userFile',
      deploymentMode,
      server,
      useOutlookFolder,
      useTestTemplates,
      validateOnly,
      skipAcls,
    });

    return sendJson(res, 200, {
      message: 'Single signature generated.',
      domain: domainKey,
      user: row.sAMAccountName || row.mail,
      userFilePath: tempPath,
      deploymentMode,
      script: scriptResult,
    });
  } catch (error) {
    const status = error.status || 500;
    const payload = {
      error: error.message,
      code: error.code,
    };
    if (error.stdout) payload.stdout = error.stdout;
    if (error.stderr) payload.stderr = error.stderr;
    if (error.powershellCommand) payload.powershellCommand = error.powershellCommand;
    if (error.attemptedPowerShellCommands) payload.attemptedPowerShellCommands = error.attemptedPowerShellCommands;
    return sendJson(res, status, payload);
  } finally {
    if (tempPath) {
      fs.promises.unlink(tempPath).catch(() => {});
    }
  }
}

async function findStoredUserBySamAccountName(username) {
  const needle = String(username || '').trim().toLowerCase();
  if (!needle) return null;
  try {
    const { users } = await readUserEntries();
    const match = (users || []).find((user) => {
      const candidate = String(
        user.sAMAccountName ||
        user.samaccountname ||
        user.SAMAccountName ||
        '',
      )
        .trim()
        .toLowerCase();
      return candidate === needle;
    });
    return match || null;
  } catch {
    return null;
  }
}

function listConfiguredDomains(config) {
  const domains = config?.domains && typeof config.domains === 'object' ? config.domains : {};
  return Object.keys(domains)
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    .map((key) => ({ key }));
}

async function handleSelfBootstrap(req, res) {
  try {
    const auth = resolveRequestAuth(req);
    const username = String(auth.username || '').trim();
    if (!username) {
      return sendJson(res, 400, { error: 'Authenticated username missing.' });
    }

    const plan = await buildV2RunPlan({
      users: [username],
      target: 'Local',
    });
    const publicPlan = toPublicV2RunPlan(plan);
    const user = publicPlan.users[0] || null;
    const profile = getV2Profile();
    const globalBlockingIssues = publicPlan.issues.filter((issue) =>
      issue.level === 'error' && issue.code !== 'TEMPLATE_MISSING'
    );
    const signatureOptions = (user?.availableDomains || user?.domains || []).map((key) => {
      const templateErrors = publicPlan.templateChecks.filter(
        (check) => check.domain === key && !check.ok && check.level === 'error'
      );
      return {
        key,
        label: getV2SignatureLabel(profile, key),
        displayLabel: `${key} (${getV2SignatureLabel(profile, key)})`,
        ready: globalBlockingIssues.length === 0 && templateErrors.length === 0,
      };
    });
    const friendlyIssues = globalBlockingIssues.map((issue) => ({
      level: issue.level,
      code: issue.code,
      message: issue.message,
    }));

    return sendJson(res, 200, {
      username,
      role: auth.role,
      source: auth.source,
      user,
      signatures: user?.availableDomains || user?.domains || [],
      signatureOptions,
      ready: signatureOptions.some((option) => option.ready),
      issues: friendlyIssues,
      outlook: {
        classicFolder: '%APPDATA%\\Microsoft\\Signatures',
        note: 'Für klassisches Outlook: Paket entpacken und die enthaltenen Signaturdateien in diesen Ordner kopieren.',
      },
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message, code: error.code });
  }
}

async function handleGenerateSelf(req, res) {
  let runFilePath = '';
  let runConfigPath = '';
  let runVariablesPath = '';
  try {
    const auth = resolveRequestAuth(req);
    const username = String(auth.username || '').trim();
    if (!username) {
      return sendJson(res, 400, { error: 'Authenticated username missing.' });
    }

    let body = {};
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      body = await parseJsonBody(req);
    }
    const requestedSignatures = normalizeStringList(body?.signatures || []);
    const signatureSelection = requestedSignatures.length || Array.isArray(body?.signatures)
      ? { [username]: requestedSignatures }
      : undefined;

    const plan = await buildV2RunPlan({
      users: [username],
      target: 'Local',
      signatureSelection,
    });
    if (!plan.ok || plan.users.length !== 1) {
      return sendJson(res, 422, {
        error: 'Self-service preflight failed. Nothing was generated.',
        plan: toPublicV2RunPlan(plan),
      });
    }

    const user = plan.users[0];
    const preferredHeaders = uniqueCaseInsensitive([
      ...buildPreferredHeaders(plan.mappedAttributes),
      ...plan.configAdProperties,
      'userPrincipalName',
      'Domains',
      'Enabled',
    ]);
    const row = {};
    preferredHeaders.forEach((header) => {
      if (header.toLowerCase() === 'domains') {
        row[header] = user.domains.join(';');
      } else if (header.toLowerCase() === 'enabled') {
        row[header] = 'True';
      } else {
        const value = findValueByAliases(user.raw, header, plan.aliasMap);
        row[header] = Array.isArray(value) ? value.join(';') : value;
      }
    });

    const runDir = path.join(ROOT_DIR, 'config', '.runs');
    await fs.promises.mkdir(runDir, { recursive: true });
    const runId = `self-${sanitizeFileSegment(username,'user')}-${Date.now()}`;
    runFilePath = path.join(runDir, `${runId}.csv`);
    runConfigPath = path.join(runDir, `${runId}-config.json`);
    runVariablesPath = path.join(runDir, `${runId}-variables.json`);

    await fs.promises.writeFile(runFilePath, convertObjectsToCsv([row], preferredHeaders), 'utf8');
    await fs.promises.writeFile(runConfigPath, `${JSON.stringify(profileToLegacyConfig(plan.profile), null, 2)}\n`, 'utf8');
    await fs.promises.writeFile(runVariablesPath, `${JSON.stringify(plan.profile.variables, null, 2)}\n`, 'utf8');

    const selfPreviewDir = path.join(plan.profile.targets.preview.path, user.id);
    await fs.promises.rm(selfPreviewDir, { recursive: true, force: true });

    const scriptResult = await queueGenerateScript({
      userFilePath: runFilePath,
      mode: 'userFile',
      deploymentMode: 'Local',
      useOutlookFolder: false,
      useTestTemplates: false,
      validateOnly: false,
      skipAcls: true,
      respectUserDomains: true,
      configFilePath: runConfigPath,
      variablesFilePath: runVariablesPath,
      localDeploymentPath: plan.profile.targets.preview.path,
      networkDeploymentPath: plan.profile.targets.production.path,
      allowGlobalTestTemplates: false,
    });

    const sourceDir = path.join(plan.profile.targets.preview.path, user.id);
    const snapshot = await snapshotSelfServiceSignatures({
      username: user.id,
      domains: user.domains,
      deploymentMode: 'Local',
      useOutlookFolder: false,
      sourceDirOverride: sourceDir,
    });

    return sendJson(res, 200, {
      message: 'Deine Signaturen wurden erstellt.',
      username: user.id,
      signatures: user.domains,
      plan: toPublicV2RunPlan(plan),
      download: {
        url: buildSelfSignatureDownloadPath(),
        filename: `signaturee-${sanitizeFileSegment(user.id,'user')}-${toBackupTimestampLabel(snapshot.createdAt)}.zip`,
        createdAt: snapshot.createdAt,
      },
      outlook: {
        classicFolder: '%APPDATA%\\Microsoft\\Signatures',
      },
      script: scriptResult,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error.message,
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    });
  } finally {
    [runFilePath, runConfigPath, runVariablesPath].filter(Boolean).forEach((filePath) => {
      fs.promises.rm(filePath, { force: true }).catch(() => {});
    });
  }
}

async function handleSelfSignatureDownload(req, res) {
  let zipPath = '';
  try {
    const auth = resolveRequestAuth(req);
    const username = String(auth.username || '').trim();
    if (!username) {
      return sendJson(res, 400, { error: 'Authenticated username missing.' });
    }

    const userRoot = path.join(SELF_SERVICE_ARTIFACT_PATH, sanitizeFileSegment(username, 'user'));
    const latestDir = path.join(userRoot, 'latest');
    if (!fs.existsSync(latestDir)) {
      return sendJson(res, 404, { error: 'No generated self-service signature package available yet.' });
    }

    let domain = 'signatures';
    let stamp = toBackupTimestampLabel(new Date().toISOString());
    const manifestPath = path.join(userRoot, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = await fs.promises.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(raw);
        const domainLabel = Array.isArray(manifest.domains) && manifest.domains.length
          ? manifest.domains.join('-')
          : (manifest.domain || 'signatures');
        domain = sanitizeFileSegment(domainLabel, 'signatures');
        stamp = toBackupTimestampLabel(manifest.createdAt || new Date().toISOString());
      } catch {
        // Keep fallback labels.
      }
    }

    zipPath = path.join(userRoot, `download-${Date.now()}.zip`);
    const sourceGlob = path.join(latestDir, '*');
    const psScript = [
      "$ErrorActionPreference = 'Stop'",
      `$source = '${escapePowerShellString(sourceGlob)}'`,
      `$destination = '${escapePowerShellString(zipPath)}'`,
      'if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }',
      'Compress-Archive -Path $source -DestinationPath $destination -Force',
    ].join('; ');
    await runPowerShellInline(psScript);

    const filename = `signaturee-${sanitizeFileSegment(username, 'user')}-${domain}-${stamp}.zip`;
    const stats = await fs.promises.stat(zipPath);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': stats.size,
    });
    const stream = fs.createReadStream(zipPath);
    stream.on('error', (error) => {
      if (!res.headersSent) sendJson(res, 500, { error: error.message });
      else res.destroy(error);
    });
    stream.on('close', () => {
      fs.promises.rm(zipPath, { force: true }).catch(() => {});
    });
    stream.pipe(res);
  } catch (error) {
    if (zipPath) fs.promises.rm(zipPath, { force: true }).catch(() => {});
    return sendJson(res, getErrorStatus(error), { error: error.message, code: error.code });
  }
}

function parseCsvLine(line) {
  const entries = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      entries.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  entries.push(current);
  return entries.map((value) => value.trim());
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      const key = header || `col${index}`;
      row[key] = values[index] || '';
    });
    return row;
  });
}

function buildPreferredHeaders(mappedAttributes = []) {
  return uniqueCaseInsensitive(['sAMAccountName', 'mail', 'givenName', 'sn', ...mappedAttributes]);
}

function convertObjectsToCsv(objects = [], preferredHeaders = []) {
  if (!objects.length) return '';
  const headers = uniqueCaseInsensitive([
    ...preferredHeaders,
    ...objects.flatMap((obj) => Object.keys(obj || {})),
  ]);

  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = objects.map((obj) =>
    headers.map((h) => {
      const matchKey = Object.keys(obj || {}).find((k) => k && k.toLowerCase() === h.toLowerCase());
      return escape(matchKey ? obj[matchKey] : '');
    }),
  );
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

async function readUserEntries() {
  const storedCsv = dbGetText(STORE_KEYS.usersCsv);
  if (storedCsv && storedCsv.trim()) {
    const users = parseCsv(storedCsv);
    const dedupedFromDb = new Map();
    users.forEach((user) => {
      const key =
        String(
          user.sAMAccountName ||
          user.samaccountname ||
          user.SAMAccountName ||
          user.mail ||
          user.Email ||
          user.email ||
          '',
        )
          .trim()
          .toLowerCase();
      if (!key) return;
      dedupedFromDb.set(key, user);
    });
    return {
      filePath: USER_FILE_PATH,
      extension: '.csv',
      users: Array.from(dedupedFromDb.values()),
    };
  }

  const primaryPath = getExistingUserFilePath();
  if (!primaryPath) {
    const error = new Error('No user file found. Import users first.');
    error.status = 404;
    throw error;
  }

  const sources = Array.from(
    new Set(
      [primaryPath, lastUserFilePath, USER_FILE_PATH, ...DEFAULT_USER_FILE_CANDIDATES]
        .filter(Boolean)
        .filter((p) => fs.existsSync(p)),
    ),
  );

  const loadedUsers = [];
  for (const source of sources) {
    const raw = await fs.promises.readFile(source, 'utf8');
    const extension = path.extname(source).toLowerCase();
    if (extension !== '.csv') continue;
    const users = parseCsv(raw);
    loadedUsers.push({ users, source, extension });
  }

  if (!loadedUsers.length) {
    const error = new Error('No supported user files found.');
    error.status = 404;
    throw error;
  }

  const deduped = new Map();
  for (const entry of loadedUsers) {
    for (const user of entry.users) {
      const key =
        String(
          user.sAMAccountName ||
          user.samaccountname ||
          user.SAMAccountName ||
          user.mail ||
          user.Email ||
          user.email ||
          '',
        )
          .trim()
          .toLowerCase();
      if (!key) continue;
      deduped.set(key, user);
    }
  }

  return {
    filePath: primaryPath,
    extension: path.extname(primaryPath).toLowerCase(),
    users: Array.from(deduped.values()),
  };
}

function fixEncoding(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  if (!value) return value;
  const hasMojibake = value.includes('�') || /Ã.|Ã¼|Ã¶|ÃŸ|Ã„|Ã–|Ãœ/.test(value);
  if (!hasMojibake) return value;
  try {
    return Buffer.from(value, 'latin1').toString('utf8');
  } catch {
    return value;
  }
}

function shapeUserListEntry(entry) {
  const id =
    (entry && (entry.sAMAccountName || entry.SAMAccountName || entry.samaccountname || entry.mail)) || '';
  const normalizedId = fixEncoding(String(id || '').trim());
  if (!normalizedId) return null;

  const mail = fixEncoding(String(entry.mail || entry.Email || entry.email || '').trim() || undefined);
  const givenName = fixEncoding(
    String(entry.givenName || entry.GivenName || entry.firstname || entry.firstName || '').trim(),
  );
  const sn = fixEncoding(String(entry.sn || entry.SN || entry.lastName || entry.lastname || '').trim());
  const displayName = fixEncoding(entry.displayName || [givenName, sn].filter(Boolean).join(' ') || normalizedId);
  const department = fixEncoding(String(entry.department || entry.Department || '').trim() || undefined);
  const description = fixEncoding(String(entry.description || entry.Description || '').trim() || undefined);
  const domains = parseDomainList(entry.Domains || entry.domains);
  const dn = fixEncoding(String(entry.distinguishedName || entry.DistinguishedName || '').trim());
  let ou = '';
  if (dn) {
    const match = dn.match(/(OU=.*)/i);
    if (match) {
      ou = match[1].replace(/OU=/gi, '').replace(/,/g, ' / ');
    }
  }

  return {
    id: normalizedId,
    displayName,
    mail,
    department,
    description,
    ou,
    domains,
  };
}

async function handleUserList(_req, res) {
  try {
    const { filePath, extension, users } = await readUserEntries();
    const shaped = users
      .map((entry) => shapeUserListEntry(entry))
      .filter(Boolean);

    return sendJson(res, 200, {
      users: shaped,
      source: {
        path: filePath,
        extension,
        type: 'manual',
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return sendJson(res, status, { error: error.message, code: error.code });
  }
}



function normalizeStringList(values = []) {
  const source = Array.isArray(values) ? values : String(values || '').split(/[;,\n]/);
  return uniqueCaseInsensitive(source.map((value) => String(value || '').trim()).filter(Boolean));
}

function normalizeV2Profile(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const signaturesSource = source.signatures && typeof source.signatures === 'object' ? source.signatures : {};
  const signatures = {};
  Object.entries(signaturesSource).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || '').trim();
    if (!key) return;
    const value = rawValue && typeof rawValue === 'object' ? rawValue : {};
    signatures[key] = {
      label: String(value.label || key).trim() || key,
      adGroups: normalizeStringList(value.adGroups || value.adGroup || []),
      templateHtml: String(value.templateHtml || '').trim(),
      templateTxt: String(value.templateTxt || '').trim(),
      resourceFolder: String(value.resourceFolder || '').trim(),
      faxFallback: String(value.faxFallback || '').trim(),
      customTitleAttr: String(value.customTitleAttr || '').trim(),
    };
  });

  const variables = normalizeVariableSchemaPayload(
    source.variables && typeof source.variables === 'object'
      ? source.variables
      : DEFAULT_VARIABLE_SCHEMA
  );

  return {
    version: 2,
    organization: {
      name: String(source.organization?.name || 'Example Organization').trim() || 'Example Organization',
    },
    directory: {
      server: String(source.directory?.server || '').trim(),
      searchBase: String(source.directory?.searchBase || '').trim(),
    },
    targets: {
      preview: {
        path: String(source.targets?.preview?.path || path.join(ROOT_DIR, 'generatedsignatures')).trim(),
      },
      production: {
        path: String(source.targets?.production?.path || '').trim(),
      },
    },
    signatures,
    secondaryTitleAttributes: normalizeStringList(source.secondaryTitleAttributes || []),
    variables,
  };
}

function legacyStateToV2Profile() {
  const config = loadConfigJson() || {};
  const variables = loadVariableSchema();
  const reverseGroups = {};
  Object.entries(config.securityGroupMapping || {}).forEach(([group, domain]) => {
    const key = String(domain || '').trim();
    if (!key) return;
    if (!reverseGroups[key]) reverseGroups[key] = [];
    reverseGroups[key].push(group);
  });
  const signatures = {};
  Object.entries(config.domains || {}).forEach(([key, value]) => {
    signatures[key] = {
      label: key,
      adGroups: reverseGroups[key] || [],
      templateHtml: value?.templateHtml || '',
      templateTxt: value?.templateTxt || '',
      resourceFolder: value?.resourceFolder || '',
      faxFallback: value?.faxFallback || '',
      customTitleAttr: value?.customTitleAttr || '',
    };
  });

  return normalizeV2Profile({
    version: 2,
    organization: { name: 'Example Organization' },
    directory: {
      server: AD_SERVER || '',
      searchBase: config.ouSearchBase || OU_SEARCH_BASE || '',
    },
    targets: {
      preview: { path: String(process.env.LOCAL_DEPLOYMENT_PATH || LOCAL_DEPLOYMENT_PATH).trim() },
      production: { path: String(process.env.NETWORK_DEPLOYMENT_PATH || '').trim() },
    },
    signatures,
    secondaryTitleAttributes: config.secondaryTitleAttributes || [],
    variables,
  });
}

// v2 business settings come from the single .env file, not a previously stored
// Admin UI profile. JSON values are one-line JSON; individual keys can override
// selected fields. No filesystem writeback to .env is performed by the API.
function parseProfileEnvJson(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid ${key}: ${error.message}`);
  }
}

function envV2Profile() {
  const full = parseProfileEnvJson('SIGNATUREE_PROFILE_JSON', {});
  // Explicit auto-discovery ignores SIGNATUREE_SIGNATURES_JSON: no stale
  // example JSON can hide real on-disk signature templates.
  const automatic = parseBooleanFlag(process.env.SIGNATUREE_SIGNATURES_AUTO_DISCOVER || false);
  const signatures = automatic
    ? discoverSignatureProfiles(TEMPLATE_DIRECTORY, {
      groupPrefix: process.env.SIGNATUREE_AUTO_GROUP_PREFIX || 'Signature-',
    })
    : parseProfileEnvJson('SIGNATUREE_SIGNATURES_JSON', full.signatures || {});
  const baseVariables = parseProfileEnvJson('SIGNATUREE_VARIABLES_JSON', full.variables || DEFAULT_VARIABLE_SCHEMA);
  const variableExtrasRaw = process.env.SIGNATUREE_VARIABLES_EXTRA_JSON || '[]';
  let variableExtras;
  try { variableExtras = JSON.parse(variableExtrasRaw); }
  catch { throw new Error('Invalid SIGNATUREE_VARIABLES_EXTRA_JSON JSON.'); }
  const variables = adminEnvEditor.mergeVariables(baseVariables, variableExtras);
  return normalizeV2Profile({
    ...full,
    organization: {
      name: process.env.SIGNATUREE_ORGANIZATION_NAME ?? full.organization?.name ?? 'Example Organization',
    },
    directory: {
      server: process.env.AD_SERVER ?? full.directory?.server ?? '',
      searchBase: process.env.OU_SEARCH_BASE ?? full.directory?.searchBase ?? '',
    },
    targets: {
      preview: { path: process.env.LOCAL_DEPLOYMENT_PATH ?? full.targets?.preview?.path ?? '' },
      production: { path: process.env.NETWORK_DEPLOYMENT_PATH ?? full.targets?.production?.path ?? '' },
    },
    signatures,
    secondaryTitleAttributes: process.env.SIGNATUREE_SECONDARY_TITLE_ATTRIBUTES !== undefined
      ? normalizeStringList(process.env.SIGNATUREE_SECONDARY_TITLE_ATTRIBUTES)
      : (full.secondaryTitleAttributes || []),
    variables,
  });
}

function getV2Profile() {
  if (CONFIG_MODE === 'env') return envV2Profile();
  const stored = dbGetJson(STORE_KEYS.v2Profile);
  if (stored && typeof stored === 'object') {
    return normalizeV2Profile(stored);
  }
  const migrated = legacyStateToV2Profile();
  dbSetJson(STORE_KEYS.v2Profile, migrated);
  return migrated;
}

function profileToLegacyConfig(profileRaw) {
  const profile = normalizeV2Profile(profileRaw);
  const domains = {};
  const securityGroupMapping = {};
  Object.entries(profile.signatures).forEach(([key, signature]) => {
    domains[key] = {
      templateHtml: signature.templateHtml,
      templateTxt: signature.templateTxt,
      resourceFolder: signature.resourceFolder,
      faxFallback: signature.faxFallback,
      customTitleAttr: signature.customTitleAttr,
    };
    signature.adGroups.forEach((group) => {
      securityGroupMapping[group] = key;
    });
  });
  return {
    domains,
    securityGroupMapping,
    secondaryTitleAttributes: profile.secondaryTitleAttributes,
    ouSearchBase: profile.directory.searchBase,
  };
}

function validateV2Profile(profileRaw) {
  const profile = normalizeV2Profile(profileRaw);
  const errors = [];
  if (!profile.organization.name) errors.push('Organization name is required.');
  if (!Object.keys(profile.signatures).length) errors.push('At least one signature definition is required.');
  if (!profile.targets.preview.path) errors.push('Preview target path is required.');
  if (!profile.targets.production.path) errors.push('Production target path is required.');

  const seenGroups = new Map();
  Object.entries(profile.signatures).forEach(([key, signature]) => {
    if (!signature.templateHtml) errors.push(`${key}: HTML template is required.`);
    if (!signature.templateTxt) errors.push(`${key}: TXT template is required.`);
    if (!signature.adGroups.length) errors.push(`${key}: at least one AD group is required.`);
    signature.adGroups.forEach((group) => {
      const normalized = group.toLowerCase();
      if (seenGroups.has(normalized) && seenGroups.get(normalized) !== key) {
        errors.push(`AD group "${group}" is assigned to both ${seenGroups.get(normalized)} and ${key}.`);
      } else {
        seenGroups.set(normalized, key);
      }
    });
  });

  if (!profile.variables.variables.length) errors.push('At least one variable is required.');
  return { profile, errors };
}

function buildV2ProfileStatus(profileRaw) {
  const profile = normalizeV2Profile(profileRaw);
  const legacyConfig = profileToLegacyConfig(profile);
  const signatureStatus = Object.entries(profile.signatures).map(([key, signature]) => {
    const htmlPath = signature.templateHtml ? path.join(V2_TEMPLATE_DIRECTORY, signature.templateHtml) : '';
    const txtPath = signature.templateTxt ? path.join(V2_TEMPLATE_DIRECTORY, signature.templateTxt) : '';
    const resourcePath = signature.resourceFolder ? path.join(V2_TEMPLATE_DIRECTORY, signature.resourceFolder) : '';
    return {
      key,
      html: { path: htmlPath, exists: Boolean(htmlPath && fs.existsSync(htmlPath)) },
      txt: { path: txtPath, exists: Boolean(txtPath && fs.existsSync(txtPath)) },
      resources: signature.resourceFolder
        ? { path: resourcePath, exists: fs.existsSync(resourcePath) }
        : null,
    };
  });
  return {
    signatureStatus,
    mappedGroups: Object.keys(legacyConfig.securityGroupMapping).length,
    variableCount: profile.variables.variables.length,
  };
}

async function handleV2SignatureCreate(req,res){
  try{
    if(!AUTH_REQUIRED)return sendJson(res,403,{error:'Für die Signaturverwaltung muss die Anmeldung aktiviert sein.'});
    if(CONFIG_MODE!=='env'||!parseBooleanFlag(process.env.SIGNATUREE_SIGNATURES_AUTO_DISCOVER||false))
      return sendJson(res,409,{error:'Die automatische Template-Erkennung ist nicht aktiviert. Manuelle Signaturen werden über die bestehende Profilzuordnung eingerichtet.'});
    if(!(req.headers['content-type']||'').includes('multipart/form-data'))
      return sendJson(res,415,{error:'HTML und TXT als Datei-Upload senden.'});
    const {fields,files}=await parseMultipart(req);
    if(Array.isArray(fields.key))return sendJson(res,400,{error:'Signatur-Kürzel nur einmal angeben.'});
    const result=await createSignaturePair(V2_TEMPLATE_DIRECTORY,fields.key,files,{
      groupPrefix:process.env.SIGNATUREE_AUTO_GROUP_PREFIX||'Signature-'
    });
    // Do not change .env, generate AD groups or restart tasks. The current
    // env-mode catalog is discovered when each profile request is handled.
    return sendJson(res,201,{...result,profile:getV2Profile(),
      message:'Signatur angelegt. Sie erscheint ab sofort im Template-Katalog. Die AD-Gruppe muss bereits existieren.'});
  }catch(error){
    return sendJson(res,error.status||getErrorStatus(error),{
      error:error instanceof SignatureCreateError?error.message:error.message,
      code:error.code||'SIGNATURE_CREATE_FAILED'
    });
  }
}

async function handleV2TemplateImport(req, res) {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return sendJson(res, 415, { error: 'V2 template upload expects multipart/form-data.' });
    }
    const { files } = await parseMultipart(req);
    if (!files.length) {
      return sendJson(res, 400, { error: 'No template files provided.' });
    }
    const savedPaths = [];
    for (const file of files) {
      const extension = path.extname(file.filename || '').toLowerCase();
      if (!['.htm', '.html', '.txt'].includes(extension)) {
        return sendJson(res, 415, { error: `Unsupported template type: ${file.filename}` });
      }
      const saved = await saveIncomingFile(file, V2_TEMPLATE_DIRECTORY);
      savedPaths.push(saved);
    }
    return sendJson(res, 200, {
      message: 'Template assets uploaded.',
      savedPaths,
      templateDirectory: V2_TEMPLATE_DIRECTORY,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message, code: error.code });
  }
}

async function handleV2AdminEnvGet(_req, res) {
  try {
    if (CONFIG_MODE !== 'env') return sendJson(res, 409, { error:'Admin .env editor requires env mode.' });
    const snapshot=adminEnvEditor.publicSnapshot(ROOT_DIR, DEFAULT_VARIABLE_SCHEMA);
    return sendJson(res, 200, {
      ...snapshot,
      requiresRestart: snapshot.revision !== STARTUP_ENV_REVISION,
      instanceId: BACKEND_INSTANCE_ID,
    });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message, code: error.code });
  }
}

let adminEnvSaveBusy = false;
async function handleV2AdminEnvPut(req, res) {
  if (CONFIG_MODE !== 'env') return sendJson(res, 409, { error:'Admin .env editor requires env mode.' });
  if (adminEnvSaveBusy) return sendJson(res, 409, { error:'Another configuration save is in progress.' });
  if (!(req.headers['content-type'] || '').includes('application/json'))
    return sendJson(res, 415, { error:'Expected JSON.' });
  // A cross-origin request must never write a server-side .env even if an
  // administrator's bearer token is available to unrelated JS.
  const origin=req.headers.origin;
  if (origin) {
    let sameHost=false;
    try {
      const source=new URL(origin);
      const backend=new URL('http://'+String(req.headers.host||''));
      sameHost=source.hostname.toLowerCase()===backend.hostname.toLowerCase();
    } catch {}
    if (!sameHost) return sendJson(res,403,{ error:'Admin file edits require a same-host origin.' });
  }
  adminEnvSaveBusy = true;
  try {
    const body = await parseJsonBody(req);
    const result=adminEnvEditor.persist(ROOT_DIR,body?.revision,body?.values,
      body?.variables,DEFAULT_VARIABLE_SCHEMA);
    return sendJson(res, 200, {
      ...result,message:'.env safely saved and backed up. Restart the backend to activate changes.'
    });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      error: error.code === 'ENV_CHECK_FAILED' ? error.message : error.message,
      code: error.code,
    });
  } finally { adminEnvSaveBusy=false; }
}

async function handleV2ProfileGet(_req, res) {
  try {
    const profile = getV2Profile();
    return sendJson(res, 200, {
      profile,
      status: buildV2ProfileStatus(profile),
      source: CONFIG_MODE === 'env' ? 'environment (.env)' : 'profile_v2',
      automaticSignatures: CONFIG_MODE === 'env' &&
        parseBooleanFlag(process.env.SIGNATUREE_SIGNATURES_AUTO_DISCOVER || false),
      automaticGroupPrefix: process.env.SIGNATUREE_AUTO_GROUP_PREFIX || 'Signature-',
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message, code: error.code });
  }
}

async function handleV2ProfilePut(req, res) {
  try {
    if (CONFIG_MODE === 'env') {
      return sendJson(res, 409, {
        error: 'Profile is managed by .env. Edit the environment and restart the backend; Admin UI cannot overwrite it.',
        source: 'environment (.env)',
      });
    }
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'Profile update expects application/json.' });
    }
    const body = await parseJsonBody(req);
    const { profile, errors } = validateV2Profile(body?.profile || body);
    if (errors.length) {
      return sendJson(res, 422, { error: 'Profile validation failed.', errors, profile });
    }
    dbSetJson(STORE_KEYS.v2Profile, profile);
    return sendJson(res, 200, {
      message: 'Signaturee v2 configuration saved.',
      profile,
      status: buildV2ProfileStatus(profile),
      source: 'profile_v2',
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message, code: error.code });
  }
}

// A path test runs as the backend Scheduled Task identity. Categorize SMB
// errors at their actual stage; do not claim write/ACL success after stat fails.
function describeV2TargetFailure(targetPath, error, stage) {
  const unc = String(targetPath || '').startsWith('\\\\');
  const code = String(error?.code || '');
  if (!unc) return { code: code || 'FS_ERROR' };
  const ipUnc = /^\\\\(?:\d{1,3}\.){3}\d{1,3}\\/.test(targetPath);
  const dnsTip = ipUnc
    ? ' Verwende statt der IP den echten Servernamen/FQDN (Kerberos statt ggf. blockiertem NTLM).'
    : '';
  if (code === 'EACCES' || code === 'EPERM') {
    return { code: 'SMB_ACCESS_DENIED',
      hint: 'Der Backend-Dienst darf diesen UNC-Pfad nicht öffnen. Berechtigungen auf SMB-Freigabe und NTFS-Zielpfad für das tatsächliche Taskkonto prüfen (SYSTEM verwendet bei Domänenfreigaben normalerweise DOMAIN\\COMPUTER$).' + dnsTip };
  }
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return { code: 'SMB_PATH_NOT_FOUND',
      hint: 'Freigabename und alle Unterordner prüfen. Der Zielordner muss bereits existieren; er wird nicht automatisch angelegt.' + dnsTip };
  }
  if (['ENETUNREACH','EHOSTUNREACH','ETIMEDOUT','ECONNREFUSED'].includes(code)) {
    return { code: 'SMB_UNREACHABLE',
      hint: 'Netzwerk, DNS, Firewall und SMB-Port 445 zum Dateiserver prüfen.' + dnsTip };
  }
  return { code: code || 'SMB_TEST_FAILED',
    hint: 'Servernamen, Erreichbarkeit und Berechtigungen des Taskkontos prüfen.' + dnsTip };
}

// Probe from the backend's actual Windows identity (SYSTEM/computer account or service account).
// The temporary directory is removed even on failure. Production requires WRITE_DAC as
// well as share/NTFS write access because the generator sets per-user directory ACLs.
async function probeV2TargetAccess(targetPath, { requireAcl = false, createIfMissing = false } = {}) {
  if (!targetPath) return { exists: false, directory: false, writable: false, aclWritable: false, error: 'No path configured.' };
  let stats;
  let created = false;
  try {
    stats = await fs.promises.stat(targetPath);
  } catch (error) {
    if (error.code !== 'ENOENT' || !createIfMissing) {
      return { exists: false, directory: false, writable: false, aclWritable: false, stage: 'stat', error: error.message,
        ...describeV2TargetFailure(targetPath, error, 'stat') };
    }
    try {
      // Only the LOCAL preview path may be created automatically, never the production UNC.
      await fs.promises.mkdir(targetPath, { recursive: true });
      stats = await fs.promises.stat(targetPath);
      created = true;
    } catch (mkdirError) {
      return { exists: false, directory: false, writable: false, aclWritable: false, stage: 'mkdir',
        error: mkdirError.message, hint: 'Der lokale Vorschaupfad konnte nicht angelegt werden. Dienstkonto und Laufwerksrechte prüfen.' };
    }
  }
  if (!stats.isDirectory()) {
    return { exists: true, directory: false, writable: false, aclWritable: false, error: 'Configured path is not a directory.' };
  }

  const probeDir = path.join(targetPath,
    `.signaturee-access-test-${process.pid}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`);
  let probeCreated = false;
  let stage = 'mkdir';
  try {
    await fs.promises.mkdir(probeDir);
    probeCreated = true;
    stage = 'write';
    const probeFile = path.join(probeDir, 'write-test.tmp');
    await fs.promises.writeFile(probeFile, 'Signaturee write test\n', { flag: 'wx' });
    await fs.promises.readFile(probeFile, 'utf8');

    if (!requireAcl) {
      return { exists: true, directory: true, writable: true, aclWritable: null, created,
        message: created ? 'Vorschauordner angelegt; Pfad ist erreichbar und schreibbar.' : 'Path is reachable and writable.' };
    }
    stage = 'acl';
    if (process.platform !== 'win32') {
      return { exists: true, directory: true, writable: true, aclWritable: false, error: 'ACL validation requires a Windows backend.' };
    }

    const { command } = await resolvePowerShellCommand();
    const aclScript = [
      '$ErrorActionPreference = "Stop"',
      '$acl = Get-Acl -LiteralPath $env:SIGNATUREE_ACL_PROBE_DIR',
      'Set-Acl -LiteralPath $env:SIGNATUREE_ACL_PROBE_DIR -AclObject $acl',
    ].join('; ');
    const aclResult = await new Promise((resolve) => {
      const child = spawn(command, ['-NoProfile', '-NonInteractive', '-Command', aclScript], {
        env: { ...process.env, SIGNATUREE_ACL_PROBE_DIR: probeDir },
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => resolve({ ok: false, error: error.message }));
      child.on('close', (code) => resolve({
        ok: code === 0,
        error: code === 0 ? '' : (stderr.trim() || `Set-Acl failed (exit ${code})`),
      }));
    });
    return {
      exists: true, directory: true, writable: true, aclWritable: aclResult.ok,
      ...(aclResult.ok
        ? { message: 'Path is writable and the execution identity can set folder ACLs.' }
        : { error: `Cannot set folder ACLs: ${aclResult.error}` }),
    };
  } catch (error) {
    return { exists: true, directory: true, writable: false, aclWritable: false, stage, error: error.message,
      ...describeV2TargetFailure(targetPath, error, stage),
      ...(stage === 'acl' ? { hint: 'Berechtigung zum Ändern von Ordner-ACLs fehlt. NTFS-Rechte des Backend-Dienstkontos prüfen.' } : {}) };
  } finally {
    if (probeCreated) {
      await fs.promises.rm(probeDir, { recursive: true, force: true }).catch(
        (error) => console.warn(`Cannot remove temporary deployment probe ${probeDir}: ${error.message}`));
    }
  }
}

async function handleV2TargetCheck(req, res) {
  try {
    if (!AUTH_REQUIRED) return sendJson(res,403,{error:'Path probes require authentication to be enabled.'});
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'Target check expects application/json.' });
    }
    const body = await parseJsonBody(req);
    const targetKey = String(body?.target || '').trim().toLowerCase();
    if (targetKey !== 'preview' && targetKey !== 'production') {
      return sendJson(res, 400, { error: 'Target must be preview or production.' });
    }
    const profile = getV2Profile();
    const trial = Object.prototype.hasOwnProperty.call(body || {}, 'path');
    const activePath = targetKey === 'production'
      ? String(profile.targets?.production?.path || '').trim()
      : resolvePath(String(profile.targets?.preview?.path || '').trim());
    let targetPath = activePath;
    if (trial) {
      if (typeof body.path !== 'string' || body.path.length < 3 ||
          body.path.length > 1024 || /[\0\r\n]/.test(body.path)) {
        return sendJson(res, 400, { error:'Ungültiger Testpfad.' });
      }
      const candidate = body.path.trim();
      if (targetKey === 'production') {
        // Only a UNC share, never a local disk or a URL. Nothing is saved.
        if (!/^\\\\[^\\\/]+\\[^\\\/]+(?:\\[^\r\n]*)?$/.test(candidate) ||
            candidate.includes('..') || /[<>|?*"]/u.test(candidate)) {
          return sendJson(res, 400, { error:'Für Produktion ist ein gültiger UNC-Pfad erforderlich.' });
        }
        targetPath = candidate;
      } else {
        if (candidate.startsWith('\\\\') || candidate.split(/[\\/]/).includes('..')) {
          return sendJson(res,400,{error:'Der Vorschau-Test akzeptiert keine UNC- oder übergeordneten Pfade.'});
        }
        targetPath = resolvePath(candidate);
      }
    }
    const result = await probeV2TargetAccess(targetPath, {
      requireAcl: targetKey === 'production',
      // An arbitrary trial path is never created; only explicitly configured
      // local preview output may be initialized automatically.
      createIfMissing: !trial && targetKey === 'preview' && !targetPath.startsWith('\\\\'),
    });
    return sendJson(res, targetPath ? 200 : 422, {
      target: targetKey, path: targetPath, temporaryTest: trial, ...result
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message, code: error.code });
  }
}

function normalizeMemberOfValues(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  if (value === null || value === undefined) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  return raw.split(/[;\n]/).map((entry) => entry.trim()).filter(Boolean);
}

function resolveDomainsFromMemberOf(memberOf, config = {}) {
  const domains = config.domains || {};
  const mapping = config.securityGroupMapping || {};
  const resolved = [];
  const add = (key) => {
    const actual = Object.keys(domains).find((candidate) => candidate.toLowerCase() === String(key || '').toLowerCase());
    if (actual && !resolved.includes(actual)) resolved.push(actual);
  };

  normalizeMemberOfValues(memberOf).forEach((groupDn) => {
    const groupName = (groupDn.match(/^CN=([^,]+)/i)?.[1] || groupDn).trim();
    if (!groupName) return;
    if (groupName.toLowerCase() === 'signatur-alle') {
      Object.keys(domains).forEach(add);
      return;
    }
    Object.entries(mapping).forEach(([securityGroup, domainKey]) => {
      const key = String(securityGroup).trim();
      // A full DN must match that exact DN (not just its CN) to avoid granting
      // signatures from an identically named group in another AD container.
      const isDn = /^CN=/i.test(key) && key.includes(',');
      const matches = isDn
        ? groupDn.toLowerCase() === key.toLowerCase()
        : groupName.toLowerCase() === key.toLowerCase();
      if (matches) add(domainKey);
    });
  });
  return resolved;
}

function getV2Target(targetRaw, profileRaw) {
  const profile = normalizeV2Profile(profileRaw);
  const normalized = String(targetRaw || '').trim().toLowerCase();
  if (normalized === 'network' || normalized === 'production') {
    return {
      key: 'Network',
      label: 'Produktivbereitstellung',
      path: profile.targets.production.path,
      skipAcls: false,
    };
  }
  return {
    key: 'Local',
    label: 'Server-Vorschau',
    path: resolvePath(profile.targets.preview.path),
    skipAcls: true,
  };
}

function getRawValue(source, key) {
  const match = Object.keys(source || {}).find((candidate) => candidate.toLowerCase() === String(key || '').toLowerCase());
  return match ? source[match] : '';
}

function getV2TemplateChecks(domainKeys, config = {}) {
  const checks = [];
  (domainKeys || []).forEach((domainKey) => {
    const cfg = config.domains?.[domainKey];
    if (!cfg) {
      checks.push({ ok: false, level: 'error', domain: domainKey, label: `${domainKey}: Domain configuration missing` });
      return;
    }
    const required = [
      ['HTML', cfg.templateHtml],
      ['TXT', cfg.templateTxt],
    ];
    required.forEach(([kind, filename]) => {
      const filePath = filename ? path.join(V2_TEMPLATE_DIRECTORY, filename) : '';
      const ok = Boolean(filename && fs.existsSync(filePath));
      checks.push({
        ok,
        level: ok ? 'success' : 'error',
        domain: domainKey,
        label: ok ? `${domainKey}: ${kind} template ready` : `${domainKey}: ${kind} template missing`,
        path: filePath || undefined,
      });
    });
    if (cfg.resourceFolder) {
      const resourcePath = path.join(V2_TEMPLATE_DIRECTORY, cfg.resourceFolder);
      const ok = fs.existsSync(resourcePath);
      checks.push({
        ok,
        level: ok ? 'success' : 'warning',
        domain: domainKey,
        label: ok ? `${domainKey}: resources ready` : `${domainKey}: resource folder missing`,
        path: resourcePath,
      });
    }
  });
  return checks;
}

function getV2SignatureLabel(profileRaw, keyRaw) {
  const profile = normalizeV2Profile(profileRaw);
  const key = String(keyRaw || '').trim();
  const signatureKey = Object.keys(profile.signatures || {}).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase(),
  ) || key;
  const configured = String(profile.signatures?.[signatureKey]?.label || '').trim();
  if (configured && configured.toLowerCase() !== signatureKey.toLowerCase()) return configured;
  return configured || signatureKey;
}

function getV2SignatureCatalog(profileRaw) {
  const profile = normalizeV2Profile(profileRaw);
  return Object.keys(profile.signatures || {}).map((key) => ({
    key,
    label: getV2SignatureLabel(profile, key),
    displayLabel: `${key} (${getV2SignatureLabel(profile, key)})`,
  }));
}

function getRequestedSignatureSelection(selectionRaw, identities = []) {
  if (!selectionRaw || typeof selectionRaw !== 'object' || Array.isArray(selectionRaw)) return null;
  const identityKeys = identities.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  const match = Object.keys(selectionRaw).find((candidate) =>
    identityKeys.includes(String(candidate || '').trim().toLowerCase())
  );
  if (!match) return null;
  return normalizeStringList(selectionRaw[match]);
}

function selectAssignedSignatures(availableDomains, requestedDomains) {
  if (requestedDomains === null) return {
    selected: [...availableDomains],
    invalid: [],
  };
  const availableByLower = new Map(
    availableDomains.map((domain) => [String(domain).toLowerCase(), domain]),
  );
  const selected = [];
  const invalid = [];
  requestedDomains.forEach((requested) => {
    const actual = availableByLower.get(String(requested).toLowerCase());
    if (!actual) {
      invalid.push(requested);
      return;
    }
    if (!selected.includes(actual)) selected.push(actual);
  });
  return { selected, invalid };
}

function findExactAdUserIndex(rawUsers, identifier) {
  const expected = String(identifier || '').trim().toLowerCase();
  if (!expected) return -1;
  const matches = rawUsers.flatMap((raw, index) =>
    ['sAMAccountName', 'mail', 'userPrincipalName']
      .map((key) => String(getRawValue(raw, key) || '').trim().toLowerCase())
      .includes(expected) ? [index] : []
  );
  return matches.length === 1 ? matches[0] : -1;
}

async function buildV2RunPlan(body = {}) {
  const identifiers = uniqueCaseInsensitive(
    (Array.isArray(body.users) ? body.users : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  const issues = [];
  if (!identifiers.length) {
    issues.push({ level: 'error', code: 'NO_USERS', message: 'Select at least one person.' });
  }
  if (identifiers.length > 50) {
    issues.push({ level: 'error', code: 'TOO_MANY_USERS', message: 'This targeted workflow is limited to 50 people per run.' });
  }

  const profile = getV2Profile();
  const config = profileToLegacyConfig(profile);
  const configuredDomains = config.domains || {};
  const target = getV2Target(body.target, profile);
  if (target.key === 'Network') {
    if (!String(profile.targets.production.path || '').trim()) {
      issues.push({
        level: 'error',
        code: 'NETWORK_TARGET_NOT_CONFIGURED',
        message: 'Production output path is not configured in the v2 Admin profile.',
      });
    } else {
      const access = await probeV2TargetAccess(target.path, { requireAcl: true });
      if (!access.writable || !access.aclWritable) {
        issues.push({
          level: 'error',
          code: 'NETWORK_TARGET_NOT_WRITABLE',
          message: `Production target is not ready: ${access.error || 'share/NTFS or ACL permissions missing'}`,
        });
      }
    }
  }
  const schema = profile.variables;
  const profileMappings = buildVariableMappingsFromSchema(schema);
  const mappedAttributes = profileMappings.csvHeaders;
  const adProperties = profileMappings.adProperties;
  const aliasMap = buildAttributeAliasMap(schema);
  const configuredRequiredUserFields = (schema.variables || [])
    .filter((entry) => entry?.required)
    .map((entry) => String(entry?.csvHeader || entry?.id || '').trim())
    .filter(Boolean);
  const requiredUserFields = uniqueCaseInsensitive([
    'sAMAccountName',
    'mail',
    'givenName',
    'sn',
    ...configuredRequiredUserFields,
  ]);
  const configAdProperties = uniqueCaseInsensitive([
    ...(config.secondaryTitleAttributes || []),
    ...Object.values(configuredDomains).map((entry) => entry?.customTitleAttr).filter(Boolean),
  ]);
  const queryProperties = uniqueCaseInsensitive([
    ...(adProperties || []),
    ...configAdProperties,
    'memberOf',
    'userPrincipalName',
    'SID',
    'Enabled',
  ]);

  const resolvedUsers = [];
  if (identifiers.length <= 50) {
    for (const identifier of identifiers) {
      try {
        const result = await queryAdUsers({
          limit: 25,
          search: identifier,
          searchBase: profile.directory.searchBase,
          server: profile.directory.server,
          adProperties: queryProperties,
          allowDefaultFallback: false,
        });
        const rawUsers = result.rawUsers || [];
        const index = findExactAdUserIndex(rawUsers, identifier);
        if (index < 0) {
          issues.push({
            level: 'error',
            code: 'USER_NOT_FOUND',
            user: identifier,
            message: `"${identifier}" has no exact AD account match. Select an exact account.`,
          });
          continue;
        }

        const raw = rawUsers[index];
        const shaped = shapeUserListEntry(raw) || {};
        const availableDomains = resolveDomainsFromMemberOf(getRawValue(raw, 'memberOf'), config);
        const resolvedId = String(getRawValue(raw, 'sAMAccountName') || shaped.id || identifier).trim();
        const resolvedMail = String(getRawValue(raw, 'mail') || shaped.mail || '').trim();
        const requestedDomains = getRequestedSignatureSelection(body.signatureSelection, [
          identifier,
          resolvedId,
          resolvedMail,
          getRawValue(raw, 'userPrincipalName'),
        ]);
        const selection = selectAssignedSignatures(availableDomains, requestedDomains);
        const domains = selection.selected;
        const missing = requiredUserFields.filter((key) => {
          const value = findValueByAliases(raw, key, aliasMap);
          return !String(value || '').trim();
        });
        if (missing.length) {
          issues.push({
            level: 'error',
            code: 'USER_DATA_INCOMPLETE',
            user: identifier,
            message: `${shaped.displayName || identifier}: missing ${missing.join(', ')}.`,
          });
        }
        if (!availableDomains.length) {
          issues.push({
            level: 'error',
            code: 'NO_SIGNATURE_DOMAIN',
            user: identifier,
            message: `${shaped.displayName || identifier}: no signature group/domain is assigned.`,
          });
        }
        if (selection.invalid.length) {
          issues.push({
            level: 'error',
            code: 'SIGNATURE_NOT_ASSIGNED',
            user: identifier,
            message: `${shaped.displayName || identifier}: requested signature is not assigned in AD (${selection.invalid.join(', ')}).`,
          });
        }
        if (availableDomains.length && !domains.length) {
          issues.push({
            level: 'error',
            code: 'NO_SIGNATURE_SELECTED',
            user: identifier,
            message: `${shaped.displayName || identifier}: select at least one signature.`,
          });
        }

        resolvedUsers.push({
          id: resolvedId,
          displayName: shaped.displayName || identifier,
          mail: resolvedMail,
          department: shaped.department || '',
          description: shaped.description || '',
          availableDomains,
          domains,
          outputPath: path.join(target.path, resolvedId),
          raw,
        });
      } catch (error) {
        issues.push({
          level: 'error',
          code: 'AD_LOOKUP_FAILED',
          user: identifier,
          message: `${identifier}: AD lookup failed - ${error.message}`,
        });
      }
    }
  }

  const allDomains = uniqueCaseInsensitive(resolvedUsers.flatMap((user) => user.domains));
  const templateChecks = getV2TemplateChecks(allDomains, config);
  templateChecks
    .filter((check) => !check.ok && check.level === 'error')
    .forEach((check) => issues.push({
      level: 'error',
      code: 'TEMPLATE_MISSING',
      domain: check.domain,
      message: check.label,
    }));

  const signatureCount = resolvedUsers.reduce((sum, user) => sum + user.domains.length, 0);
  const blockingIssues = issues.filter((issue) => issue.level === 'error');

  return {
    ok: identifiers.length > 0 && resolvedUsers.length === identifiers.length && signatureCount > 0 && blockingIssues.length === 0,
    target,
    users: resolvedUsers,
    signatureCount,
    domains: allDomains,
    templateChecks,
    issues,
    mappedAttributes,
    configAdProperties,
    aliasMap,
    profile,
  };
}

function toPublicV2RunPlan(plan) {
  return {
    ok: plan.ok,
    target: plan.target,
    signatureCount: plan.signatureCount,
    domains: plan.domains,
    users: plan.users.map(({ raw, ...user }) => user),
    templateChecks: plan.templateChecks,
    issues: plan.issues,
    signatureCatalog: getV2SignatureCatalog(plan.profile),
  };
}

async function handleV2RunPreflight(req, res) {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'Preflight expects application/json.' });
    }
    const body = await parseJsonBody(req);
    const plan = await buildV2RunPlan(body);
    return sendJson(res, plan.ok ? 200 : 422, toPublicV2RunPlan(plan));
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message, code: error.code });
  }
}

function decodeWindows1252(buffer) {
  try {
    return new TextDecoder('windows-1252').decode(buffer);
  } catch {
    return Buffer.from(buffer).toString('latin1');
  }
}

function previewMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
  };
  return types[extension] || 'application/octet-stream';
}

async function listPreviewAssetFiles(rootDir) {
  const files = [];
  async function walk(current) {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files.push(full);
      }
    }
  }
  await walk(rootDir);
  return files;
}

async function inlinePreviewAssets(html, signatureDir) {
  let result = String(html || '');
  let assetFiles = [];
  try {
    assetFiles = await listPreviewAssetFiles(signatureDir);
  } catch {
    return result;
  }

  const candidates = new Map();
  for (const filePath of assetFiles) {
    const extension = path.extname(filePath).toLowerCase();
    if (!['.png','.jpg','.jpeg','.gif','.svg','.bmp','.webp'].includes(extension)) continue;
    const relative = path.relative(signatureDir, filePath).replaceAll('\\','/');
    const basename = path.basename(filePath).toLowerCase();
    const data = await fs.promises.readFile(filePath);
    const dataUrl = `data:${previewMimeType(filePath)};base64,${data.toString('base64')}`;
    candidates.set(relative.toLowerCase(), dataUrl);
    if (!candidates.has(basename)) candidates.set(basename, dataUrl);
  }

  function resolveAsset(raw) {
    const value = String(raw || '').trim();
    if (!value || /^(?:https?:|mailto:|data:|cid:|#)/i.test(value)) return value;
    const clean = value.split(/[?#]/, 1)[0].replaceAll('\\','/');
    let decoded = clean;
    try { decoded = decodeURIComponent(clean); } catch {}
    const normalized = decoded.replace(/^\.\//,'').toLowerCase();
    return candidates.get(normalized)
      || candidates.get(path.posix.basename(normalized))
      || value;
  }

  result = result.replace(
    /\b(src|background)=(["'])([^"']+)\2/gi,
    (_match, attr, quote, value) => `${attr}=${quote}${resolveAsset(value)}${quote}`,
  );
  result = result.replace(
    /url\((["']?)([^)"']+)\1\)/gi,
    (_match, quote, value) => `url(${quote}${resolveAsset(value)}${quote})`,
  );
  return result;
}

function getPreviewResolvedVariables(plan, user, signatureKey) {
  const profile = plan.profile;
  const signature = profile.signatures?.[signatureKey] || {};
  const raw = user.raw || {};
  const mail = String(findValueByAliases(raw, 'mail', plan.aliasMap) || user.mail || '');
  const emailDomain = mail.includes('@') ? mail.split('@', 2)[1] : signatureKey;
  return (profile.variables?.variables || []).map((variable) => {
    const id = String(variable?.id || '').trim();
    const placeholders = Array.isArray(variable?.placeholders) && variable.placeholders.length
      ? variable.placeholders
      : (id ? [`${id}`] : []);
    const attributes = Array.isArray(variable?.adProperties) && variable.adProperties.length
      ? variable.adProperties
      : (id ? [id] : []);

    let value = '';
    let source = attributes[0] || id;
    if (placeholders.some((placeholder) => String(placeholder).toLowerCase() === '$domain')) {
      value = emailDomain;
      source = 'derived from mail';
    } else if (placeholders.some((placeholder) => String(placeholder).toLowerCase() === '$description')) {
      const customAttr = String(signature.customTitleAttr || '').trim();
      let baseValue = customAttr
        ? getRawValue(raw, customAttr)
        : findValueByAliases(raw, attributes[0] || id, plan.aliasMap);
      if (Array.isArray(baseValue)) baseValue = baseValue.find(Boolean) || '';
      const additional = (profile.secondaryTitleAttributes || [])
        .map((attribute) => getRawValue(raw, attribute))
        .flatMap((item) => Array.isArray(item) ? item : [item])
        .map((item) => String(item || '').trim())
        .filter(Boolean);
      const base = String(baseValue || '').trim();
      value = [base, ...additional].filter(Boolean).join(' / ');
      source = customAttr || attributes.join(' → ') || id;
    } else {
      for (const attribute of attributes) {
        const found = findValueByAliases(raw, attribute, plan.aliasMap);
        const normalized = Array.isArray(found) ? found.find(Boolean) : found;
        if (normalized !== undefined && normalized !== null && String(normalized).trim() !== '') {
          value = String(normalized);
          source = attribute;
          break;
        }
      }
    }

    return {
      id,
      displayName: String(variable?.displayName || id || placeholders[0] || '').trim(),
      placeholders,
      source,
      value: String(value || ''),
      required: Boolean(variable?.required),
    };
  });
}

function collectUnresolvedPreviewPlaceholders(html, text) {
  return uniqueCaseInsensitive([
    ...String(html || '').matchAll(/\$[A-Za-z_][A-Za-z0-9_]*/g),
    ...String(text || '').matchAll(/\$[A-Za-z_][A-Za-z0-9_]*/g),
  ].map((match) => match[0]));
}

async function handleV2RunPreview(req, res) {
  let runFilePath = '';
  let runConfigPath = '';
  let runVariablesPath = '';
  let previewRoot = '';
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'Preview expects application/json.' });
    }
    const body = await parseJsonBody(req);
    const userIdentifier = String(body?.user || '').trim();
    const signatureKey = String(body?.signature || '').trim();
    if (!userIdentifier || !signatureKey) {
      return sendJson(res, 400, { error: 'Preview requires user and signature.' });
    }

    const signatureSelection = { [userIdentifier]: [signatureKey] };
    const plan = await buildV2RunPlan({
      users: [userIdentifier],
      target: 'Local',
      signatureSelection,
    });
    if (!plan.ok || plan.users.length !== 1) {
      return sendJson(res, 422, {
        error: 'Preview preflight failed.',
        plan: toPublicV2RunPlan(plan),
      });
    }

    const user = plan.users[0];
    const selectedSignature = user.domains.find(
      (domain) => String(domain).toLowerCase() === signatureKey.toLowerCase(),
    );
    if (!selectedSignature) {
      return sendJson(res, 422, { error: 'Selected signature is not assigned to this user.' });
    }

    const preferredHeaders = uniqueCaseInsensitive([
      ...buildPreferredHeaders(plan.mappedAttributes),
      ...plan.configAdProperties,
      'userPrincipalName',
      'Domains',
      'Enabled',
    ]);
    const row = {};
    preferredHeaders.forEach((header) => {
      if (header.toLowerCase() === 'domains') {
        row[header] = selectedSignature;
      } else if (header.toLowerCase() === 'enabled') {
        row[header] = 'True';
      } else {
        const value = findValueByAliases(user.raw, header, plan.aliasMap);
        row[header] = Array.isArray(value) ? value.join(';') : value;
      }
    });

    const runDir = path.join(ROOT_DIR, 'config', '.runs');
    await fs.promises.mkdir(runDir, { recursive: true });
    const runId = `preview-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
    runFilePath = path.join(runDir, `${runId}.csv`);
    runConfigPath = path.join(runDir, `${runId}-config.json`);
    runVariablesPath = path.join(runDir, `${runId}-variables.json`);
    previewRoot = path.join(runDir, `${runId}-output`);

    await fs.promises.mkdir(previewRoot, { recursive: true });
    await fs.promises.writeFile(runFilePath, convertObjectsToCsv([row], preferredHeaders), 'utf8');
    await fs.promises.writeFile(
      runConfigPath,
      `${JSON.stringify(profileToLegacyConfig(plan.profile), null, 2)}\n`,
      'utf8',
    );
    await fs.promises.writeFile(
      runVariablesPath,
      `${JSON.stringify(plan.profile.variables, null, 2)}\n`,
      'utf8',
    );

    await queueGenerateScript({
      userFilePath: runFilePath,
      mode: 'userFile',
      deploymentMode: 'Local',
      useOutlookFolder: false,
      useTestTemplates: false,
      validateOnly: false,
      skipAcls: true,
      respectUserDomains: true,
      configFilePath: runConfigPath,
      variablesFilePath: runVariablesPath,
      localDeploymentPath: previewRoot,
      networkDeploymentPath: plan.profile.targets.production.path,
      previewOnly: true,
      allowGlobalTestTemplates: false,
    });

    const signatureDir = path.join(previewRoot, user.id);
    const entries = await fs.promises.readdir(signatureDir, { withFileTypes: true });
    const htmlEntry = entries.find((entry) => entry.isFile() && /\.html?$/i.test(entry.name));
    const txtEntry = entries.find((entry) => entry.isFile() && /\.txt$/i.test(entry.name));
    if (!htmlEntry || !txtEntry) {
      return sendJson(res, 500, { error: 'Preview generation completed but rendered HTML/TXT files were not found.' });
    }

    const rawHtml = decodeWindows1252(await fs.promises.readFile(path.join(signatureDir, htmlEntry.name)));
    const rawText = decodeWindows1252(await fs.promises.readFile(path.join(signatureDir, txtEntry.name)));
    const html = await inlinePreviewAssets(rawHtml, signatureDir);
    const unresolvedPlaceholders = collectUnresolvedPreviewPlaceholders(rawHtml, rawText);

    return sendJson(res, 200, {
      user: {
        id: user.id,
        displayName: user.displayName,
        mail: user.mail,
      },
      signature: {
        key: selectedSignature,
        label: getV2SignatureLabel(plan.profile, selectedSignature),
        displayLabel: `${selectedSignature} (${getV2SignatureLabel(plan.profile, selectedSignature)})`,
      },
      html,
      text: rawText,
      resolvedVariables: getPreviewResolvedVariables(plan, user, selectedSignature),
      unresolvedPlaceholders,
      generatedFiles: {
        html: htmlEntry.name,
        text: txtEntry.name,
      },
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error.message,
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    });
  } finally {
    [runFilePath, runConfigPath, runVariablesPath].filter(Boolean).forEach((filePath) => {
      fs.promises.rm(filePath, { force: true }).catch(() => {});
    });
    if (previewRoot) {
      fs.promises.rm(previewRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function handleV2RunGenerate(req, res) {
  let runFilePath = '';
  let runConfigPath = '';
  let runVariablesPath = '';
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'Generation expects application/json.' });
    }
    const body = await parseJsonBody(req);
    const plan = await buildV2RunPlan(body);
    if (!plan.ok) {
      return sendJson(res, 422, {
        error: 'Preflight failed. Nothing was generated.',
        plan: toPublicV2RunPlan(plan),
      });
    }

    const preferredHeaders = uniqueCaseInsensitive([
      ...buildPreferredHeaders(plan.mappedAttributes),
      ...plan.configAdProperties,
      'userPrincipalName',
      'Domains',
      'Enabled',
    ]);
    const rows = plan.users.map((user) => {
      const row = {};
      preferredHeaders.forEach((header) => {
        if (header.toLowerCase() === 'domains') {
          row[header] = user.domains.join(';');
        } else if (header.toLowerCase() === 'enabled') {
          row[header] = 'True';
        } else {
          const value = findValueByAliases(user.raw, header, plan.aliasMap);
          row[header] = Array.isArray(value) ? value.join(';') : value;
        }
      });
      return row;
    });

    const runDir = path.join(ROOT_DIR, 'config', '.runs');
    await fs.promises.mkdir(runDir, { recursive: true });
    const runId = Date.now();
    runFilePath = path.join(runDir, `run-${runId}.csv`);
    runConfigPath = path.join(runDir, `config-${runId}.json`);
    runVariablesPath = path.join(runDir, `variables-${runId}.json`);
    await fs.promises.writeFile(runFilePath, convertObjectsToCsv(rows, preferredHeaders), 'utf8');
    await fs.promises.writeFile(
      runConfigPath,
      `${JSON.stringify(profileToLegacyConfig(plan.profile), null, 2)}\n`,
      'utf8',
    );
    await fs.promises.writeFile(
      runVariablesPath,
      `${JSON.stringify(plan.profile.variables, null, 2)}\n`,
      'utf8',
    );

    const scriptResult = await queueGenerateScript({
      userFilePath: runFilePath,
      mode: 'userFile',
      deploymentMode: plan.target.key,
      useOutlookFolder: false,
      useTestTemplates: false,
      validateOnly: false,
      skipAcls: plan.target.skipAcls,
      respectUserDomains: true,
      configFilePath: runConfigPath,
      variablesFilePath: runVariablesPath,
      localDeploymentPath: plan.profile.targets.preview.path,
      networkDeploymentPath: plan.profile.targets.production.path,
      allowGlobalTestTemplates: false,
    });

    return sendJson(res, 200, {
      message: 'Signature generation completed.',
      plan: toPublicV2RunPlan(plan),
      script: scriptResult,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error.message,
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    });
  } finally {
    [runFilePath, runConfigPath, runVariablesPath].filter(Boolean).forEach((filePath) => {
      fs.promises.rm(filePath, { force: true }).catch(() => {});
    });
  }
}

function classifyAdQueryFailure(error) {
  const text = String(error?.stderr || error?.message || '');
  if (/Cannot find an object with identity|Directory object not found|directory object.*not found|ADIdentityNotFoundException/i.test(text)) {
    return { code: 'AD_SEARCH_BASE_INVALID', message: 'AD-Suchbasis nicht gefunden.',
      hint: 'OU_SEARCH_BASE muss ein existierender Distinguished Name sein. Standard-Users-Container ist CN=Users, nicht OU=Users.' };
  }
  if (/access is denied|insufficient access|unwilling to perform|unauthorized|Logon failure|user name or password is incorrect/i.test(text)) {
    return { code: 'AD_QUERY_ACCESS_DENIED', message: 'AD-Abfrage nicht autorisiert.',
      hint: 'SYSTEM nutzt beim Domänenbeitritt das Computerkonto. Optional AD_QUERY_USERNAME/AD_QUERY_PASSWORD eines reinen AD-Lesekontos in .env setzen (kein Domain Admin).' };
  }
  if (/ActiveDirectory module|specified module.*not loaded|cannot be loaded|module.*ActiveDirectory/i.test(text)) {
    return { code: 'AD_MODULE_MISSING', message: 'PowerShell-Modul ActiveDirectory fehlt.',
      hint: 'RSAT-AD-PowerShell auf dem Signaturee-Server installieren.' };
  }
  if (/not.*operational|cannot contact|server.*unavailable|cannot find.*server|0x8007203a/i.test(text)) {
    return { code: 'AD_SERVER_UNAVAILABLE', message: 'Domänencontroller nicht erreichbar.',
      hint: 'AD_SERVER, DNS, Netzwerk, Domain-Join und Kerberos prüfen.' };
  }
  return { code: 'AD_QUERY_FAILED', message: 'Get-ADUser konnte die konfigurierte Suchbasis nicht abfragen.',
    hint: 'AD_SERVER und OU_SEARCH_BASE prüfen und Get-ADUser aus dem Backend-Dienstkontext testen.' };
}

async function handleV2AdSearchTest(_req, res) {
  const profile = getV2Profile();
  const server = profile.directory.server;
  const searchBase = profile.directory.searchBase;
  const authMode = AD_QUERY_USERNAME ? 'dedicated-read-account' : 'scheduled-task-identity';
  try {
    const result = await queryAdUsers({
      limit: 1,
      search: '',
      searchBase,
      server,
      adProperties: [],
      allowDefaultFallback: false,
    });
    return sendJson(res, 200, {
      ok: true, code: 'AD_QUERY_OK',
      message: result.users.length ? 'AD-Abfrage erfolgreich; aktiver Benutzer gefunden.' :
        'AD-Abfrage erfolgreich; keine aktiven Benutzer in der Suchbasis gefunden.',
      server, searchBase, authMode,
      foundActiveUser: result.users.length > 0,
    });
  } catch (error) {
    return sendJson(res, 200, {
      ok: false, ...classifyAdQueryFailure(error), server, searchBase, authMode,
    });
  }
}

async function handleAdUserList(req, res) {
  try {
    const profile = getV2Profile();
    const profileMappings = buildVariableMappingsFromSchema(profile.variables);
    const adProperties = profileMappings.adProperties;
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const limitParam = Number(requestUrl.searchParams.get('limit'));
    const server = requestUrl.searchParams.get('server') || profile.directory.server || '';
    const search = (requestUrl.searchParams.get('search') || '').trim();
    const searchBase = requestUrl.searchParams.get('searchBase') || profile.directory.searchBase || '';
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 200;
    const { users, rawUsers, skippedProperties } = await queryAdUsers({
      limit,
      search,
      searchBase,
      server,
      adProperties: uniqueCaseInsensitive([...(adProperties || []), 'memberOf']),
      allowDefaultFallback: false,
    });
    const config = profileToLegacyConfig(profile);
    const enrichedUsers = users.map((user, index) => {
      const domains = resolveDomainsFromMemberOf(getRawValue(rawUsers?.[index] || {}, 'memberOf'), config);
      return {
        ...user,
        availableDomains: domains,
        domains,
      };
    });
    const payload = {
      users: enrichedUsers,
      signatureCatalog: getV2SignatureCatalog(profile),
      source: { type: 'ad', server, searchBase, limit, profile: 'v2' },
    };
    if (skippedProperties && skippedProperties.length) payload.skippedProperties = skippedProperties;
    return sendJson(res, 200, payload);
  } catch (error) {
    const status = error.status || 500;
    return sendJson(res, status, {
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
      attemptedPowerShellCommands: error.attemptedPowerShellCommands,
      skippedProperties: error.skippedProperties,
    });
  }
}

async function handleAdImport(req, res) {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'AD import expects application/json' });
    }
    const body = await parseJsonBody(req);
    const limit = body.limit || 200;
    const search = (body.search || '').trim();
    const searchBase = body.searchBase || '';
    const server = body.server || '';
    const credentials = normalizeAdCredentials(body.credentials);
    if (!credentials) {
      return sendJson(res, 400, { error: 'AD credentials required. Provide username and password.' });
    }

    const { attributes: mappedAttributes, adProperties, schema } = await loadVariableMappings();
    const aliasMap = buildAttributeAliasMap(schema);
    const { users, rawUsers, skippedProperties } = await queryAdUsers({
      limit,
      search,
      searchBase,
      server,
      adProperties,
      credentials,
    });

    const toPersist = rawUsers && rawUsers.length ? rawUsers : users;
    if (!toPersist.length) {
      return sendJson(res, 200, { message: 'Keine AD-Benutzer gefunden.', count: 0 });
    }

    const requiredColumns = uniqueCaseInsensitive([
      ...mappedAttributes,
      'sAMAccountName',
      'mail',
      'givenName',
      'sn',
    ]);

    const normalized = toPersist.map((u) => {
      const row = {};
      requiredColumns.forEach((col) => {
        row[col] = findValueByAliases(u, col, aliasMap);
      });
      return row;
    });

    const preferredHeaders = buildPreferredHeaders(mappedAttributes);
    const csv = convertObjectsToCsv(normalized, preferredHeaders);

    await persistUsersCsv(csv);

    const payload = {
      message: 'AD-Benutzer gespeichert.',
      count: toPersist.length,
      path: USER_FILE_PATH,
      source: { type: 'ad', server: server || AD_SERVER || '', searchBase: searchBase || getOuSearchBase(), limit },
    };
    if (skippedProperties && skippedProperties.length) payload.skippedProperties = skippedProperties;
    return sendJson(res, 200, payload);
  } catch (error) {
    const status = error.status || 500;
    return sendJson(res, status, {
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
      attemptedPowerShellCommands: error.attemptedPowerShellCommands,
      skippedProperties: error.skippedProperties,
    });
  }
}

async function handleUserExport(_req, res) {
  try {
    const { users } = await readUserEntries();
    const { attributes: mappedAttributes } = await loadVariableMappings();
    const preferredHeaders = buildPreferredHeaders(mappedAttributes);
    await persistUsersCsv(convertObjectsToCsv(users, preferredHeaders));
    const stream = fs.createReadStream(USER_FILE_PATH);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${path.basename(MERGED_USER_FILE_PATH)}"`,
    });
    stream.pipe(res);
    stream.on('error', (error) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: error.message });
      } else {
        res.destroy(error);
      }
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleDomainList(_req, res) {
  try {
    const data = loadConfigJson();
    if (!data || !Object.keys(data).length) {
      return sendJson(res, 404, { error: 'Configuration not found' });
    }
    const domains = data.domains || {};
    const keys = Object.keys(domains);

    return sendJson(res, 200, {
      domains: keys.map((key) => ({
        key,
        templateHtml: domains[key].templateHtml,
        templateTxt: domains[key].templateTxt,
        resourceFolder: domains[key].resourceFolder,
      })),
      configPath: CONFIG_PATH,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleDomainPresetList(_req, res) {
  try {
    importPresetDirectoryToDb(PRESET_TYPES.domain, DOMAIN_PRESET_DIR);
    const dbPresets = dbListPresetNames(PRESET_TYPES.domain);
    if (dbPresets.length) {
      return sendJson(res, 200, { presets: dbPresets });
    }
    await ensureDirExists(DOMAIN_PRESET_DIR);
    const entries = await fs.promises.readdir(DOMAIN_PRESET_DIR, { withFileTypes: true });
    const presets = entries
      .filter((ent) => ent.isFile() && ent.name.toLowerCase().endsWith('.json'))
      .map((ent) => path.basename(ent.name, '.json'));
    return sendJson(res, 200, { presets });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleDomainPresetLoad(req, res, name) {
  try {
    const safe = (name || '').trim();
    if (!safe || !/^[a-zA-Z0-9._-]+$/.test(safe)) {
      return sendJson(res, 400, { error: 'Ungültiger Preset-Name' });
    }
    importPresetDirectoryToDb(PRESET_TYPES.domain, DOMAIN_PRESET_DIR);
    const storedConfig = dbGetPreset(PRESET_TYPES.domain, safe);
    if (storedConfig && typeof storedConfig === 'object') {
      lastDomainPresetLoad = new Date().toISOString();
      return sendJson(res, 200, { name: safe, config: storedConfig, storage: 'db', path: DB_PATH });
    }

    const filePath = path.join(DOMAIN_PRESET_DIR, `${safe}.json`);
    if (!fs.existsSync(filePath)) {
      return sendJson(res, 404, { error: 'Preset nicht gefunden' });
    }
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const config = JSON.parse(raw);
    dbSavePreset(PRESET_TYPES.domain, safe, config);
    lastDomainPresetLoad = new Date().toISOString();
    return sendJson(res, 200, { name: safe, config, storage: 'file', path: filePath });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleDomainPresetSave(req, res) {
  try {
    if (CONFIG_MODE === 'env') {
      return sendJson(res, 409, { error: 'Business configuration is managed by .env; legacy API writes are disabled.' });
    }
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'application/json erwartet' });
    }
    const body = await parseJsonBody(req);
    const name = (body.name || '').trim();
    const config = body.config;
    if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
      return sendJson(res, 400, { error: 'Ungültiger Preset-Name (nur a-z, A-Z, 0-9, . _ -)' });
    }
    if (!config || typeof config !== 'object') {
      return sendJson(res, 400, { error: 'Preset-Konfiguration fehlt' });
    }
    const filePath = path.join(DOMAIN_PRESET_DIR, `${name}.json`);
    await ensureDirExists(DOMAIN_PRESET_DIR);
    dbSavePreset(PRESET_TYPES.domain, name, config);
    await fs.promises.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    lastDomainPresetSave = new Date().toISOString();
    return sendJson(res, 200, { message: 'Preset gespeichert', name });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleStorageBackup(_req, res) {
  try {
    const payload = buildStorageBackupPayload();
    const filename = `signaturee-settings-${toBackupTimestampLabel(payload.createdAt)}.json`;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.end(`${JSON.stringify(payload, null, 2)}\n`);
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

async function handleStorageRestore(req, res, requestUrl) {
  try {
    if (CONFIG_MODE === 'env') {
      return sendJson(res, 409, { error: 'Business configuration is managed by .env; legacy API writes are disabled.' });
    }
    const contentType = req.headers['content-type'] || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await parseJsonBody(req);
    } else if (contentType.includes('multipart/form-data')) {
      const { files, fields } = await parseMultipart(req);
      if (files.length) {
        data = JSON.parse(files[0].data.toString('utf8'));
      } else if (fields.backup) {
        data = JSON.parse(fields.backup);
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const fields = await parseUrlEncodedBody(req);
      if (fields.backup) data = JSON.parse(fields.backup);
    } else {
      return sendJson(res, 415, { error: 'Restore expects application/json or multipart/form-data.' });
    }

    if (!data || !isPlainObject(data)) {
      return sendJson(res, 400, { error: 'No valid backup payload received.' });
    }

    const payload = isPlainObject(data.backup) ? data.backup : data;
    const replaceFromBody = data.replacePresets;
    const replaceFromQuery = requestUrl?.searchParams?.get('replacePresets');
    let replacePresets = true;
    if (replaceFromBody !== undefined) {
      replacePresets = parseBooleanFlag(replaceFromBody);
    } else if (replaceFromQuery !== null && replaceFromQuery !== undefined) {
      replacePresets = parseBooleanFlag(replaceFromQuery);
    }

    const normalized = normalizeStorageBackupPayload(payload);
    if (normalized.errors.length) {
      return sendJson(res, 400, { error: 'Invalid backup payload.', details: normalized.errors });
    }

    const result = await restoreStorageFromBackup(normalized.backup, { replacePresets });
    return sendJson(res, 200, {
      message: 'Settings restored from backup.',
      dbPath: DB_PATH,
      result,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

function handleMeta(_req, res) {
  const varsMtime = dbGetKeyUpdatedAt(STORE_KEYS.variables) || getIsoMtimeSafe(VARIABLES_JSON_PATH);
  const configMtime = dbGetKeyUpdatedAt(STORE_KEYS.config) || getIsoMtimeSafe(CONFIG_PATH);
  const varPresetMtime = dbGetLatestUpdate(PRESET_TYPES.variable) || getNewestPresetMtime(VARIABLE_PRESET_DIR);
  const domainPresetMtime = dbGetLatestUpdate(PRESET_TYPES.domain) || getNewestPresetMtime(DOMAIN_PRESET_DIR);
  return sendJson(res, 200, {
    localDeploymentPath: LOCAL_DEPLOYMENT_PATH,
    networkDeploymentPath: NETWORK_DEPLOYMENT_PATH,
    adServer: AD_SERVER || '',
    ouSearchBase: getOuSearchBase() || '',
    variablesPath: VARIABLES_JSON_PATH,
    configPath: CONFIG_PATH,
    dbPath: DB_PATH,
    templateDirectory: TEMPLATE_DIRECTORY,
    templateMode: USE_TEST_TEMPLATES ? 'test' : 'production',
    domainPresetDir: DOMAIN_PRESET_DIR,
    variablePresetDir: VARIABLE_PRESET_DIR,
    logDir: LOG_DIR,
    timestamps: {
      variablesSavedAt: lastVariableSchemaSave || varsMtime,
      variablePresetSavedAt: lastVariablePresetSave || varPresetMtime,
      variablePresetLoadedAt: lastVariablePresetLoad || varPresetMtime,
      domainPresetSavedAt: lastDomainPresetSave || domainPresetMtime,
      domainPresetLoadedAt: lastDomainPresetLoad || domainPresetMtime,
      domainConfigSavedAt: lastDomainConfigSave || configMtime,
    },
  });
}

function handleLatestLog(_req, res, requestUrl) {
  const latest = getLatestLogFile();
  if (!latest) return sendJson(res, 404, { error: 'No log files found' });

  const paramBytes = Number(requestUrl?.searchParams?.get('tailBytes') || requestUrl?.searchParams?.get('bytes'));
  const tailBytes = Number.isFinite(paramBytes) && paramBytes > 0
    ? Math.min(paramBytes, 20000)
    : LOG_TAIL_BYTES;

  try {
    const tail = readLogTail(latest.fullPath, tailBytes);
    return sendJson(res, 200, {
      filename: latest.name,
      size: tail.size,
      modified: tail.modified,
      tailStart: tail.start,
      tailBytes: tail.bytesRead,
      tail: tail.data,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

function handleLogDownload(_req, res, requestUrl) {
  const requestedName = requestUrl?.searchParams?.get('name');
  const latest = getLatestLogFile();
  const logName = requestedName ? path.basename(requestedName) : latest?.name;
  if (!logName) {
    return sendJson(res, 404, { error: 'No log files found' });
  }

  const resolvedDir = path.resolve(LOG_DIR);
  const targetPath = path.resolve(LOG_DIR, logName);
  if (!targetPath.startsWith(resolvedDir)) {
    return sendJson(res, 400, { error: 'Invalid log name' });
  }

  try {
    const stats = fs.statSync(targetPath);
    if (!stats.isFile()) {
      return sendJson(res, 404, { error: 'Log file not found' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${logName}"`,
      'Content-Length': stats.size,
    });
    const stream = fs.createReadStream(targetPath);
    stream.on('error', (error) => {
      console.warn('Error streaming log file:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Failed to read log file' }));
    });
    stream.pipe(res);
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

function handleHealth(_req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'signaturee-backend',
    apiVersion: 2,
    authRequired: AUTH_REQUIRED,
    // Random, non-secret instance nonce: allows the UI to confirm that an
    // actual new backend process started after Scheduled Task restart.
    instanceId: BACKEND_INSTANCE_ID,
  }));
}

async function handleRunnerStatus(_req, res) {
  try {
    const snapshot = await buildRunnerStatusSnapshot();
    return sendJson(res, 200, snapshot);
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error.message,
      code: error.code,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      powershellCommand: error.powershellCommand || '',
      attemptedPowerShellCommands: error.attemptedPowerShellCommands || [],
    });
  }
}

async function handleRunnerControl(req, res) {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'Runner control expects application/json.' });
    }
    const body = await parseJsonBody(req);
    const action = normalizeRunnerAction(body?.action);
    const scope = normalizeRunnerScope(body?.scope);
    if (!action) {
      return sendJson(res, 400, { error: 'Invalid action. Use start, stop, or restart.' });
    }

    if (scope) {
      const execution = await executeScopedRunnerAction(scope, action);
      if (scope === 'backend') {
        return sendJson(res, 202, {
          message: 'Backend restart queued. The UI will reconnect automatically.',
          execution,
        });
      }
      const snapshot = await buildRunnerStatusSnapshot();
      return sendJson(res, 200, {
        message: `${scope} ${action} completed.`,
        execution,
        status: snapshot,
      });
    }

    // Backward-compatible all-runner action for existing API clients.
    const execution = await executeRunnerAction(action);
    const snapshot = await buildRunnerStatusSnapshot();
    return sendJson(res, 200, {
      message: `Runner action '${action}' executed.`,
      execution,
      status: snapshot,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error.message,
      code: error.code,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      powershellCommand: error.powershellCommand || '',
      attemptedPowerShellCommands: error.attemptedPowerShellCommands || [],
    });
  }
}

async function handleAuthLogin(req, res) {
  try {
    if (!AUTH_REQUIRED) {
      return sendJson(res, 400, { error: 'Authentication is disabled on backend.' });
    }
    if (!AUTH_DB_LOGIN_ENABLED && !AUTH_LDAP_ENABLED) {
      return sendJson(res, 503, { error: 'Login is disabled. Enable AUTH_DB_LOGIN_ENABLED and/or AUTH_LDAP_ENABLED.' });
    }
    if (AUTH_DB_LOGIN_ENABLED && !authDb && !AUTH_LDAP_ENABLED) {
      return sendJson(res, 503, { error: 'Auth database unavailable.' });
    }
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { error: 'Login expects application/json.' });
    }
    const body = await parseJsonBody(req);
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    // Explicit provider selection resolves collisions between local accounts and AD users.
    // Unspecified source preserves the previous local-first behavior for API clients.
    const requestedSource = String(body?.source || 'auto').trim().toLowerCase();
    const selectedSource = requestedSource === 'local' ? 'db' : requestedSource;
    if (!['auto', 'db', 'ldap'].includes(selectedSource)) {
      return sendJson(res, 400, { error: 'Invalid login source. Choose auto, local or ldap.' });
    }
    if (!username || !password) {
      return sendJson(res, 400, { error: 'Username and password are required.' });
    }
    if (selectedSource === 'ldap' && !AUTH_LDAP_ENABLED) {
      return sendJson(res, 503, { error: 'LDAP login is disabled. Select local login or contact IT.' });
    }
    if (selectedSource === 'db' && !AUTH_DB_LOGIN_ENABLED) {
      return sendJson(res, 503, { error: 'Local login is disabled.' });
    }

    let loginSource = '';
    let loginRole = '';
    let loginUsername = '';
    let ldapAttempt = null;

    // Local admin usernames retain priority for legacy/auto clients. An explicit
    // LDAP choice never authenticates against the local DB, even for a collision.
    const localAuthUser = selectedSource !== 'ldap' && AUTH_DB_LOGIN_ENABLED && authDb
      ? getAuthUserByUsername(username)
      : null;

    if (localAuthUser) {
      if (!localAuthUser.enabled || !verifyAuthPassword(password, localAuthUser.passwordHash)) {
        return sendJson(res, 401, { error: 'Invalid username or password.' });
      }
      loginSource = 'db';
      loginRole = localAuthUser.role;
      loginUsername = localAuthUser.username;
    } else if (selectedSource === 'db') {
      return sendJson(res, 401, { error: 'Invalid username or password.' });
    } else if (AUTH_LDAP_ENABLED) {
      try {
        ldapAttempt = await authenticateLdapUser({ username, password });
      } catch (error) {
        console.warn(`LDAP authentication unavailable: ${error.message}`);
        return sendJson(res, getErrorStatus(error, 503), { error: 'LDAP authentication unavailable.' });
      }
      if (ldapAttempt?.authenticated) {
        loginSource = 'ldap';
        loginRole = ldapAttempt.role;
        loginUsername = ldapAttempt.username || username;
      }
    }

    if (!loginRole) {
      // An account missing from the configured AD container is a 401, not a
      // directory outage (503). Detailed reasons remain admin-only.
      const userNotFound = /DIRECTORY_USER_NOT_FOUND|AUTHENTICATED_USER_NOT_FOUND/i.test(String(ldapAttempt?.stderr || ''));
      const ldapServiceIssue = Boolean(ldapAttempt?.attempted && !ldapAttempt.invalidCredentials && !userNotFound && ldapAttempt.stderr);
      if (ldapServiceIssue) {
        console.warn(`LDAP authentication failed: ${ldapAttempt.stderr}`);
        return sendJson(res, 503, { error: 'LDAP authentication unavailable.' });
      }
      return sendJson(res, 401, { error: 'Invalid username or password.' });
    }

    const session = issueAuthSessionToken({ role: loginRole, username: loginUsername, source: loginSource });
    return sendJson(res, 200, {
      message: 'Login successful.',
      tokenType: 'Bearer',
      token: session.token,
      role: loginRole,
      username: loginUsername,
      source: loginSource || 'session',
      expiresAt: new Date(session.expiresAt).toISOString(),
      authRequired: AUTH_REQUIRED,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), { error: error.message });
  }
}

function handleAuthMe(req, res) {
  const auth = resolveRequestAuth(req);
  if (!AUTH_REQUIRED) {
    return sendJson(res, 200, {
      authRequired: false,
      authenticated: false,
      role: 'admin',
      username: '',
      source: 'disabled',
    });
  }
  if (!auth.role) {
    return sendJson(res, 200, {
      authRequired: true,
      authenticated: false,
      role: '',
      username: '',
      source: '',
    });
  }
  return sendJson(res, 200, {
    authRequired: true,
    authenticated: true,
    role: auth.role,
    username: auth.username || '',
    source: auth.source,
    expiresAt: auth.expiresAt ? new Date(auth.expiresAt).toISOString() : null,
  });
}

function handleAuthLogout(req, res) {
  const auth = resolveRequestAuth(req);
  if (auth.token && authSessions.has(auth.token)) {
    authSessions.delete(auth.token);
  }
  return sendJson(res, 200, { message: 'Logged out.' });
}

function routeRequest(req, res) {
  initializeStorage();
  if (!setCors(req, res)) {
    return sendJson(res, 403, { error: 'Origin not allowed by CORS policy.' });
  }
  req.setTimeout(REQUEST_TIMEOUT_MS, () => {
    if (!res.headersSent) {
      sendJson(res, 408, { error: 'Request timeout.' });
    }
    req.destroy();
  });
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;
  if (!pathname.startsWith(BASE_PATH)) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  const relativePath = pathname.slice(BASE_PATH === '/' ? 0 : BASE_PATH.length) || '/';
  const ensure = (role) => requireRole(req, res, role);
  const ensureAny = (roles) => requireAnyRole(req, res, roles);

  if (relativePath === '/health' && req.method === 'GET') return handleHealth(req, res);
  if (relativePath === '/api/auth/login' && req.method === 'POST') return handleAuthLogin(req, res);
  if (relativePath === '/api/auth/me' && req.method === 'GET') return handleAuthMe(req, res);
  if (relativePath === '/api/auth/logout' && req.method === 'POST') return handleAuthLogout(req, res);
  if (relativePath === '/api/v2/ad/test' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleV2AdSearchTest(req, res);
  }
  if (relativePath === '/api/v2/auth/ldap/test' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleV2LdapTest(req, res);
  }
  if (relativePath === '/api/v2/auth/users' && req.method === 'GET') {
    if (!ensure('admin')) return;
    return handleV2AuthUsersList(req, res);
  }
  if (relativePath === '/api/v2/auth/users' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleV2AuthUserCreate(req, res);
  }
  if (relativePath.startsWith('/api/v2/auth/users/') && req.method === 'PATCH') {
    if (!ensure('admin')) return;
    return handleV2AuthUserUpdate(req, res, relativePath.slice('/api/v2/auth/users/'.length));
  }
  if (relativePath.startsWith('/api/v2/auth/users/') && req.method === 'DELETE') {
    if (!ensure('admin')) return;
    return handleV2AuthUserDelete(req, res, relativePath.slice('/api/v2/auth/users/'.length));
  }
  if (relativePath === '/api/runner/status' && req.method === 'GET') {
    if (!ensure('admin')) return;
    return handleRunnerStatus(req, res);
  }
  if (relativePath === '/api/runner/control' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleRunnerControl(req, res);
  }
  if (relativePath === '/api/self/bootstrap' && req.method === 'GET') {
    if (!ensureAny(['selfservice', 'it', 'operator', 'user', 'admin'])) return;
    return handleSelfBootstrap(req, res);
  }
  if (relativePath === '/api/self/signature/download' && req.method === 'GET') {
    if (!ensureAny(['selfservice', 'it', 'operator', 'user', 'admin'])) return;
    return handleSelfSignatureDownload(req, res);
  }
  if (relativePath === '/api/users/import' && req.method === 'POST') {
    if (!ensure('user')) return;
    return handleUserImport(req, res, false);
  }
  if (relativePath === '/api/users/import-single' && req.method === 'POST') {
    if (!ensure('user')) return;
    return handleUserImport(req, res, true);
  }
  if (relativePath === '/api/users/export' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleUserExport(req, res);
  }
  if (relativePath === '/api/users/list' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleUserList(req, res);
  }
  if (relativePath === '/api/users/ad' && req.method === 'GET') {
    if (!ensure('user')) return;
    return handleAdUserList(req, res);
  }
  if (relativePath === '/api/users/ad-import' && req.method === 'POST') {
    if (!ensure('user')) return;
    return handleAdImport(req, res);
  }
  if (relativePath === '/api/templates/import' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleTemplateImport(req, res);
  }
  if (relativePath === '/api/templates/export' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleTemplateExport(req, res);
  }
  if (relativePath === '/api/domains/import' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleDomainImport(req, res);
  }
  if (relativePath === '/api/domains/export' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleDomainExport(req, res);
  }
  if (relativePath === '/api/domains/list' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleDomainList(req, res);
  }
  if (relativePath === '/api/domains/presets' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleDomainPresetList(req, res);
  }
  if (relativePath === '/api/domains/presets' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleDomainPresetSave(req, res);
  }
  if (relativePath.startsWith('/api/domains/presets/') && req.method === 'GET') {
    if (!ensure('viewer')) return;
    const name = relativePath.replace('/api/domains/presets/', '');
    return handleDomainPresetLoad(req, res, name);
  }
  if (relativePath === '/api/variables' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleVariablesGet(req, res);
  }
  if (relativePath === '/api/variables' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleVariables(req, res);
  }
  if (relativePath === '/api/variables/catalog' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleVariableCatalog(req, res);
  }
  if (relativePath === '/api/variables/presets' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleVariablePresetList(req, res);
  }
  if (relativePath === '/api/variables/presets' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleVariablePresetSave(req, res);
  }
  if (relativePath.startsWith('/api/variables/presets/') && req.method === 'GET') {
    if (!ensure('viewer')) return;
    const name = relativePath.replace('/api/variables/presets/', '');
    return handleVariablePresetLoad(req, res, name);
  }
  if (relativePath === '/api/storage/backup' && req.method === 'GET') {
    if (!ensure('admin')) return;
    return handleStorageBackup(req, res);
  }
  if (relativePath === '/api/storage/restore' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleStorageRestore(req, res, requestUrl);
  }
  if (relativePath === '/api/meta' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleMeta(req, res);
  }
  if (relativePath === '/api/logs/latest' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleLatestLog(req, res, requestUrl);
  }
  if (relativePath === '/api/logs/download' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleLogDownload(req, res, requestUrl);
  }
  if (relativePath === '/api/v2/signatures/create' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleV2SignatureCreate(req,res);
  }
  if (relativePath === '/api/v2/templates/import' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleV2TemplateImport(req, res);
  }
  if (relativePath === '/api/v2/admin/env' && req.method === 'GET') {
    if (!AUTH_REQUIRED) return sendJson(res,403,{error:'Admin .env editing requires authentication to be enabled.'});
    if (!ensure('admin')) return;
    return handleV2AdminEnvGet(req, res);
  }
  if (relativePath === '/api/v2/admin/env' && req.method === 'PUT') {
    if (!AUTH_REQUIRED) return sendJson(res,403,{error:'Admin .env editing requires authentication to be enabled.'});
    if (!ensure('admin')) return;
    return handleV2AdminEnvPut(req, res);
  }
  if (relativePath === '/api/v2/profile' && req.method === 'GET') {
    if (!ensure('viewer')) return;
    return handleV2ProfileGet(req, res);
  }
  if (relativePath === '/api/v2/profile' && req.method === 'PUT') {
    if (!ensure('admin')) return;
    return handleV2ProfilePut(req, res);
  }
  if (relativePath === '/api/v2/targets/check' && req.method === 'POST') {
    if (!ensure('admin')) return;
    return handleV2TargetCheck(req, res);
  }
  if (relativePath === '/api/run/preflight' && req.method === 'POST') {
    if (!ensure('user')) return;
    return handleV2RunPreflight(req, res);
  }
  if (relativePath === '/api/run/preview' && req.method === 'POST') {
    if (!ensure('user')) return;
    return handleV2RunPreview(req, res);
  }
  if (relativePath === '/api/run/generate' && req.method === 'POST') {
    if (!ensure('user')) return;
    return handleV2RunGenerate(req, res);
  }
  if (relativePath === '/api/generate/single' && req.method === 'POST') {
    if (!ensure('user')) return;
    return handleGenerateSingle(req, res);
  }
  if ((relativePath === '/api/generate/self' || relativePath === '/api/self/generate') && req.method === 'POST') {
    if (!ensureAny(['selfservice', 'it', 'operator', 'user', 'admin'])) return;
    return handleGenerateSelf(req, res);
  }
  if (relativePath === '/api/generate' && req.method === 'POST') {
    if (!ensure('user')) return;
    return handleGenerate(req, res);
  }

  return sendJson(res, 404, { error: 'Route not found' });
}

function startServer() {
  if (!AUTH_REQUIRED && !['127.0.0.1', '::1', 'localhost'].includes(HOST.toLowerCase())) {
    throw new Error('Authentication-disabled backend may bind only to a loopback host.');
  }
  initializeStorage();
  if (CONFIG_MODE === 'env') {
    const configured = validateV2Profile(getV2Profile());
    if (configured.errors.length) {
      throw new Error('Invalid .env business configuration: ' + configured.errors.join(' | '));
    }
    // Create the local preview folder on normal startup; never create remote UNC
    // directories automatically. A failed mkdir is reported but does not hide
    // login/AD diagnostics behind a failed server startup.
    const previewFolder = resolvePath(configured.profile.targets.preview.path);
    if (!previewFolder.startsWith('\\\\')) {
      try {
        fs.mkdirSync(previewFolder, { recursive: true });
      } catch (error) {
        console.warn(`Local preview folder cannot be created at ${previewFolder}: ${error.message}`);
      }
    }
  }
  const server = http.createServer(routeRequest);
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS + 5000;
  server.listen(PORT, HOST, () => {
    console.log(`Backend listening on http://${HOST}:${PORT}${BASE_PATH}`);
    console.log(`Templates directory: ${TEMPLATE_DIRECTORY}`);
    console.log(`Config path: ${CONFIG_PATH}`);
    console.log(`User file path: ${USER_FILE_PATH}`);
    console.log(`DB path: ${DB_PATH}`);
    console.log(`Auth DB path: ${AUTH_DB_PATH}`);
    console.log(`Auth required: ${AUTH_REQUIRED ? 'yes' : 'no'}`);
    console.log(`Auth DB login: ${AUTH_DB_LOGIN_ENABLED ? 'enabled' : 'disabled'}`);
    console.log(`Auth LDAP login: ${AUTH_LDAP_ENABLED ? 'enabled' : 'disabled'}`);
    if (AUTH_REQUIRED && AUTH_TOKENS.size === 0 && !AUTH_LDAP_ENABLED && (!AUTH_DB_LOGIN_ENABLED || getAuthUserCount() === 0)) {
      console.warn('AUTH_REQUIRED=true but no usable login provider or static tokens configured. All API routes will reject.');
    }
    if (AUTH_REQUIRED && AUTH_DB_LOGIN_ENABLED && getAuthUserCount() === 0) {
      console.warn('Auth is enabled but auth_users is empty. Create users in AUTH_DB_PATH.');
    }
    if (AUTH_LDAP_ENABLED && !AUTH_LDAP_DOMAIN && !AUTH_LDAP_SERVER) {
      console.warn('AUTH_LDAP_ENABLED=true without AUTH_LDAP_DOMAIN/AUTH_LDAP_SERVER. Using machine default AD domain context.');
    }
  });
}

function printCheck() {
  initializeStorage();
  if (CONFIG_MODE === 'env') {
    const checked = validateV2Profile(getV2Profile());
    if (checked.errors.length) throw new Error('Invalid .env business configuration: ' + checked.errors.join(' | '));
  }
  console.log(JSON.stringify({
    host: HOST,
    port: PORT,
    basePath: BASE_PATH,
    corsOrigins: CORS_ALLOW_ALL_ORIGINS ? ['*'] : CORS_ORIGINS,
    corsAllowCredentials: CORS_ALLOW_CREDENTIALS,
    authRequired: AUTH_REQUIRED,
    authTokenCount: AUTH_TOKENS.size,
    authDbLoginEnabled: AUTH_DB_LOGIN_ENABLED,
    authDbPath: AUTH_DB_PATH,
    authDbAvailable: Boolean(authDb),
    authUserCount: getAuthUserCount(),
    authLdapEnabled: AUTH_LDAP_ENABLED,
    authLdapDomain: AUTH_LDAP_DOMAIN,
    authLdapServer: AUTH_LDAP_SERVER,
    authLdapContainer: AUTH_LDAP_CONTAINER,
    authLdapDefaultRole: resolveLdapDefaultRole(),
    authLdapRoleMappings: AUTH_LDAP_ROLE_MAP.size,
    authLdapRoleRules: AUTH_LDAP_ROLE_RULES.length,
    authLdapFallbackToDb: AUTH_LDAP_FALLBACK_TO_DB,
    authSessionTtlMinutes: AUTH_SESSION_TTL_MINUTES,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    maxJsonBodyBytes: MAX_JSON_BODY_BYTES,
    maxFormBodyBytes: MAX_FORM_BODY_BYTES,
    maxMultipartBodyBytes: MAX_MULTIPART_BODY_BYTES,
    templateDirectory: TEMPLATE_DIRECTORY,
    configMode: CONFIG_MODE,
    effectiveProfile: getV2Profile(),
    configPath: CONFIG_PATH,
    userFilePath: USER_FILE_PATH,
    variablesPath: VARIABLES_JSON_PATH,
    dbPath: DB_PATH,
    selfServiceArtifactPath: SELF_SERVICE_ARTIFACT_PATH,
    generateScript: GENERATE_SCRIPT_PATH,
  }, null, 2));
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    printCheck();
  } else {
    startServer();
  }
}

module.exports = {
  parseMultipart,
  handleUserImport,
  handleGenerate,
  handleGenerateSingle,
  handleVariablePresetList,
  handleVariablePresetLoad,
  handleVariablePresetSave,
  queryAdUsers,
  authenticateLdapUser,
  isSameHostOrigin,
  powerShellCandidates,
  buildAdSearchFilter,
  isSafeUsernameSegment,
  resolveDomainsFromMemberOf,
  describeV2TargetFailure,
  findExactAdUserIndex,
  resolveLdapDefaultRole,
  resolveLdapRole,
  hashAuthPassword,
  verifyAuthPassword,
  collectUnresolvedPreviewPlaceholders,
  inlinePreviewAssets,
  getPreviewResolvedVariables,
};

