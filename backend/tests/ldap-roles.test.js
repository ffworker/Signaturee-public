const assert = require('assert');
const { parseLdapRoleRules, resolveLdapRuleRole } = require('../ldap-roles');

const rules = parseLdapRoleRules({ rules: [
  { attribute: 'sn', equals: 'IT', role: 'it' },
  { attribute: 'department', equals: 'Support', role: 'it' },
  { groupDn: 'CN=Signaturee-IT,OU=Groups,DC=example,DC=com', role: 'it' },
] });
assert.strictEqual(resolveLdapRuleRole(rules, { attributes: { sn: 'IT' } }), 'it');
assert.strictEqual(resolveLdapRuleRole(rules, { attributes: { DEPARTMENT: 'support' } }), 'it');
assert.strictEqual(resolveLdapRuleRole(rules, { attributes: { extensionAttribute5: 'IT' } }), 'selfservice');
assert.strictEqual(resolveLdapRuleRole(rules, { groupDns: ['cn=signaturee-it,ou=groups,dc=example,dc=com'] }), 'it');
assert.strictEqual(resolveLdapRuleRole(rules, { groupDns: ['CN=Other,OU=Signaturee-IT,DC=example,DC=com'] }), 'selfservice');
assert.strictEqual(resolveLdapRuleRole(rules, { attributes: { sn: ['HR', 'IT'] } }), 'it');
assert.strictEqual(resolveLdapRuleRole([], { attributes: { sn: 'IT' } }), 'selfservice');
assert.throws(() => parseLdapRoleRules({ rules: [{ attribute: 'sn', equals: 'IT', role: 'admin' }] }), /role/i);
assert.throws(() => parseLdapRoleRules({ rules: [{ attribute: 'sn;Write-Output injected', equals: 'IT', role: 'it' }] }), /attribute/i);
assert.throws(() => parseLdapRoleRules({ rules: [{ groupDn: '', role: 'it' }] }), /groupDn/i);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const temp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'signaturee-ldap-rules-'));
try {
  const rulesPath = path.join(temp, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify({ rules: [{ attribute: 'department', equals: 'IT', role: 'it' }] }));
  const env = { ...process.env, AUTH_LDAP_ROLE_RULES_PATH: rulesPath };
  const config = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '../server.js'), '--check'],
    { env, encoding: 'utf8' }));
  assert.strictEqual(config.authLdapRoleRules, 1, 'backend must load the configured LDAP role rules file');
  const role = execFileSync(process.execPath,
    ['-e', `process.stdout.write(require(${JSON.stringify(path.join(__dirname, '../server.js'))}).resolveLdapRole({ attributes: { department: 'IT' } }))`],
    { env, encoding: 'utf8' });
  assert.strictEqual(role, 'it', 'loaded AD attribute rules must affect role assignment');
  const roleScript = `process.stdout.write(require(${JSON.stringify(path.join(__dirname, '../server.js'))}).resolveLdapRole({ inputUsername: 'admin-alias', samAccountName: 'real-user' }))`;
  const unsafeLegacyRole = execFileSync(process.execPath, ['-e', roleScript],
    { env: { ...process.env, AUTH_LDAP_ROLE_MAP: 'real-user:admin,admin-alias:it' }, encoding: 'utf8' });
  assert.strictEqual(unsafeLegacyRole, 'selfservice', 'legacy maps may not grant admin or trust login aliases');
  const legacyItRole = execFileSync(process.execPath, ['-e', roleScript],
    { env: { ...process.env, AUTH_LDAP_ROLE_MAP: 'real-user:it' }, encoding: 'utf8' });
  assert.strictEqual(legacyItRole, 'it', 'canonical legacy IT mapping remains compatible');
  fs.writeFileSync(rulesPath, JSON.stringify({ rules: [{ attribute: 'sn', equals: 'IT', role: 'admin' }] }));
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, '../server.js'), '--check'],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), 'invalid privileged rules must fail startup');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('ldap-roles.test.js: ok');
