'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Opt-in convention: XY_Template.htm + XY_Template.txt + optional XY-Dateien/
// is assigned to the AD security group "Signature-XY". No AD write or group
// creation is performed. All names are taken from files already on the server.
function discoverSignatureProfiles(templateDirectory, options = {}) {
  const groupPrefix = String(options.groupPrefix ?? 'Signature-').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*-$/.test(groupPrefix)) {
    throw new Error('SIGNATUREE_AUTO_GROUP_PREFIX must be a safe prefix ending with a dash.');
  }
  if (!fs.existsSync(templateDirectory) || !fs.statSync(templateDirectory).isDirectory()) {
    throw new Error('Template directory does not exist: ' + templateDirectory);
  }
  const entries = fs.readdirSync(templateDirectory, { withFileTypes: true });
  const filesByKey = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,39})_Template\.(htm|html|txt)$/i.exec(entry.name);
    if (!match) continue;
    const key = match[1];
    if (key.toLowerCase() === 'example') continue; // Tracked example is not a production signature.
    const lower = key.toLowerCase();
    if (!filesByKey.has(lower)) filesByKey.set(lower, { key, html: '', txt: '' });
    const record = filesByKey.get(lower);
    if (match[2].toLowerCase() === 'txt') {
      if (record.txt) throw new Error('Duplicate TXT template for ' + key);
      record.txt = entry.name;
    } else {
      if (record.html) throw new Error('Duplicate HTML template for ' + key);
      record.html = entry.name;
    }
  }
  const folders = entries.filter(e => e.isDirectory()).map(e => e.name);
  const result = {};
  for (const { key, html, txt } of filesByKey.values()) {
    if (!html || !txt) {
      throw new Error('Incomplete template pair for ' + key +
        ': expected both ' + key + '_Template.htm and ' + key + '_Template.txt');
    }
    const resourceFolder = folders.find(folder => folder.toLowerCase() === (key + '-Dateien').toLowerCase()) || '';
    result[key] = {
      label: key,
      adGroups: [groupPrefix + key],
      templateHtml: html,
      templateTxt: txt,
      resourceFolder,
    };
  }
  if (!Object.keys(result).length) {
    throw new Error('No template pairs found in ' + path.resolve(templateDirectory) +
      ' (expected XY_Template.htm and XY_Template.txt).');
  }
  return result;
}

module.exports = { discoverSignatureProfiles };
