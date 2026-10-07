#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const removeDependencies = args.has('--all');
const dryRun = args.has('--dry-run');

const removed = [];
const missing = [];

const dirTargets = [
  'Logs',
  'generatedsignatures',
  'frontend/dist',
  'frontend/.parcel-cache',
  'coverage',
  '.cache'
];

if (removeDependencies) {
  dirTargets.push('node_modules', 'backend/node_modules', 'frontend/node_modules');
}

function removePath(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    missing.push(relativePath);
    return;
  }

  if (!dryRun) {
    fs.rmSync(absolutePath, { recursive: true, force: true });
  }
  removed.push(relativePath);
}

for (const target of dirTargets) {
  removePath(target);
}

const rootFiles = fs.readdirSync(repoRoot, { withFileTypes: true });
for (const entry of rootFiles) {
  if (!entry.isFile()) {
    continue;
  }

  if (/^summary_.*\.txt$/i.test(entry.name) || /^(npm|yarn|pnpm)-.*\.log$/i.test(entry.name)) {
    removePath(entry.name);
  }
}

if (removed.length === 0) {
  console.log('Nothing to clean.');
  process.exit(0);
}

const modeLabel = dryRun ? 'Dry run - would remove' : 'Removed';
console.log(`${modeLabel} ${removed.length} path(s):`);
for (const target of removed) {
  console.log(`- ${target}`);
}

if (missing.length > 0) {
  console.log(`Skipped ${missing.length} missing path(s).`);
}
