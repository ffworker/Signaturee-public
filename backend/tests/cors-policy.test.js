'use strict';
const assert = require('node:assert/strict');
const { isSameHostOrigin, powerShellCandidates } = require('../server');

assert.equal(isSameHostOrigin({ headers: { host: 'signature.example:3001' } }, 'http://signature.example:3001'), true);
assert.equal(isSameHostOrigin({ headers: { host: 'signature.example:3001' } }, 'http://signature.example:9999'), false);
assert.equal(isSameHostOrigin({ headers: { host: 'signature.example:3001' } }, 'https://signature.example:3001'), false);
assert.equal(isSameHostOrigin({ headers: { host: 'signature.example:3001' } }, 'http://other.example:3001'), false);
assert.deepEqual(powerShellCandidates('win32', ''), ['powershell', 'pwsh']);
assert.deepEqual(powerShellCandidates('linux', ''), ['pwsh', 'powershell']);
assert.deepEqual(powerShellCandidates('win32', 'custom.exe'), ['custom.exe', 'powershell', 'pwsh']);
console.log('cors-policy.test.js: ok');
