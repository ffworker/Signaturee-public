#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const repoRoot = path.resolve(__dirname, '..');
require('./load-env').loadEnvironment();
const args = process.argv.slice(2);
const command = (args[0] || '').trim().toLowerCase();
const validRoles = new Set(['admin', 'it', 'operator', 'user', 'viewer', 'selfservice']);

function getArg(flag, shortFlag = '') {
  const idx = args.findIndex((entry) => entry === flag || (shortFlag && entry === shortFlag));
  if (idx === -1) return '';
  return String(args[idx + 1] || '').trim();
}

function hasFlag(flag) {
  return args.includes(flag);
}

function usage() {
  console.log(`Usage:
  node scripts/manage-auth-users.js list [--db <path>]
  node scripts/manage-auth-users.js add --username <name> (--password-stdin | --password <secret>) [--role <role>] [--db <path>]
  node scripts/manage-auth-users.js set-password --username <name> (--password-stdin | --password <secret>) [--db <path>]
  node scripts/manage-auth-users.js set-role --username <name> --role <role> [--db <path>]
  node scripts/manage-auth-users.js enable --username <name> [--db <path>]
  node scripts/manage-auth-users.js disable --username <name> [--db <path>]
  node scripts/manage-auth-users.js delete --username <name> [--db <path>]

Roles: admin | it | selfservice (operator/user/viewer remain legacy-compatible)`);
}

function normalizeRole(input) {
  const role = String(input || '').trim().toLowerCase();
  if (!validRoles.has(role)) return '';
  return role;
}

function getPassword() {
  if (!hasFlag('--password-stdin')) return getArg('--password', '-p');
  if (getArg('--password', '-p')) throw new Error('Choose either --password-stdin or --password.');
  return fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
}

function hashPassword(password) {
  const value = String(password || '');
  if (value.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(value, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function resolveDbPath() {
  const raw = getArg('--db', '-d') || process.env.AUTH_DB_PATH || path.join('config', 'signaturee_auth.db');
  return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
}

function openAuthDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
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
  return db;
}

function requireUsername() {
  const username = getArg('--username', '-u');
  if (!username) {
    throw new Error('--username is required.');
  }
  return username;
}

function ensureUserExists(db, username) {
  const row = db
    .prepare('SELECT username FROM auth_users WHERE username = ? LIMIT 1')
    .get(username);
  if (!row) {
    throw new Error(`User not found: ${username}`);
  }
}

function listUsers(db) {
  const rows = db
    .prepare('SELECT username, role, enabled, display_name AS displayName, updated_at AS updatedAt FROM auth_users ORDER BY username COLLATE NOCASE ASC')
    .all();
  if (!rows.length) {
    console.log('No auth users found.');
    return;
  }
  rows.forEach((row) => {
    const enabled = Number(row.enabled || 0) === 1 ? 'enabled' : 'disabled';
    console.log(`${row.username} | ${row.role} | ${enabled} | ${row.displayName || '-'} | ${row.updatedAt}`);
  });
}

function addUser(db) {
  const username = requireUsername();
  const password = getPassword();
  const role = normalizeRole(getArg('--role', '-r') || 'it');
  if (!role) {
    throw new Error('Invalid --role value.');
  }
  const displayName = getArg('--display');
  const enabled = hasFlag('--disabled') ? 0 : 1;
  const now = new Date().toISOString();
  const passwordHash = hashPassword(password);
  db.prepare(
    `INSERT INTO auth_users (username, password_hash, role, enabled, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       password_hash = excluded.password_hash,
       role = excluded.role,
       enabled = excluded.enabled,
       display_name = excluded.display_name,
       updated_at = excluded.updated_at`,
  ).run(username, passwordHash, role, enabled, displayName, now, now);
  console.log(`Saved user: ${username} (${role}, ${enabled ? 'enabled' : 'disabled'})`);
}

function setPassword(db) {
  const username = requireUsername();
  ensureUserExists(db, username);
  const password = getPassword();
  const passwordHash = hashPassword(password);
  db.prepare('UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE username = ?')
    .run(passwordHash, new Date().toISOString(), username);
  console.log(`Updated password for: ${username}`);
}

function setRole(db) {
  const username = requireUsername();
  ensureUserExists(db, username);
  const role = normalizeRole(getArg('--role', '-r'));
  if (!role) {
    throw new Error('Valid --role is required.');
  }
  db.prepare('UPDATE auth_users SET role = ?, updated_at = ? WHERE username = ?')
    .run(role, new Date().toISOString(), username);
  console.log(`Updated role for: ${username} -> ${role}`);
}

function setEnabled(db, enabled) {
  const username = requireUsername();
  ensureUserExists(db, username);
  db.prepare('UPDATE auth_users SET enabled = ?, updated_at = ? WHERE username = ?')
    .run(enabled ? 1 : 0, new Date().toISOString(), username);
  console.log(`${enabled ? 'Enabled' : 'Disabled'} user: ${username}`);
}

function deleteUser(db) {
  const username = requireUsername();
  ensureUserExists(db, username);
  db.prepare('DELETE FROM auth_users WHERE username = ?').run(username);
  console.log(`Deleted user: ${username}`);
}

function main() {
  if (!command || hasFlag('--help') || hasFlag('-h')) {
    usage();
    return;
  }

  const dbPath = resolveDbPath();
  const db = openAuthDb(dbPath);
  console.log(`Auth DB: ${dbPath}`);

  switch (command) {
    case 'list':
      listUsers(db);
      break;
    case 'add':
      addUser(db);
      break;
    case 'set-password':
      setPassword(db);
      break;
    case 'set-role':
      setRole(db);
      break;
    case 'enable':
      setEnabled(db, true);
      break;
    case 'disable':
      setEnabled(db, false);
      break;
    case 'delete':
      deleteUser(db);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
