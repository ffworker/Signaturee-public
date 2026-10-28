'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { discoverSignatureProfiles } = require('../signature-discovery');

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signaturee-templates-'));
  try {
    for (const name of [
      'AD_Template.htm', 'AD_Template.txt', 'FF_Template.html', 'FF_Template.TXT',
      'example_template.htm', 'example_template.txt',
    ]) fs.writeFileSync(path.join(root, name), 'test');
    fs.mkdirSync(path.join(root, 'AD-Dateien'));
    let discovered = discoverSignatureProfiles(root);
    assert.deepEqual(Object.keys(discovered).sort(), ['AD','FF']);
    assert.deepEqual(discovered.AD.adGroups, ['Signature-AD']);
    assert.equal(discovered.AD.resourceFolder, 'AD-Dateien');
    assert.equal(discovered.FF.templateHtml, 'FF_Template.html');
    assert.deepEqual(discoverSignatureProfiles(root, { groupPrefix: 'Signatur-' }).AD.adGroups, ['Signatur-AD']);

    const settings = {
      ...process.env,
      SIGNATUREE_CONFIG_MODE: 'env',
      TEMPLATE_DIR: root,
      SIGNATUREE_SIGNATURES_AUTO_DISCOVER: 'true',
      SIGNATUREE_SIGNATURES_JSON: '{"example":{"templateHtml":"wrong.htm"}}',
      SIGNATUREE_AUTO_GROUP_PREFIX: 'Signature-',
      SIGNATUREE_ORGANIZATION_NAME: 'Test',
      LOCAL_DEPLOYMENT_PATH: path.join(root, 'preview'),
      NETWORK_DEPLOYMENT_PATH: '\\\\example.test\\share',
      AD_SERVER: 'dc.example.test',
      OU_SEARCH_BASE: 'DC=example,DC=test',
      AUTH_LDAP_ENABLED: 'false',
    };
    delete settings.SIGNATUREE_PROFILE_JSON;
    delete settings.SIGNATUREE_ENV_FILE;
    const p = spawnSync(process.execPath,
      [path.join(__dirname, '..', 'server.js'), '--check'],
      { env: settings, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    const checked = JSON.parse(p.stdout);
    assert.deepEqual(Object.keys(checked.effectiveProfile.signatures).sort(), ['AD','FF']);
    assert.deepEqual(checked.effectiveProfile.signatures.AD.adGroups, ['Signature-AD']);

    fs.unlinkSync(path.join(root, 'FF_Template.TXT'));
    assert.throws(() => discoverSignatureProfiles(root), /Incomplete template pair/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('signature-discovery.test.js: ok');
}
run();
