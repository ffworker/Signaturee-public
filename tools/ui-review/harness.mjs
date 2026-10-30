#!/usr/bin/env node
/* Local-only browser QA harness for the actual Signaturee frontend. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const playwrightPath = process.env.UI_REVIEW_PLAYWRIGHT || path.join(os.homedir(), '.hermes/cache/scratch/signaturee-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightPath).href);

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const FRONTEND = process.env.UI_REVIEW_FRONTEND ? path.resolve(process.env.UI_REVIEW_FRONTEND) : path.join(ROOT, 'frontend');
const ARTIFACTS = path.join(ROOT, 'tools/ui-review/artifacts');
const PORT = Number(process.env.UI_REVIEW_PORT || 4320);
const HOST = '127.0.0.1';
const PHASE = process.env.UI_REVIEW_PHASE || 'baseline';
const BASE = `http://${HOST}:${PORT}`;
const TOKEN = 'fixture-token';
const allowedApi = new Set([
  'GET /health', 'GET /api/auth/me', 'POST /api/auth/login', 'POST /api/auth/logout',
  'GET /api/users/ad', 'POST /api/run/preflight', 'POST /api/run/preview', 'POST /api/run/generate/stream',
  'GET /api/self/bootstrap', 'POST /api/self/generate', 'GET /api/self/signature/download',
  'GET /api/v2/profile', 'PUT /api/v2/profile', 'POST /api/v2/signatures/create',
  'GET /api/v2/admin/env', 'PUT /api/v2/admin/env', 'GET /api/v2/auth/users',
  'POST /api/v2/auth/ldap/test', 'POST /api/v2/ad/test', 'POST /api/v2/targets/check',
  'GET /api/runner/status', 'POST /api/runner/control', 'POST /api/v2/templates/import',
]);
const requests = [];
const pageErrors = [];
const consoleErrors = [];

const user = { id: 'alex.fixture', displayName: 'Alex Example', mail: 'alex.example@fixture.invalid', department: 'Product QA', groups: ['Signature-Standard','Signature-Sales'], domains:['STANDARD','SALES'] };
const catalog = [
  { key: 'STANDARD', displayLabel: 'Standard', adGroups: ['Signature-Standard'] },
  { key: 'SALES', displayLabel: 'Sales', adGroups: ['Signature-Sales'] },
];
function plan() {
  return {
    ok: true, signatureCount: 2,
    target: { label: 'Lokale Vorschau', path: 'C:\\Fixture\\generatedsignatures' },
    users: [{ ...user, domains: ['STANDARD', 'SALES'], signatures: ['STANDARD', 'SALES'], outputPath: 'C:\\Fixture\\generatedsignatures\\alex.fixture' }],
    issues: [],
    templateChecks: [
      { domain: 'STANDARD', ok: true, level: 'ok', label: 'Standard: HTML und TXT vorhanden' },
      { domain: 'SALES', ok: true, level: 'ok', label: 'Sales: HTML und TXT vorhanden' },
      { domain: 'STANDARD', ok: true, level: 'ok', label: 'Pflichtfelder vorhanden' },
    ],
  };
}
function json(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(text);
}
function readBody(req) { return new Promise(resolve => { let data = ''; req.on('data', c => data += c); req.on('end', () => resolve(data)); }); }
function auth(req) { return String(req.headers.authorization || '').startsWith('Bearer fixture-'); }
function roleFor(req) { return String(req.headers.authorization || '').includes('fixture-self') ? 'selfservice' : 'admin'; }
function profile() {
  return {
    source: 'environment', automaticSignatures: true, automaticGroupPrefix: 'Signature-',
    profile: {
      organization: { name: 'Fixture Organization' },
      directory: { server: 'dc.fixture.invalid', searchBase: 'DC=fixture,DC=invalid', secondaryTitleAttributes: [] },
      targets: { preview: { path: 'C:\\Fixture\\generatedsignatures' }, production: { path: '\\\\fixture\\signatures' } },
      signatures: {
        STANDARD: { label: 'Standard', adGroups: ['Signature-Standard'], templateHtml: 'STANDARD_Template.htm', templateTxt: 'STANDARD_Template.txt', resourceFolder: 'STANDARD-Dateien', customTitleAttr: '', faxFallback: '' },
        SALES: { label: 'Sales', adGroups: ['Signature-Sales'], templateHtml: 'SALES_Template.htm', templateTxt: 'SALES_Template.txt', resourceFolder: 'SALES-Dateien', customTitleAttr: '', faxFallback: '' },
      },
      variables: { variables: [
        { id: 'givenname', displayName: 'Vorname', required: true, adProperties: ['givenName'], placeholders: ['$givenname'], csvHeader: 'givenname' },
        { id: 'mail', displayName: 'E-Mail', required: true, adProperties: ['mail'], placeholders: ['$mail'], csvHeader: 'mail' },
        { id: 'department', displayName: 'Abteilung', required: false, adProperties: ['department'], placeholders: ['$department'], csvHeader: 'department' },
      ] },
    },
    status: { signatureStatus: catalog.map(item => ({ key:item.key, html:{exists:true}, txt:{exists:true}, resources:{exists:true} })) },
  };
}
function routeApi(req, res, url) {
  const method = req.method;
  const key = `${method} ${url.pathname}`;
  requests.push({ method, path: url.pathname, query: url.search, key });
  if (url.pathname === '/health' && method === 'GET') {
    if (url.searchParams.get('fixture') === 'down' || String(req.headers.referer || '').includes('fixture=down')) return json(res, 503, { status: 'down' });
    return json(res, 200, { status: 'ok', fixture: true });
  }
  if (!allowedApi.has(key)) return json(res, 404, { error: `Unexpected fixture route: ${key}` });
  if (url.pathname.startsWith('/api/') && !auth(req) && !['/api/auth/login'].includes(url.pathname)) return json(res, 401, { error: 'Fixture authentication required' });
  if (key === 'GET /api/auth/me') return json(res, 200, auth(req) ? { authRequired: true, authenticated: true, token: roleFor(req) === 'selfservice' ? 'fixture-self' : TOKEN, username: roleFor(req) === 'selfservice' ? 'alex.fixture' : 'fixture-admin', role: roleFor(req), source: roleFor(req) === 'selfservice' ? 'ldap' : 'local' } : { authRequired: true, authenticated: false });
  if (key === 'POST /api/auth/login') return json(res, 401, { error: 'Fixture login disabled; no credentials are accepted by this harness.' });
  if (key === 'POST /api/auth/logout') return json(res, 200, { ok: true });
  if (key === 'GET /api/users/ad') return json(res, 200, { users: [user], signatureCatalog: catalog });
  if (key === 'POST /api/run/preflight') return json(res, 200, plan());
  if (key === 'POST /api/run/preview') return json(res, 200, {
    signature: { key: 'STANDARD', displayLabel: 'Standard' }, user,
    html: '<table style="font-family:Arial;color:#222"><tr><td><strong>Alex Example</strong><br>Product QA<br>alex.example@fixture.invalid</td></tr></table>',
    text: 'Alex Example\nProduct QA\nalex.example@fixture.invalid', unresolvedPlaceholders: [],
    resolvedVariables: [
      { id: 'givenname', placeholder: '$givenname', value: 'Alex', source: 'givenName', required: true },
      { id: 'mail', placeholder: '$mail', value: user.mail, source: 'mail', required: true },
    ],
  });
  if (key === 'POST /api/run/generate/stream') {
    const p = plan();
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
    const events = [
      { type: 'started', plan: p },
      { type: 'status', message: 'Fixture stream gestartet.' },
      { type: 'output', channel: 'stdout', text: '[2026-01-01 12:00:00] [INFO] Template loaded for alex.fixture - STANDARD. Length: 123\nCreated Outlook signatures for user alex.fixture for domain STANDARD\n' },
      { type: 'output', channel: 'stdout', text: 'Template loaded for alex.fixture - SALES. Length: 124\nCreated Outlook signatures for user alex.fixture for domain SALES\n' },
      { type: 'done', plan: p },
    ];
    events.forEach((event, i) => setTimeout(() => { res.write(`${JSON.stringify(event)}\n`); if (i === events.length - 1) res.end(); }, i * 35));
    return;
  }
  if (key === 'GET /api/self/bootstrap') return json(res, 200, { ready: true, username: 'alex.fixture', user, signatureOptions: [{ key: 'STANDARD', displayLabel: 'Standard', ready: true }, { key: 'SALES', displayLabel: 'Sales', ready: true }], issues: [] });
  if (key === 'POST /api/self/generate') { readBody(req).then(raw => { const chosen = JSON.parse(raw).signatures; assert.deepEqual(chosen, ['STANDARD'], 'Self-service must submit only the selected signature'); json(res, 200, { signatures:chosen, download:{url:'/api/self/signature/download'} }); }); return; }
  if (key === 'GET /api/self/signature/download') { res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="fixture-signatures.zip"' }); return res.end(Buffer.from('fictional fixture archive')); }
  if (key === 'GET /api/v2/profile') return json(res, 200, profile());
  if (key === 'PUT /api/v2/profile') return json(res, 200, profile());
  if (key === 'POST /api/v2/signatures/create') return json(res, 201, { ok: true, key: 'FIXTURE' });
  if (key === 'GET /api/v2/auth/users') return json(res, 200, { users: [{ username: 'fixture-admin', displayName: 'Fixture Admin', role: 'admin', enabled: true }], system: { ldap: { enabled: false, domain: 'fixture.invalid', roleRules: 0 } } });
  if (key === 'POST /api/v2/templates/import') return json(res, 200, { ok: true, files: [] });
  if (key === 'POST /api/v2/targets/check') return json(res, 200, { exists: true, directory: true, writable: true, aclWritable: true });
  if (key === 'POST /api/v2/ad/test') return json(res, 200, { ok: true, code: 'FIXTURE_OK', message: 'Fictional AD diagnostic response.', server: 'dc.fixture.invalid', searchBase: 'DC=fixture,DC=invalid', authMode: 'Windows-Dienstidentität' });
  if (key === 'POST /api/v2/auth/ldap/test') return json(res, 400, { error: 'Fixture LDAP is disabled.' });
  if (key === 'GET /api/runner/status') return json(res, 200, { summary: { healthy: true }, services: { backend: { healthy: true, statusCode: 200, responseMs: 1 }, frontend: { healthy: true, statusCode: 200, responseMs: 1 } }, tasks: { tasks: [], reason: 'Fixture has no Windows tasks.' } });
  if (key === 'POST /api/runner/control') return json(res, 200, { ok: true });
  if (key === 'GET /api/v2/admin/env') return json(res, 200, { editable: true, revision: 'fixture', values: { SIGNATUREE_ORGANIZATION_NAME: 'Fixture Organization', AD_SERVER: 'dc.fixture.invalid', OU_SEARCH_BASE: 'DC=fixture,DC=invalid', LOCAL_DEPLOYMENT_PATH: 'C:\\Fixture\\generatedsignatures', NETWORK_DEPLOYMENT_PATH: '\\\\fixture\\signatures', SIGNATUREE_AUTO_GROUP_PREFIX: 'Signature-' }, variables: profile().profile.variables.variables, baseVariables: profile().profile.variables.variables });
  if (key === 'PUT /api/v2/admin/env') return json(res, 200, { ok: true });
  return json(res, 200, {});
}
function server() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE);
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') return routeApi(req, res, url);
    if (url.pathname === '/runtime-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(`globalThis.__SIGNATUREE_RUNTIME__={apiBase:${JSON.stringify(BASE)}};`); }
    let file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = path.resolve(FRONTEND, file);
    if (!full.startsWith(FRONTEND) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(full); const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' }); fs.createReadStream(full).pipe(res);
  }).listen(PORT, HOST);
}
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function shotName(page, viewport, label) { return path.join(ARTIFACTS, PHASE, `${page}-${viewport}-${label}.png`); }
async function screenshot(page, pageName, viewport, label) { const p = shotName(pageName, viewport, label); mkdir(path.dirname(p)); assert.ok(await page.evaluate(() => { const e=document.querySelector('.product-masthead'); return !e || Math.abs(e.getBoundingClientRect().width-innerWidth)<20; }), `Masthead must span the page: ${pageName}`); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal page overflow: ${pageName} ${viewport} ${label}`); await page.screenshot({ path: p, fullPage: true }); return p; }
async function assertEditorial(page, pageName, mode) {
  const actual = await page.evaluate(() => {
    const heading=document.querySelector('h1');
    const card=document.querySelector('.login-card');
    const section=document.querySelector('.step-card');
    return {
      titleFont:getComputedStyle(heading).fontFamily,
      titleSize:parseFloat(getComputedStyle(heading).fontSize),
      masthead:getComputedStyle(document.querySelector('.product-masthead')).backgroundColor,
      card:card ? {bg:getComputedStyle(card).backgroundColor, color:getComputedStyle(card).color,
        scheme:getComputedStyle(card).colorScheme, inputColor:getComputedStyle(card.querySelector('input')).color} : null,
      section:section ? {bg:getComputedStyle(section).backgroundColor,radius:getComputedStyle(section).borderRadius} : null
    };
  });
  assert.equal(await page.locator('html').getAttribute('data-theme'),mode);
  if (pageName === 'admin.html') {
    const chip = page.locator('.template-chip').first();
    await chip.waitFor({state:'visible'});
    const palette = await chip.evaluate(el => ({fg:getComputedStyle(el).color,
      border:getComputedStyle(el).borderTopColor, root:getComputedStyle(document.documentElement).color}));
    assert.equal(palette.fg,palette.root, 'Template health controls must use ink/paper, not legacy blue');
  }
  assert.match(actual.titleFont,/Georgia/, 'Editorial page titles use the reference serif');
  assert.equal(actual.masthead,'rgb(25, 27, 26)', 'The masthead stays ink in both themes');
  if (pageName === 'login.html') {
    assert.equal(actual.card.bg,'rgb(238, 236, 226)', 'Login retains a warm paper sheet in both themes');
    assert.equal(actual.card.color,'rgb(37, 39, 34)', 'The paper form retains ink text');
    assert.equal(actual.card.scheme,'light','Paper form native controls remain readable in dark mode');
  } else {
    assert.ok(actual.titleSize >= (page.viewportSize().width > 760 ? 48 : 36), 'Editorial title must have deliberate prominence');
    assert.equal(actual.section.bg,'rgba(0, 0, 0, 0)', 'Working sections are open, not nested cards');
    assert.equal(actual.section.radius,'0px');
  }
}
async function setTheme(page,mode) { await page.evaluate(mode => { if (document.documentElement.dataset.theme !== mode) document.getElementById('themeToggle').click(); },mode); }
async function ready(page, selector) { await page.waitForSelector(selector, { state: 'visible', timeout: 7000 }); }
async function newSizedPage(browser, viewport) { const page = await browser.newPage(); await page.setViewportSize(viewport); return page; }
async function authPage(browser, pathName, role = 'admin', viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage();
  await page.setViewportSize(viewport);
  const token = role === 'selfservice' ? 'fixture-self' : TOKEN;
  await page.addInitScript(({ token }) => localStorage.setItem('signaturee.apiToken', token), { token });
  await page.goto(`${BASE}/${pathName}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  return page;
}
async function run() {
  mkdir(ARTIFACTS); const srv = server();
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/sbin/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce', acceptDownloads: true });
  context.on('page', page => { page.on('pageerror', e => pageErrors.push(String(e))); page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); }); page.on('request', req => { try { const host = new URL(req.url()).hostname; if (req.url().startsWith('http') && !['127.0.0.1', 'localhost', '::1'].includes(host)) pageErrors.push(`non-loopback request: ${req.url()}`); } catch {} }); });
  const results = { phase: PHASE, base: BASE, screenshots: [], flows: [], failures: [], requests, pageErrors, consoleErrors };
  // Capture baseline immediately for every real page at all required sizes.
  for (const [pageName, selector] of [['index.html', '#peopleStep'], ['self-service.html', '#selfIdentity'], ['admin.html', '.admin-nav'], ['login.html', '#loginForm']]) {
    for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }], ['320', { width: 320, height: 844 }]]) {
      const p = pageName === 'login.html' ? await newSizedPage(context, viewport) : await authPage(context, pageName, pageName === 'self-service.html' ? 'selfservice' : 'admin', viewport);
      if (pageName === 'login.html') { await p.addInitScript(() => localStorage.clear()); await p.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded' }); }
      await p.waitForSelector(selector, { timeout: 7000 }); await p.waitForTimeout(200);
      await p.evaluate(() => { if (document.documentElement.dataset.theme !== 'light') document.getElementById('themeToggle').click(); });
      await assertEditorial(p,pageName,'light');
      results.screenshots.push(await screenshot(p, pageName.replace('.html',''), label, 'baseline'));
      await p.locator('#themeToggle').click();
      assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');
      await assertEditorial(p,pageName,'dark');
      results.screenshots.push(await screenshot(p, pageName.replace('.html',''), label, 'dark'));
      await p.locator('#themeToggle').click();
      await p.close();
    }
  }
  // Generator end-to-end.
  { const p = await authPage(context, 'index.html'); await ready(p, '#adSearchInput'); await p.fill('#adSearchInput', 'Alex'); await p.click('#adSearchForm button[type=submit]'); await ready(p, '#searchResults .person-row'); await screenshot(p, 'generator', '1440', 'search'); await p.locator('#searchResults .person-row button').first().click(); await ready(p, '#preflightBtn:not([disabled])'); await p.click('#preflightBtn'); await ready(p, '#preflightPanel .preflight-overall.ok'); await p.locator('#previewStep > summary').click(); await p.click('#previewBtn'); await ready(p, '#previewResult:not([hidden])'); assert.equal(await p.locator('#previewSurface .signature-preview-surface, #previewSurface table').count() > 0, true, 'preview HTML should render inside preview surface'); await screenshot(p, 'generator', '1440', 'preview'); await setTheme(p,'dark'); assert.equal(await p.locator('.signature-choice span').first().evaluate(el => getComputedStyle(el).color), 'rgb(238, 236, 226)', 'Selected signature labels remain readable in dark mode'); await screenshot(p,'generator','1440','preview-dark'); await setTheme(p,'light'); await p.click('#generateBtn'); await ready(p, '#runResult[data-state="success"]'); await screenshot(p, 'generator', '1440', 'stream-success'); await setTheme(p,'dark'); await screenshot(p,'generator','1440','stream-success-dark'); await setTheme(p,'light'); results.flows.push('generator search/select/preflight/preview/stream'); await p.close(); }
  // Search loading, empty and error states use the real page with explicit fictional responses.
  {
    const p = await authPage(context, 'index.html');
    await p.route('**/api/users/ad?*', async route => {
      const query = new URL(route.request().url()).searchParams.get('search');
      if (query === 'loading-fixture') await new Promise(resolve => setTimeout(resolve, 500));
      await route.fulfill({ status: query === 'error-fixture' ? 500 : 200,
        contentType:'application/json', body:JSON.stringify(query === 'error-fixture'
          ? {error:'Fictional directory unavailable'} : {users:[],signatureCatalog:catalog}) });
    });
    await p.fill('#adSearchInput','loading-fixture');
    await p.click('#adSearchForm button[type=submit]');
    await p.waitForFunction(() => /such/i.test(document.querySelector('#searchStatus').textContent));
    await screenshot(p,'generator','1440','loading');
    await p.waitForFunction(() => /keine|0 Treffer/i.test(document.querySelector('#searchStatus').textContent));
    await screenshot(p,'generator','1440','empty');
    await p.fill('#adSearchInput','error-fixture');
    await p.click('#adSearchForm button[type=submit]');
    await p.waitForFunction(() => document.querySelector('#searchStatus').textContent.includes('Fictional directory unavailable'));
    await screenshot(p,'generator','1440','error');
    await p.close(); results.flows.push('generator loading/empty/error');
  }
  // Preview isolation: only the app-owned surface may contain fixture signature markup.
  { const p = await authPage(context, 'index.html'); await p.fill('#adSearchInput', 'Alex'); await p.click('#adSearchForm button[type=submit]'); await ready(p, '#searchResults .person-row'); await p.locator('#searchResults .person-row button').first().click(); await p.click('#preflightBtn'); await ready(p, '#preflightPanel .preflight-overall.ok'); await p.locator('#previewStep > summary').click(); await p.click('#previewBtn'); await ready(p, '#previewResult:not([hidden])'); const leaked = await p.locator('body > table, body > p').count(); assert.equal(leaked, 0, 'preview markup must not leak as a body-level node'); const signatureStyles = async () => p.evaluate(() => { const host = document.querySelector('#previewSurface'); if (!host.shadowRoot) throw new Error('Preview must use a ShadowRoot'); const doc = host.shadowRoot.querySelector('table'); if (!doc || document.querySelector('#previewSurface table')) throw new Error('Signature escaped ShadowRoot'); const s = getComputedStyle(doc); return { color:s.color, font:s.font, background:s.backgroundColor, html:doc.outerHTML }; }); const before = await signatureStyles(); await p.evaluate(() => document.getElementById('themeToggle').click()); assert.deepEqual(await signatureStyles(), before, 'Changing application theme must not change signature markup or computed typography'); await p.close(); results.flows.push('preview shadow styling isolation'); }
  // Self service including download response (fixture archive only).
  { const p = await authPage(context, 'self-service.html', 'selfservice'); await ready(p, '#selfIdentity .identity-main'); assert.match(await p.locator('#selfIdentity').innerText(), /Alex Example/); await p.locator('#selfSignatureChoices input[type=checkbox]').last().uncheck(); await p.click('#selfGenerateBtn'); await ready(p, '#selfResult:not([hidden])'); const download = p.waitForEvent('download'); await p.click('#selfDownloadBtn'); const d = await download; assert.match(d.suggestedFilename(), /fixture-signatures\.zip/); await setTheme(p,'light'); await screenshot(p, 'self-service', '1440', 'generated-download'); await setTheme(p,'dark'); await screenshot(p,'self-service','1440','generated-download-dark'); await setTheme(p,'light'); results.flows.push('self-service identity/selection/generation/download'); await p.close(); }
  // Admin navigation, wizard validation and save validation.
  { const p = await authPage(context, 'admin.html'); await ready(p, '.admin-nav'); assert.match(await p.locator('.signature-title').first().textContent(), /Standard|STANDARD/, 'Initial template headings must identify the configured signature'); for (const view of ['deployment','signatures','variables','access','onboarding','system','overview']) { await p.click(`[data-admin-view="${view}"]`); assert.equal(await p.locator(`.admin-view[data-view="${view}"].active`).count(), 1); } await p.click('[data-admin-view="signatures"]'); await p.locator('.signature-editor > summary').first().click(); await setTheme(p,'light'); await screenshot(p,'admin','1440','template-editor'); await setTheme(p,'dark'); await screenshot(p,'admin','1440','template-editor-dark'); await setTheme(p,'light'); await p.locator('.signature-editor > summary').first().click(); await p.click('#addSignatureBtn'); await p.click('#submitSignatureCreateBtn'); assert.equal(await p.locator('#newSignatureKey:invalid').count(), 1, 'wizard required key should validate'); await p.click('[data-admin-view="variables"]'); await p.locator('.variable-editor > summary').first().click(); await screenshot(p,'admin','1440','variable-editor'); await setTheme(p,'dark'); await screenshot(p,'admin','1440','variable-editor-dark'); await setTheme(p,'light'); await p.click('#addVariableBtn'); await p.click('#saveProfileBtn'); await p.waitForFunction(() => document.querySelector('#saveStatus').textContent.includes('.env gespeichert')); assert.ok(requests.some(r => r.key === 'PUT /api/v2/admin/env'), 'Save must submit the existing API contract'); assert.equal(await p.locator('#applyEnvConfigBtn').isVisible(),true,'Successful fixture save exposes activation action'); await p.click('[data-admin-view="signatures"]'); await screenshot(p, 'admin', '1440', 'wizard-validation'); results.flows.push('admin nav/signature wizard/variables/save validation'); await p.close(); }
  // Admin visual matrix and dirty save-bar geometry at the requested breakpoints.
  for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['900', { width: 900, height: 900 }], ['390', { width: 390, height: 844 }], ['320', { width: 320, height: 844 }]]) {
    const p = await authPage(context, 'admin.html', 'admin', viewport); await ready(p, '.admin-nav');
    await p.fill('#organizationName', 'Fixture Organization changed');
    assert.equal(await p.locator('#applyEnvConfigBtn').isVisible(), false, 'An unneeded activation action must stay hidden');
    const box = await p.locator('#profileSaveBar').boundingBox(); assert.ok(box, `save bar should be measurable at ${label}`); if (!(box.x >= 0 && box.x + box.width <= viewport.width + 1)) results.failures.push(`save bar cropped at ${label}: ${JSON.stringify(box)}`); const cardBox = await p.locator('.admin-view.active .step-card').first().boundingBox(); if (cardBox && box && box.y < cardBox.y + cardBox.height && box.y + box.height > cardBox.y) results.failures.push(`save bar overlaps active admin card at ${label}: bar=${JSON.stringify(box)} card=${JSON.stringify(cardBox)}`);
    for (const theme of ['light', 'dark']) { await p.evaluate(theme => { if (document.documentElement.dataset.theme !== theme) document.getElementById('themeToggle').click(); }, theme); for (const view of ['overview','deployment','signatures','variables','access','onboarding','system']) { await p.click(`[data-admin-view="${view}"]`); await p.waitForTimeout(30); results.screenshots.push(await screenshot(p, 'admin', `${label}-${theme}`, view)); } }
    await p.close();
  }
  // Login availability + validation, without typing passwords or credentials.
  { const p = await newSizedPage(context, { width: 390, height: 844 }); await p.addInitScript(() => localStorage.clear()); await p.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded' }); await ready(p, '#loginStatus'); await p.click('#loginForm button[type=submit]'); assert.match(await p.locator('#loginStatus').innerText(), /Benutzername und Passwort/); await screenshot(p, 'login', '390', 'empty-validation'); await p.goto(`${BASE}/login.html?fixture=down`, { waitUntil: 'domcontentloaded' }); await ready(p, '#loginStatus'); await p.waitForTimeout(250); assert.match(await p.locator('#loginStatus').innerText(), /nicht erreichbar|Backend/); await setTheme(p,'dark'); await screenshot(p,'login','390','unavailable-dark'); results.flows.push('login availability/empty validation/unavailable error'); await p.close(); }
  // Theme + responsive + keyboard focus assertions.
  { const p = await authPage(context, 'index.html', 'admin', { width: 390, height: 844 }); await p.evaluate(() => document.documentElement.dataset.theme = 'dark'); assert.equal(await p.locator('html').getAttribute('data-theme'), 'dark'); await p.locator('.skip-link').focus(); assert.equal(await p.locator('.skip-link').evaluate(e => getComputedStyle(e).outlineStyle), 'solid'); await p.keyboard.press('Enter'); assert.equal(await p.evaluate(() => document.activeElement.id), 'main-content'); assert.equal(await p.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),true); assert.equal(await p.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length),0); await p.close(); results.flows.push('dark/light keyboard/reduced-motion responsive'); }
  const bad = requests.filter(r => !allowedApi.has(r.key) && r.path !== '/health'); assert.deepEqual(bad, [], `unexpected API requests: ${JSON.stringify(bad)}`); assert.equal(pageErrors.filter(x => !x.includes('favicon')).length, 0, `page errors: ${pageErrors.join('\n')}`);
  results.screenshots = fs.readdirSync(path.join(ARTIFACTS, PHASE)).filter(name => name.endsWith('.png')).sort().map(name => path.join(ARTIFACTS, PHASE, name));
  results.requests = requests; results.pageErrors = pageErrors; results.consoleErrors = consoleErrors; fs.writeFileSync(path.join(ARTIFACTS, PHASE, 'summary.json'), JSON.stringify(results, null, 2));
  await browser.close(); await new Promise(resolve => srv.close(resolve));
  console.log(JSON.stringify({ phase: PHASE, flows: results.flows, failures: results.failures, screenshots: results.screenshots.length, apiRequests: requests.length, pageErrors, consoleErrors }, null, 2));
  assert.deepEqual(results.failures, [], 'No layout findings may remain in a passing run');
}
run().catch(error => { console.error(error.stack || error); process.exit(1); });
