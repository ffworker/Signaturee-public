const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  queryAdUsers,
  collectUnresolvedPreviewPlaceholders,
  inlinePreviewAssets,
  getPreviewResolvedVariables,
  hashAuthPassword,
  verifyAuthPassword,
  resolveLdapDefaultRole,
  resolveLdapRole,
  findExactAdUserIndex,
  buildAdSearchFilter,
  isSafeUsernameSegment,
  resolveDomainsFromMemberOf,
} = require('../server');

function writeFakePowerShell(tempDir, recordPath, output) {
  const fakeScript = path.join(tempDir, 'fake-powershell.js');
  fs.writeFileSync(fakeScript, [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    "const args = process.argv.slice(2);",
    "if (args.includes('$PSVersionTable')) process.exit(0);",
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => {",
    "  fs.writeFileSync(process.env.FAKE_PS_RECORD, JSON.stringify({ args, input }), 'utf8');",
    "  process.stdout.write(process.env.FAKE_PS_OUTPUT);",
    "});",
  ].join('\n'));
  if (process.platform === 'win32') {
    const wrapper = path.join(tempDir, 'fake-powershell.cmd');
    fs.writeFileSync(wrapper, `@node "%~dp0${path.basename(fakeScript)}" %*\r\n`);
    return wrapper;
  }
  fs.chmodSync(fakeScript, 0o755);
  return fakeScript;
}

function readPowerShellInvocation(recordPath) {
  return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
}

async function assertCredentialSecretsUseStdin() {
  if (process.platform === 'win32') return; // Fake PowerShell is a Node shebang; Windows cannot spawn it as an executable.
  const tempDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'signaturee-credential-channel-'));
  const password = ['argv', 'channel', 'regression'].join('-');
  try {
    const adRecord = path.join(tempDir, 'ad.json');
    const adCommand = writeFakePowerShell(tempDir, adRecord, JSON.stringify([
      { sAMAccountName: 'fixture-user', mail: 'fixture@example.com' },
    ]));
    const adScript = [
      `const { queryAdUsers } = require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))});`,
      'queryAdUsers({ credentials: { username: \'fixture-user\', password: process.env.FIXTURE_PASSWORD } })',
      '.then(() => process.exit(0))',
      '.catch((error) => { console.error(error.message); process.exit(1); });',
    ].join('\n');
    execFileSync(process.execPath, ['-e', adScript], {
      env: {
        ...process.env,
        POWERSHELL_CMD: adCommand,
        FAKE_PS_RECORD: adRecord,
        FAKE_PS_OUTPUT: JSON.stringify([{ sAMAccountName: 'fixture-user', mail: 'fixture@example.com' }]),
        FIXTURE_PASSWORD: password,
      },
      encoding: 'utf8',
    });
    const adInvocation = readPowerShellInvocation(adRecord);
    assert.ok(!adInvocation.args.join(' ').includes(password),
      'AD passwords must not be present in PowerShell process arguments');
    assert.notStrictEqual(adInvocation.input.trim(), password,
      'AD passwords must not be sent as plaintext stdin');
    assert.strictEqual(Buffer.from(adInvocation.input.trim(), 'base64').toString('utf8'), password,
      'AD password must be delivered as encoded stdin data');

    const ldapRecord = path.join(tempDir, 'ldap.json');
    const ldapCommand = writeFakePowerShell(tempDir, ldapRecord, JSON.stringify({
      authenticated: true,
      samAccountName: 'fixture-user',
      userPrincipalName: 'fixture-user@example.com',
    }));
    const ldapScript = [
      `const { authenticateLdapUser } = require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))});`,
      'authenticateLdapUser({ username: \'fixture-user\', password: process.env.FIXTURE_PASSWORD })',
      '.then((result) => { if (!result.authenticated) process.exit(1); })',
      '.catch((error) => { console.error(error.message); process.exit(1); });',
    ].join('\n');
    execFileSync(process.execPath, ['-e', ldapScript], {
      env: {
        ...process.env,
        AUTH_LDAP_ENABLED: 'true',
        POWERSHELL_CMD: ldapCommand,
        FAKE_PS_RECORD: ldapRecord,
        FAKE_PS_OUTPUT: JSON.stringify({
          authenticated: true,
          samAccountName: 'fixture-user',
          userPrincipalName: 'fixture-user@example.com',
        }),
        FIXTURE_PASSWORD: password,
      },
      encoding: 'utf8',
    });
    const ldapInvocation = readPowerShellInvocation(ldapRecord);
    assert.ok(!ldapInvocation.args.join(' ').includes(password),
      'LDAP passwords must not be present in PowerShell process arguments');
    assert.notStrictEqual(ldapInvocation.input.trim(), password,
      'LDAP passwords must not be sent as plaintext stdin');
    assert.strictEqual(Buffer.from(ldapInvocation.input.trim(), 'base64').toString('utf8'), password,
      'LDAP password must be delivered as encoded stdin data');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function run() {
  const calls = [];
  let attempt = 0;

  const runQuery = async (currentProps) => {
    calls.push([...currentProps]);
    attempt += 1;
    if (attempt === 1) {
      return {
        code: 1,
        stdout: '',
        stderr:
          'Get-ADUser : Mindestens eine Eigenschaft ist ungultig. Parametername: YourCompanyName',
      };
    }
    return {
      code: 0,
      stdout: JSON.stringify([
        {
          sAMAccountName: 'user1',
          mail: 'user1@example.com',
          givenName: 'User',
          sn: 'One',
        },
      ]),
      stderr: '',
    };
  };

  const result = await queryAdUsers({
    limit: 1,
    adProperties: ['YourCompanyName'],
    runQuery,
  });

  assert.strictEqual(result.users.length, 1, 'expected one user');
  assert.strictEqual(result.users[0].id, 'user1', 'expected id from sAMAccountName');
  assert.ok(
    result.skippedProperties && result.skippedProperties.includes('YourCompanyName'),
    'expected skipped property to be reported',
  );
  assert.strictEqual(calls.length, 2, 'expected retry after invalid property');
  assert.ok(calls[0].includes('YourCompanyName'), 'expected invalid property in first call');
  assert.ok(!calls[1].includes('YourCompanyName'), 'expected invalid property removed on retry');

  await assert.rejects(
    queryAdUsers({ searchBase: "OU=Staff\n'@\nWrite-Output bad\n@'", runQuery }),
    (error) => error.status === 400,
    'multiline AD search bases must be rejected before constructing PowerShell',
  );
  const validBase = await queryAdUsers({ searchBase: 'OU=Staff,DC=example,DC=com', runQuery });
  assert.strictEqual(validBase.users.length, 1, 'single-line search bases still work');

  const unresolved = collectUnresolvedPreviewPlaceholders(
    '<span>$mail</span><span>$custom</span>',
    'Text $mail $other',
  );
  assert.deepStrictEqual(
    unresolved.map((item) => item.toLowerCase()).sort(),
    ['$custom', '$mail', '$other'].sort(),
    'expected unique unresolved placeholders from HTML and TXT',
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signaturee-preview-test-'));
  try {
    const imagePath = path.join(tempDir, 'logo.png');
    fs.writeFileSync(imagePath, Buffer.from([0x89,0x50,0x4e,0x47]));
    const inlined = await inlinePreviewAssets('<img src="logo.png">', tempDir);
    assert.ok(inlined.includes('data:image/png;base64,'), 'expected local preview image to be inlined');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const previewVariables = getPreviewResolvedVariables(
    {
      profile: {
        variables: {
          variables: [
            { id:'mail', displayName:'E-Mail', placeholders:['$mail'], adProperties:['mail'], required:true },
            { id:'domain', displayName:'Domain', placeholders:['$domain'], adProperties:['mail'] },
            { id:'description', displayName:'Titel', placeholders:['$description'], adProperties:['description'] },
          ],
        },
        signatures: {
          LS: { customTitleAttr:'extensionAttribute5' },
        },
        secondaryTitleAttributes:['extensionAttribute6'],
      },
      aliasMap: new Map(),
    },
    {
      mail:'max@example.com',
      raw:{
        mail:'max@example.com',
        description:'Fallback title',
        extensionAttribute5:'Custom title',
        extensionAttribute6:'Additional title',
      },
    },
    'LS',
  );
  const valuesById = Object.fromEntries(previewVariables.map((item) => [item.id,item.value]));
  assert.strictEqual(valuesById.mail, 'max@example.com', 'expected mail preview value');
  assert.strictEqual(valuesById.domain, 'example.com', 'expected derived mail domain');
  assert.strictEqual(valuesById.description, 'Custom title / Additional title', 'expected custom and secondary title preview');

  const managedHash = hashAuthPassword('test-password-123');
  assert.strictEqual(verifyAuthPassword('test-password-123', managedHash), true,
    'Admin-created passwords must verify at login');
  assert.strictEqual(verifyAuthPassword('wrong-password', managedHash), false,
    'incorrect passwords must not verify');

  const env = { ...process.env };
  delete env.AUTH_REQUIRED;
  delete env.API_AUTH_REQUIRED;
  const defaults = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'server.js'), '--check'],
    { env, encoding: 'utf8' }));
  assert.strictEqual(defaults.authRequired, true, 'missing env must not disable authentication');
  const typoDefaults = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'server.js'), '--check'],
    { env: { ...env, AUTH_REQUIRED: 'ture' }, encoding: 'utf8' }));
  assert.strictEqual(typoDefaults.authRequired, true, 'a typo must not turn authentication off');
  const explicitOptOut = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'server.js'), '--check'],
    { env: { ...env, AUTH_REQUIRED: 'false' }, encoding: 'utf8' }));
  assert.strictEqual(explicitOptOut.authRequired, false, 'explicit local-development opt-out remains available');
  const ldapAdminDefault = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'server.js'), '--check'],
    { env: { ...env, AUTH_LDAP_DEFAULT_ROLE: 'admin' }, encoding: 'utf8' }));
  assert.strictEqual(ldapAdminDefault.authLdapDefaultRole, 'selfservice',
    'LDAP defaults must never grant full administration');
  assert.strictEqual(resolveLdapDefaultRole(), 'selfservice');
  assert.strictEqual(resolveLdapRole({ samAccountName: 'regular-user' }), 'selfservice');
  const adMatches = [{ sAMAccountName: 'other-user', mail: 'other@example.com' }];
  assert.strictEqual(findExactAdUserIndex(adMatches, 'other'), -1,
    'a single fuzzy AD result must not become the self-service subject');
  assert.strictEqual(findExactAdUserIndex(adMatches, 'OTHER-USER'), 0,
    'exact canonical account matches must still work');
  assert.strictEqual(findExactAdUserIndex([
    { sAMAccountName: 'one', mail: 'shared@example.com' },
    { sAMAccountName: 'two', mail: 'shared@example.com' },
  ], 'shared@example.com'), -1, 'duplicate exact identities must be rejected');
  assert.ok(buildAdSearchFilter('user@example.com', 25).includes('userPrincipalName -like'),
    'AD query must search UPN before exact matching');
  assert.strictEqual(isSafeUsernameSegment('first.last'), true);
  for (const unsafeName of ['..', '../escape', '..\\escape', 'user/name', 'user\\name', 'user:', 'user.']) {
    assert.strictEqual(isSafeUsernameSegment(unsafeName), false, `unsafe output name: ${unsafeName}`);
  }
  const groupConfig = { domains: { example: {} }, securityGroupMapping: { 'Signatur-example': 'example' } };
  assert.deepStrictEqual(resolveDomainsFromMemberOf('CN=Other,OU=Signatur-example,DC=example,DC=com', groupConfig), [],
    'group mapping must not match an OU substring');
  assert.deepStrictEqual(resolveDomainsFromMemberOf('CN=Signatur-example,OU=Groups,DC=example,DC=com', groupConfig), ['example']);

  await assertCredentialSecretsUseStdin();

  console.log('ad-query.test.js: ok');
}

run().catch((err) => {
  console.error('ad-query.test.js: failed');
  console.error(err);
  process.exit(1);
});
