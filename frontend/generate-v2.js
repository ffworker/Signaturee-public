const API_TOKEN_STORAGE_KEY = 'signaturee.apiToken';
const API_BASE_STORAGE_KEY = 'signaturee.apiBase';
const REQUEST_TIMEOUT_MS = 5000;

const byId = (id) => document.getElementById(id);
const connectionBadge = byId('connectionBadge');
const connectionPanel = byId('connectionPanel');
const connectionTitle = byId('connectionTitle');
const connectionMessage = byId('connectionMessage');
const connectionApiBase = byId('connectionApiBase');
const retryConnectionBtn = byId('retryConnectionBtn');
const searchForm = byId('adSearchForm');
const searchInput = byId('adSearchInput');
const searchStatus = byId('searchStatus');
const searchResults = byId('searchResults');
const bulkIdentifiers = byId('bulkIdentifiers');
const addBulkBtn = byId('addBulkBtn');
const worklistCsv = byId('worklistCsv');
const bulkStatus = byId('bulkStatus');
const selectedUsersEl = byId('selectedUsers');
const selectedCount = byId('selectedCount');
const preflightBtn = byId('preflightBtn');
const preflightHint = byId('preflightHint');
const preflightPanel = byId('preflightPanel');
const generateBtn = byId('generateBtn');
const runSummary = byId('runSummary');
const runTargetSummary = byId('runTargetSummary');
const runResult = byId('runResult');
const runResultSummary = byId('runResultSummary');
const runTechnicalLog = byId('runTechnicalLog');
const runResultPaths = byId('runResultPaths');
const runStateIcon = byId('runStateIcon');
const runStateTitle = byId('runStateTitle');
const runProgress = byId('runProgress');
const runProgressLabel = byId('runProgressLabel');
const runTechnicalDetails = byId('runTechnicalDetails');
const previewStep = byId('previewStep');
const previewSelect = byId('previewSelect');
const previewBtn = byId('previewBtn');
const previewStatus = byId('previewStatus');
const previewResult = byId('previewResult');
const previewSurface = byId('previewSurface');
const previewVariables = byId('previewVariables');
const previewText = byId('previewText');
const previewTitle = byId('previewTitle');
const previewSubtitle = byId('previewSubtitle');
const previewUnresolved = byId('previewUnresolved');
const adminLink = byId('adminLink');
const logoutBtn = byId('logoutBtn');

const selected = new Map();
const signatureSelections = new Map();
const signatureCatalog = new Map();
let lastPlan = null;
let activeApiBase = '';
let currentRole = '';


function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function normalizeBase(value) {
  return String(value || '').trim().replace(/\/$/, '');
}
function sameOriginDefault() {
  return ['http:', 'https:'].includes(location.protocol) ? normalizeBase(location.origin) : '';
}
function sameHostDefault() {
  const protocol = ['http:', 'https:'].includes(location.protocol) ? location.protocol : 'http:';
  const host = location.hostname || 'localhost';
  return `${protocol}//${host}:3001`;
}
function runtimeApiBase() {
  const runtime = globalThis.__SIGNATUREE_RUNTIME__ || globalThis.SIGNATUREE_RUNTIME || {};
  return normalizeBase(runtime.apiBase || runtime.backendBase || '');
}
function normalizeSavedForCurrentHost(value) {
  const base = normalizeBase(value);
  if (!base) return '';
  try {
    const url = new URL(base);
    const pageHost = String(location.hostname || '').toLowerCase();
    if (pageHost && !['localhost','127.0.0.1','::1'].includes(pageHost) && ['localhost','127.0.0.1','::1'].includes(url.hostname.toLowerCase())) {
      url.hostname = location.hostname;
      return normalizeBase(url.href);
    }
  } catch {}
  return base;
}
function apiCandidates() {
  const values = [
    runtimeApiBase(),
    sameOriginDefault(),
    sameHostDefault(),
    normalizeSavedForCurrentHost(safeStorageGet(API_BASE_STORAGE_KEY)),
  ].filter(Boolean);
  return [...new Set(values.map(normalizeBase))];
}
function apiUrl(path) {
  if (!activeApiBase) throw new Error('Backend ist nicht verbunden.');
  return `${activeApiBase}${path}`;
}
const nativeFetch = window.fetch.bind(window);
async function authenticatedFetch(input, init = {}) {
  const token = String(safeStorageGet(API_TOKEN_STORAGE_KEY) || '').trim();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return nativeFetch(input, { ...init, headers });
}
async function fetchWithTimeout(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await authenticatedFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function parseResponse(res) {
  const text = await res.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { body = { error: text }; }
  }
  return { ok: res.ok, status: res.status, body };
}
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function describeConnectionError(error) {
  if (error?.name === 'AbortError') return 'Zeitüberschreitung beim Healthcheck.';
  if (error?.name === 'TypeError') return 'Netzwerk/CORS-Verbindung fehlgeschlagen.';
  return error?.message || 'Unbekannter Verbindungsfehler.';
}
function showConnectionProblem(message, bases = []) {
  connectionBadge.textContent = 'Backend nicht erreichbar';
  connectionPanel.hidden = false;
  connectionPanel.className = 'connection-panel';
  connectionTitle.textContent = 'Backend nicht erreichbar';
  connectionMessage.textContent = message;
  connectionApiBase.textContent = bases.length ? `Geprüft: ${bases.join(' · ')}` : '';
}
function showConnectionOk(base, label = 'Backend verbunden') {
  connectionBadge.textContent = label;
  connectionPanel.hidden = true;
  connectionApiBase.textContent = base;
}
async function discoverBackend() {
  const candidates = apiCandidates();
  connectionBadge.textContent = 'Backend wird gesucht ...';
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const response = await fetchWithTimeout(`${candidate}/health`, { headers: { Accept: 'application/json' } }, 3000);
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const body = await response.json().catch(() => ({}));
      if (body.status !== 'ok') {
        lastError = new Error('Healthcheck antwortet unerwartet.');
        continue;
      }
      activeApiBase = candidate;
      safeStorageSet(API_BASE_STORAGE_KEY, candidate);
      showConnectionOk(candidate, 'Backend verbunden');
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  activeApiBase = '';
  showConnectionProblem(
    `${describeConnectionError(lastError)} Prüfe, ob der Backend-Runner auf Port 3001 läuft.`,
    candidates
  );
  return false;
}
async function ensureSession() {
  if (!activeApiBase && !(await discoverBackend())) return false;
  try {
    const { ok, body } = await parseResponse(await fetchWithTimeout(apiUrl('/api/auth/me')));
    if (!ok) throw new Error(body.error || `HTTP ${body.status || ''}`);
    if (body.authRequired && !body.authenticated) {
      const login = new URL('login.html', location.href);
      login.searchParams.set('next', 'index.html');
      location.replace(login.href);
      return false;
    }
    const role = String(body.role || (body.authRequired ? '' : 'admin')).toLowerCase();
    currentRole = role;
    if (role === 'selfservice') {
      location.replace('self-service.html');
      return false;
    }
    const canOperate = ['admin', 'it', 'operator', 'user'].includes(role);
    if (body.authRequired && !canOperate) {
      location.replace('login.html');
      return false;
    }
    const isAdmin = role === 'admin';
    if (adminLink) adminLink.hidden = !isAdmin;
    const roleLabel = isAdmin ? 'Admin' : 'IT';
    showConnectionOk(activeApiBase, body.username ? `${body.username} · ${roleLabel}` : roleLabel);
    return true;
  } catch (error) {
    showConnectionProblem(describeConnectionError(error), [activeApiBase]);
    return false;
  }
}

function targetValue() {
  return document.querySelector('input[name="target"]:checked')?.value || 'Local';
}
function targetLabel() {
  return targetValue() === 'Network' ? 'Produktiv bereitstellen' : 'Server-Vorschau';
}
function setSearchStatus(message, kind = '') {
  searchStatus.textContent = message || '';
  searchStatus.className = `inline-status ${kind}`.trim();
}
function userDomains(user) {
  return Array.isArray(user?.domains) ? user.domains.filter(Boolean) : [];
}
function availableUserDomains(user) {
  const available = Array.isArray(user?.availableDomains) ? user.availableDomains.filter(Boolean) : [];
  return available.length ? available : userDomains(user);
}
function updateSignatureCatalog(items = []) {
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = String(item?.key || '').trim();
    if (!key) return;
    signatureCatalog.set(key.toLowerCase(), {
      key,
      label: String(item?.label || key).trim() || key,
      displayLabel: String(item?.displayLabel || '').trim() || key,
    });
  });
}
function signatureDisplayLabel(key) {
  return signatureCatalog.get(String(key || '').toLowerCase())?.displayLabel || String(key || '');
}
function ensureSignatureSelection(user) {
  const key = userKey(user?.id);
  const available = availableUserDomains(user);
  if (!key || !available.length) return null;
  if (!signatureSelections.has(key)) {
    signatureSelections.set(key, new Set(available));
  } else {
    const current = signatureSelections.get(key);
    const allowed = new Set(available.map((domain) => String(domain).toLowerCase()));
    [...current].forEach((domain) => {
      if (!allowed.has(String(domain).toLowerCase())) current.delete(domain);
    });
  }
  return signatureSelections.get(key);
}
function signatureSelectionPayload() {
  const payload = {};
  [...selected.values()].forEach((user) => {
    const available = availableUserDomains(user);
    if (!available.length) return;
    const chosen = ensureSignatureSelection(user);
    payload[user.id] = chosen ? [...chosen] : available;
  });
  return payload;
}
function userKey(value) {
  return String(value || '').trim().toLowerCase();
}
function setSelectedUser(user) {
  const id = String(user?.id || user?.mail || '').trim();
  if (!id) return false;
  const normalized = { ...user, id };
  selected.set(userKey(id), normalized);
  ensureSignatureSelection(normalized);
  return true;
}
function personMarkup(user, actionHtml) {
  const domains = userDomains(user);
  const domainHtml = domains.length
    ? domains.map((domain) => `<span class="domain-pill">${escapeHtml(domain)}</span>`).join('')
    : user.pending
      ? '<span class="domain-pill pending">Zuordnung wird im Preflight ermittelt</span>'
      : '<span class="domain-pill missing">Keine Signatur-Zuordnung</span>';
  const meta = [user.mail,user.department,user.description].filter(Boolean).map(escapeHtml).join(' · ');
  return `
    <div class="person-primary">
      <div class="person-name">${escapeHtml(user.displayName || user.id || 'Unbekannt')}</div>
      <div class="person-meta">${meta || escapeHtml(user.id || '')}</div>
      <div class="domain-row">${domainHtml}</div>
    </div>
    <div>${actionHtml}</div>`;
}
function setStatusTone(element,tone=''){
  if(!element)return;
  element.classList.remove('success','error','loading');
  if(['success','error','loading'].includes(tone))element.classList.add(tone);
}
function resetPreview() {
  if (previewStep) previewStep.hidden = true;
  if (previewResult) previewResult.hidden = true;
  if (previewStatus) { previewStatus.textContent = ''; setStatusTone(previewStatus); }
  if (previewSelect) previewSelect.innerHTML = '';
  if (previewSurface) {
    previewSurface.replaceChildren();
    previewSurface.shadowRoot?.replaceChildren();
  }
  if (previewVariables) previewVariables.innerHTML = '';
  if (previewText) previewText.textContent = '';
  if (previewUnresolved) {
    previewUnresolved.hidden = true;
    previewUnresolved.textContent = '';
  }
}

function populatePreviewOptions(plan) {
  if (!previewStep || !previewSelect) return;
  previewSelect.innerHTML = '';
  const options = [];
  (plan?.users || []).forEach((user) => {
    userDomains(user).forEach((signature) => {
      options.push({
        user: user.id,
        displayName: user.displayName || user.id,
        signature,
      });
    });
  });

  options.forEach((item) => {
    const option = document.createElement('option');
    option.value = JSON.stringify({ user:item.user, signature:item.signature });
    option.textContent = `${item.displayName} — ${signatureDisplayLabel(item.signature)}`;
    previewSelect.appendChild(option);
  });

  previewStep.hidden = !plan?.ok || !options.length;
  previewBtn.disabled = !plan?.ok || !options.length;
  previewStatus.textContent = options.length
    ? `${options.length} Vorschau${options.length===1?'':'en'} verfügbar.`
    : 'Keine Signatur für eine Vorschau verfügbar.';
  setStatusTone(previewStatus);
}

function renderPreviewDocument(html) {
  const content=String(html||'').trim();
  previewSurface.replaceChildren();
  const shadow=previewSurface.shadowRoot||previewSurface.attachShadow({mode:'open'});
  shadow.replaceChildren();

  const parser=new DOMParser();
  const doc=parser.parseFromString(content||'<body></body>','text/html');
  doc.querySelectorAll('script,iframe,object,embed,form,input,button,base,meta[http-equiv]').forEach(node=>node.remove());
  doc.querySelectorAll('*').forEach(node=>{
    [...node.attributes].forEach(attr=>{
      const name=attr.name.toLowerCase();
      const value=String(attr.value||'').trim();
      if(name.startsWith('on'))node.removeAttribute(attr.name);
      if((name==='href'||name==='src'||name==='xlink:href')&&/^javascript:/i.test(value))node.removeAttribute(attr.name);
    });
  });

  const style=document.createElement('style');
  style.textContent=':host{display:block;background:#fff;color:#111;min-height:280px;padding:14px;overflow:auto}*{box-sizing:border-box}img{max-width:100%;height:auto}';
  shadow.appendChild(style);

  [...doc.querySelectorAll('style')].forEach(sourceStyle=>{
    const clone=document.createElement('style');
    clone.textContent=sourceStyle.textContent||'';
    shadow.appendChild(clone);
  });

  const wrapper=document.createElement('div');
  wrapper.innerHTML=doc.body?.innerHTML||content||'<span style="color:#888">Kein sichtbarer HTML-Inhalt.</span>';
  shadow.appendChild(wrapper);
}
function renderPreviewVariables(items = []) {
  previewVariables.innerHTML = '';
  const variables = Array.isArray(items) ? items : [];
  if (!variables.length) {
    previewVariables.innerHTML = '<div class="empty-state">Keine Variablen aufgelöst.</div>';
    return;
  }
  variables.forEach((item) => {
    const row = document.createElement('div');
    const value = String(item?.value || '');
    row.className = `preview-variable ${value ? '' : 'empty'}`;
    const placeholders = Array.isArray(item?.placeholders) ? item.placeholders.join(', ') : '';
    row.innerHTML = `
      <div class="preview-variable-head">
        <strong>${escapeHtml(item?.displayName || item?.id || 'Variable')}</strong>
        <code>${escapeHtml(placeholders || '')}</code>
      </div>
      <div class="preview-variable-value">${value ? escapeHtml(value) : 'leer'}</div>
      <div class="preview-variable-source">Quelle: ${escapeHtml(item?.source || '—')}${item?.required ? ' · Pflichtfeld' : ''}</div>`;
    previewVariables.appendChild(row);
  });
}

async function loadPreview() {
  if (!lastPlan?.ok || !previewSelect?.value || !(await ensureSession())) return;
  let selection;
  try {
    selection = JSON.parse(previewSelect.value);
  } catch {
    previewStatus.textContent = 'Ungültige Vorschau-Auswahl.';
    setStatusTone(previewStatus,'error');
    return;
  }

  previewBtn.disabled = true;
  previewBtn.textContent = 'Vorschau wird gerendert ...';
  previewStatus.textContent = 'Der echte Generator rendert temporär ...';
  setStatusTone(previewStatus,'loading');
  previewResult.hidden = true;

  try {
    const { ok, status, body } = await parseResponse(await fetchWithTimeout(apiUrl('/api/run/preview'), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(selection),
    }, 120000));
    if (!ok) throw new Error(body.error || `HTTP ${status}`);

    previewTitle.textContent = body.signature?.displayLabel || body.signature?.key || 'Signaturvorschau';
    previewSubtitle.textContent = `${body.user?.displayName || body.user?.id || ''} · ${body.user?.mail || ''}`;
    renderPreviewDocument(body.html || '');
    previewText.textContent = String(body.text || '');
    renderPreviewVariables(body.resolvedVariables || []);

    const unresolved = Array.isArray(body.unresolvedPlaceholders) ? body.unresolvedPlaceholders : [];
    if (unresolved.length) {
      previewUnresolved.hidden = false;
      previewUnresolved.innerHTML = `Noch nicht ersetzte Platzhalter: <strong>${unresolved.map(escapeHtml).join(', ')}</strong>`;
    } else {
      previewUnresolved.hidden = true;
      previewUnresolved.textContent = '';
    }

    previewResult.hidden = false;
    previewStatus.textContent = 'Vorschau erfolgreich gerendert.';
    setStatusTone(previewStatus,'success');
  } catch (error) {
    previewStatus.textContent = `Vorschau fehlgeschlagen: ${describeConnectionError(error)}`;
    setStatusTone(previewStatus,'error');
  } finally {
    previewBtn.disabled = !lastPlan?.ok;
    previewBtn.textContent = 'Vorschau rendern';
  }
}

previewBtn?.addEventListener('click', loadPreview);

function invalidatePreflight() {
  lastPlan = null;
  resetPreview();
  generateBtn.disabled = true;
  preflightPanel.className = 'preflight-panel empty-state';
  preflightPanel.textContent = 'Auswahl geändert. Preflight erneut durchführen.';
  setStatusTone(preflightHint);
  updateControls();
}
function updateControls() {
  const count = selected.size;
  selectedCount.textContent = `${count} ${count === 1 ? 'Person' : 'Personen'}`;
  preflightBtn.disabled = count === 0 || !activeApiBase;
  preflightHint.textContent = count ? 'Bereit für die technische Prüfung.' : 'Wähle mindestens eine Person.';
  runSummary.textContent = count ? `${count} ${count === 1 ? 'Person' : 'Personen'} ausgewählt` : '0 Personen ausgewählt';
  runTargetSummary.textContent = targetLabel();
  if (!lastPlan?.ok) generateBtn.disabled = true;
}
function renderSelected() {
  selectedUsersEl.innerHTML = '';
  if (!selected.size) {
    selectedUsersEl.className = 'selected-list empty-state';
    selectedUsersEl.textContent = 'Noch keine Person ausgewählt.';
    updateControls();
    return;
  }
  selectedUsersEl.className = 'selected-list';
  [...selected.values()].forEach((user) => {
    const row = document.createElement('div');
    row.className = 'person-row selected-person-row';
    row.innerHTML = personMarkup(user, '<button type="button" class="danger remove-person">Entfernen</button>');
    row.querySelector('.remove-person').addEventListener('click', () => {
      const key = userKey(user.id);
      selected.delete(key);
      signatureSelections.delete(key);
      invalidatePreflight();
      renderSelected();
      renderSearchResults(window.__lastSearchResults || []);
    });

    const available = availableUserDomains(user);
    if (available.length) {
      const chosen = ensureSignatureSelection(user);
      const selector = document.createElement('div');
      selector.className = 'signature-selector';
      selector.innerHTML = `
        <div class="signature-selector-heading">
          <strong>Signaturen für diesen Lauf</strong>
          <span class="muted">Alle sind standardmäßig ausgewählt.</span>
        </div>
        <div class="signature-choice-list">
          ${available.map((domain) => {
            const checked = chosen?.has(domain) ? 'checked' : '';
            return `<label class="signature-choice">
              <input type="checkbox" value="${escapeHtml(domain)}" ${checked}>
              <span>${escapeHtml(signatureDisplayLabel(domain))}</span>
            </label>`;
          }).join('')}
        </div>`;
      selector.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const current = ensureSignatureSelection(user);
          if (checkbox.checked) current.add(checkbox.value);
          else current.delete(checkbox.value);
          invalidatePreflight();
        });
      });
      row.appendChild(selector);
    }
    selectedUsersEl.appendChild(row);
  });
  updateControls();
}
function renderSearchResults(users) {
  window.__lastSearchResults = users;
  searchResults.innerHTML = '';
  if (!users.length) {
    searchResults.className = 'result-list empty-state';
    searchResults.textContent = 'Keine Treffer.';
    return;
  }
  searchResults.className = 'result-list';
  users.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'person-row';
    const already = selected.has(userKey(user.id));
    row.innerHTML = personMarkup(
      user,
      `<button type="button" class="${already ? 'secondary' : ''}" ${already ? 'disabled' : ''}>${already ? 'Ausgewählt' : 'Hinzufügen'}</button>`
    );
    if (!already) {
      row.querySelector('button').addEventListener('click', () => {
        setSelectedUser(user);
        invalidatePreflight();
        renderSelected();
        renderSearchResults(users);
      });
    }
    searchResults.appendChild(row);
  });
}

function addWorklistIdentifiers(values) {
  let added = 0;
  let duplicates = 0;
  values.forEach((raw) => {
    const id = String(raw || '').trim();
    if (!id) return;
    const key = userKey(id);
    if (selected.has(key)) {
      duplicates += 1;
      return;
    }
    setSelectedUser({
      id,
      displayName: id,
      mail: id.includes('@') ? id : '',
      domains: [],
      pending: true,
    });
    added += 1;
  });
  if (added) {
    invalidatePreflight();
    renderSelected();
  }
  bulkStatus.textContent = `${added} hinzugefügt${duplicates ? `, ${duplicates} bereits vorhanden` : ''}.`;
  bulkStatus.className = 'inline-status success';
}

function parsePastedIdentifiers(raw) {
  return String(raw || '')
    .split(/[\r\n;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function identifiersFromFileText(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const first = parseCsvLine(lines[0]);
  const normalized = first.map((value) => value.trim().toLowerCase());
  const preferred = ['samaccountname','mail','email','userprincipalname','username','user'];
  let column = preferred.map((name) => normalized.indexOf(name)).find((index) => index >= 0);
  let start = 1;
  if (column === undefined) {
    column = 0;
    start = 0;
  }
  return lines.slice(start)
    .map((line) => parseCsvLine(line)[column] || '')
    .map((value) => value.trim())
    .filter(Boolean);
}

addBulkBtn.addEventListener('click', () => {
  const values = parsePastedIdentifiers(bulkIdentifiers.value);
  if (!values.length) {
    bulkStatus.textContent = 'Keine Benutzer oder Mailadressen erkannt.';
    bulkStatus.className = 'inline-status error';
    return;
  }
  addWorklistIdentifiers(values);
  bulkIdentifiers.value = '';
});

worklistCsv.addEventListener('change', async () => {
  const file = worklistCsv.files?.[0];
  if (!file) return;
  try {
    const values = identifiersFromFileText(await file.text());
    if (!values.length) throw new Error('Keine verwertbare Benutzer-Spalte gefunden.');
    addWorklistIdentifiers(values);
  } catch (error) {
    bulkStatus.textContent = error.message;
    bulkStatus.className = 'inline-status error';
  } finally {
    worklistCsv.value = '';
  }
});

function syncSelectedFromPlan(plan) {
  updateSignatureCatalog(plan?.signatureCatalog || []);
  const users = Array.isArray(plan?.users) ? plan.users : [];
  users.forEach((user) => {
    const original = [...selected.values()].find((entry) =>
      userKey(entry.id) === userKey(user.id)
      || (entry.mail && user.mail && userKey(entry.mail) === userKey(user.mail))
    );
    let previousSelection = null;
    if (original) {
      const oldKey = userKey(original.id);
      previousSelection = signatureSelections.get(oldKey) || null;
      selected.delete(oldKey);
      signatureSelections.delete(oldKey);
    }
    setSelectedUser({ ...user, pending: false });
    if (previousSelection) {
      const available = availableUserDomains(user);
      const allowed = new Map(available.map((domain) => [String(domain).toLowerCase(), domain]));
      const preserved = new Set();
      previousSelection.forEach((domain) => {
        const actual = allowed.get(String(domain).toLowerCase());
        if (actual) preserved.add(actual);
      });
      signatureSelections.set(userKey(user.id), preserved);
    }
  });
  renderSelected();
}

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!(await ensureSession())) return;
  const query = searchInput.value.trim();
  if (query.length < 2) {
    setSearchStatus('Bitte mindestens 2 Zeichen eingeben.','error');
    return;
  }
  setSearchStatus('Active Directory wird durchsucht ...');
  searchResults.innerHTML = '';
  try {
    const params = new URLSearchParams({ search: query, limit: '25' });
    const { ok, body, status } = await parseResponse(await fetchWithTimeout(apiUrl(`/api/users/ad?${params.toString()}`), {}, 15000));
    if (!ok) throw new Error(body.error || `HTTP ${status}`);
    const users = Array.isArray(body.users) ? body.users : [];
    updateSignatureCatalog(body.signatureCatalog || []);
    renderSearchResults(users);
    setSearchStatus(`${users.length} Treffer gefunden.`, users.length ? 'success' : '');
  } catch (error) {
    setSearchStatus(`AD-Suche fehlgeschlagen: ${describeConnectionError(error)}`,'error');
  }
});

document.querySelectorAll('input[name="target"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    invalidatePreflight();
    updateControls();
  });
});

function renderPlan(plan) {
  preflightPanel.className = 'preflight-panel compact-preflight';
  const targetPath = plan.target?.path || 'Nicht aufgelöst';
  const people = Array.isArray(plan.users) ? plan.users : [];
  const issues = Array.isArray(plan.issues) ? plan.issues : [];
  const checks = Array.isArray(plan.templateChecks) ? plan.templateChecks : [];

  const byDomain = new Map();
  checks.forEach((check) => {
    const key = String(check.domain || '').trim();
    if (!key) return;
    if (!byDomain.has(key)) byDomain.set(key, []);
    byDomain.get(key).push(check);
  });

  const signatureChips = [...byDomain.entries()].map(([domain, items]) => {
    const bad = items.some((item) => !item.ok && item.level === 'error');
    const warning = !bad && items.some((item) => !item.ok);
    const cls = bad ? 'bad' : warning ? 'warn' : 'ok';
    const mark = bad ? '!' : warning ? '•' : '✓';
    return `<span class="preflight-chip ${cls}">${mark} ${escapeHtml(signatureDisplayLabel(domain))}</span>`;
  }).join('');

  const userRows = people.map((user) => {
    const domains = userDomains(user);
    return `<div class="preflight-user-row"><strong>${escapeHtml(user.displayName || user.id)}</strong><span>${domains.map((domain) => escapeHtml(signatureDisplayLabel(domain))).join(' · ') || 'keine Signatur'}</span></div>`;
  }).join('');

  const issueRows = issues.map((issue) =>
    `<div class="check ${issue.level === 'error' ? 'error' : 'warning'}">! ${escapeHtml(issue.message)}</div>`
  ).join('');

  const technicalRows = checks.map((check) =>
    `<div class="preflight-tech-row ${check.ok ? 'ok' : (check.level || 'error')}"><span>${check.ok ? '✓' : '!'}</span><span>${escapeHtml(check.label)}</span></div>`
  ).join('');

  preflightPanel.innerHTML = `
    <div class="preflight-summary-line">
      <span><b>${people.length}</b> Person${people.length===1?'':'en'}</span>
      <span><b>${plan.signatureCount || 0}</b> Signaturen</span>
      <span class="preflight-overall ${plan.ok?'ok':'bad'}">${plan.ok?'✓ Bereit':'! Prüfen'}</span>
    </div>
    <div class="preflight-chip-row">${signatureChips || '<span class="muted">Keine Signaturen.</span>'}</div>
    <div class="preflight-user-list">${userRows}</div>
    ${issueRows ? `<div class="check-list">${issueRows}</div>` : ''}
    <details class="preflight-details">
      <summary>Technische Details · ${escapeHtml(targetPath)}</summary>
      <div class="preflight-tech-list">${technicalRows}</div>
    </details>`;

  runSummary.textContent = plan.ok ? `${people.length} Personen · ${plan.signatureCount} Signaturen` : 'Preflight enthält blockierende Fehler';
  runTargetSummary.textContent = plan.target?.label || targetLabel();
  generateBtn.disabled = !plan.ok;
  populatePreviewOptions(plan);
}
async function runPreflight() {
  if (!selected.size || !(await ensureSession())) return;
  preflightBtn.disabled = true;
  preflightHint.textContent = 'Prüfung läuft ...';
  setStatusTone(preflightHint,'loading');
  preflightPanel.className = 'preflight-panel empty-state';
  preflightPanel.textContent = 'AD-Zuordnung, Templates und Ziel werden geprüft ...';
  const payload = {
    users: [...selected.values()].map((user) => user.id),
    target: targetValue(),
    signatureSelection: signatureSelectionPayload(),
  };
  try {
    const { body } = await parseResponse(await fetchWithTimeout(apiUrl('/api/run/preflight'), {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    }, 30000));
    lastPlan = body;
    if (Array.isArray(body.users) && body.users.length) syncSelectedFromPlan(body);
    renderPlan(body);
    preflightHint.textContent = body.ok ? 'Preflight erfolgreich.' : 'Bitte blockierende Fehler beheben.';
    setStatusTone(preflightHint,body.ok?'success':'error');
  } catch (error) {
    lastPlan = null;
    resetPreview();
    generateBtn.disabled = true;
    preflightPanel.className = 'preflight-panel empty-state';
    preflightPanel.textContent = `Preflight fehlgeschlagen: ${describeConnectionError(error)}`;
    preflightHint.textContent = 'Preflight fehlgeschlagen.';
    setStatusTone(preflightHint,'error');
  } finally {
    updateControls();
  }
}
preflightBtn.addEventListener('click', runPreflight);

async function consumeGenerationStream(response, onEvent) {
  if (!response.ok) {
    const { body, status } = await parseResponse(response);
    throw new Error(body.error || `HTTP ${status}`);
  }
  if (!response.body?.getReader) {
    throw new Error('Live-Ausgabe wird vom Browser/Proxy nicht unterstützt.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let finished = false;
  const consumeLine = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    onEvent(event);
    if (event.type === 'error') {
      const error = new Error(event.error || 'Generierung fehlgeschlagen.');
      error.plan = event.plan;
      throw error;
    }
    if (event.type === 'done') finished = true;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) consumeLine(line);
      if (done) break;
    }
    if (pending.trim()) consumeLine(pending);
    if (!finished) throw new Error('Verbindung wurde vor dem Generierungsabschluss unterbrochen. Prüfe die Zielausgabe, bevor du erneut startest.');
  } finally {
    reader.releaseLock();
  }
}

// Render log fragments as text nodes: severity highlighting without interpreting log HTML.
function appendTerminalMessage(row, message) {
  const replacement = message.match(/^(Replaced(?:\s+\(TXT\))?\s+)(\$[A-Za-z_]\w*)(\s+with\s+)(.*)$/i);
  if (replacement) {
    const variable = document.createElement('span');
    variable.className = 'terminal-variable';
    variable.textContent = replacement[2];
    let value = replacement[4];
    let quote = '';
    if (value.length >= 2 && (value[0] === "'" || value[0] === '"') && value.at(-1) === value[0]) {
      quote = value[0];
      value = value.slice(1, -1);
    }
    const resolved = document.createElement('span');
    resolved.className = 'terminal-replacement';
    resolved.textContent = value;
    row.append(document.createTextNode(replacement[1]), variable, document.createTextNode(replacement[3]));
    if (quote) row.append(document.createTextNode(quote));
    row.append(resolved);
    if (quote) row.append(document.createTextNode(quote));
    return;
  }

  // Highlight variables in diagnostic lines too, but leave their wording untouched.
  let offset = 0;
  for (const match of message.matchAll(/\$[A-Za-z_]\w*/g)) {
    if (match.index > offset) row.append(document.createTextNode(message.slice(offset, match.index)));
    const variable = document.createElement('span');
    variable.className = 'terminal-variable';
    variable.textContent = match[0];
    row.append(variable);
    offset = match.index + match[0].length;
  }
  if (offset === 0) row.append(document.createTextNode(message));
  else if (offset < message.length) row.append(document.createTextNode(message.slice(offset)));
}

function appendTerminalLogLine(target, line, channel) {
  const row = document.createElement('span');
  row.className = 'terminal-line' + (channel === 'stderr' ? ' terminal-line-stderr' : '');
  const match = line.match(/^(\[\d{4}-\d\d-\d\d\s+\d\d:\d\d:\d\d\])\s+(\[(INFO|WARNING|ERROR|DEBUG)\])\s*(.*)$/i);
  if (match) {
    const timestamp = document.createElement('span');
    timestamp.className = 'terminal-timestamp';
    timestamp.textContent = match[1] + ' ';
    const badge = document.createElement('span');
    badge.className = 'terminal-level terminal-level-' + match[3].toLowerCase();
    badge.textContent = match[2];
    row.append(timestamp, badge, document.createTextNode(' '));
    appendTerminalMessage(row, match[4]);
  } else {
    const tagged = line.match(/^(\[(INFO|WARNING|ERROR|DEBUG)\])\s*(.*)$/i);
    if (tagged) {
      const badge = document.createElement('span');
      badge.className = 'terminal-level terminal-level-' + tagged[2].toLowerCase();
      badge.textContent = tagged[1];
      row.append(badge, document.createTextNode(' '));
      appendTerminalMessage(row, tagged[3]);
    } else {
      appendTerminalMessage(row, line);
    }
  }
  target.append(row, document.createTextNode('\n'));
}

function createTerminalLogWriter(target) {
  const pending = { stdout: '', stderr: '', system: '' };
  const write = (text, channel = 'stdout', flush = false) => {
    const kind = Object.hasOwn(pending, channel) ? channel : 'stdout';
    const lines = (pending[kind] + String(text || '')).split(/\r?\n/);
    pending[kind] = flush ? '' : lines.pop();
    if (flush && lines.at(-1) === '') lines.pop();
    for (const line of lines) appendTerminalLogLine(target, line, kind);
    target.scrollTop = target.scrollHeight;
  };
  return {
    write,
    flush: () => {
      for (const channel of Object.keys(pending)) write('', channel, true);
    },
  };
}

generateBtn.addEventListener('click', async () => {
  if (!lastPlan?.ok || !selected.size || !(await ensureSession())) return;
  const target = targetValue();
  if (target === 'Network') {
    const confirmed = window.confirm(
      `${lastPlan.signatureCount} Signaturen werden jetzt produktiv nach\n${lastPlan.target?.path || 'Netzwerkziel'}\ngeschrieben. Fortfahren?`
    );
    if (!confirmed) return;
  }
  const requestedCount = lastPlan.signatureCount;
  const completedSignatures = new Set();
  let stdoutRemainder = '';
  let totalSignatures = requestedCount;
  let activeSignature = '';
  const terminal = createTerminalLogWriter(runTechnicalLog);

  const updateProgress = (message = '') => {
    const count = completedSignatures.size;
    runProgress.max = Math.max(1, totalSignatures);
    runProgress.value = count;
    runProgressLabel.textContent = `${count} / ${totalSignatures} Signaturen erstellt`;
    runResultSummary.textContent = message || activeSignature ||
      (count === totalSignatures ? 'Alle Signaturen erstellt.' : 'Generierung läuft ...');
  };
  const scanLogLines = (text, flush = false) => {
    stdoutRemainder += text;
    const lines = stdoutRemainder.split(/\r?\n/);
    stdoutRemainder = flush ? '' : lines.pop();
    for (const line of lines) {
      const started = line.match(/Template loaded for (.+?) - (.+?)\. Length:/);
      if (started) activeSignature = `Erstelle ${started[2]} für ${started[1]} ...`;
      const success = line.match(/Created Outlook signatures for user (.+?) for domain (.+?)\s*$/);
      if (success) {
        completedSignatures.add(`${success[1].toLowerCase()}\u0000${success[2].toLowerCase()}`);
        activeSignature = `Zuletzt erstellt: ${success[2]} für ${success[1]}`;
      }
      if (started || success) updateProgress();
    }
  };
  const handleEvent = (event) => {
    if (event.type === 'status') {
      runResultSummary.textContent = event.message;
    } else if (event.type === 'started') {
      totalSignatures = event.plan?.signatureCount || requestedCount;
      updateProgress('Generator vorbereitet. Starte PowerShell ...');
    } else if (event.type === 'output') {
      const text = String(event.text || '');
      terminal.write(text, event.channel);
      if (event.channel === 'stdout') scanLogLines(text);
    } else if (event.type === 'done') {
      terminal.flush();
      scanLogLines('', true);
      lastPlan = event.plan;
      renderPlan(event.plan);
      runResult.dataset.state = 'success';
      runStateIcon.textContent = '✓';
      runStateTitle.textContent = 'Ergebnis';
      runResultSummary.textContent =
        `${event.plan.signatureCount} Signaturen für ${event.plan.users.length} Personen abgeschlossen.`;
      runProgress.value = runProgress.max = Math.max(1, event.plan.signatureCount);
      runProgressLabel.textContent = `${event.plan.signatureCount} / ${event.plan.signatureCount} abgeschlossen`;
      runResultPaths.innerHTML = event.plan.users.map((user) =>
        `<div class="result-path"><strong>${escapeHtml(user.displayName || user.id)}</strong><code>${escapeHtml(user.outputPath || event.plan.target?.path || '')}</code></div>`
      ).join('');
      if (!runTechnicalLog.textContent.trim()) runTechnicalLog.textContent = 'Keine technische Ausgabe.';
    }
  };

  generateBtn.disabled = true;
  preflightBtn.disabled = true;
  generateBtn.textContent = 'Generierung läuft ...';
  runResult.hidden = false;
  runResult.dataset.state = 'running';
  runStateIcon.textContent = '↻';
  runStateTitle.textContent = 'Signaturen werden generiert';
  runResultPaths.innerHTML = '';
  runTechnicalDetails.open = true;
  runTechnicalLog.replaceChildren();
  terminal.write('[Signaturee] Generierung angefordert. Warte auf Backend ...\n', 'system');
  runProgress.max = Math.max(1, requestedCount);
  runProgress.value = 0;
  updateProgress('Prüfe Benutzer, Zuordnungen und Zielpfad ...');
  const payload = {
    users:[...selected.values()].map((user) => user.id),
    target,
    signatureSelection: signatureSelectionPayload(),
  };
  try {
    const response = await fetchWithTimeout(apiUrl('/api/run/generate/stream'), {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    }, 120000);
    await consumeGenerationStream(response, handleEvent);
  } catch (error) {
    terminal.flush();
    if (error.plan) { lastPlan = error.plan; renderPlan(error.plan); }
    runResult.dataset.state = 'error';
    runStateIcon.textContent = '!';
    runStateTitle.textContent = 'Generierung fehlgeschlagen';
    runResultSummary.textContent = `Fehler: ${describeConnectionError(error)}`;
    runProgressLabel.textContent = `${completedSignatures.size} / ${totalSignatures} Signaturen erfolgreich erstellt`;
    if (!runTechnicalLog.textContent.includes(error.message)) {
      terminal.write(`[ERROR] ${error.message}\n`, 'system');
    }
  } finally {
    generateBtn.textContent = 'Signaturen generieren';
    generateBtn.disabled = !lastPlan?.ok;
    preflightBtn.disabled = !selected.size || !activeApiBase;
  }
});

async function logout() {
  try {
    if (activeApiBase) {
      await fetchWithTimeout(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }, 5000);
    }
  } catch {
    // Always clear the local session even if backend logout cannot be reached.
  }
  safeStorageSet(API_TOKEN_STORAGE_KEY, '');
  const login = new URL('login.html', location.href);
  login.searchParams.set('next', 'index.html');
  location.replace(login.href);
}

logoutBtn?.addEventListener('click', logout);

retryConnectionBtn.addEventListener('click', async () => {
  if (await discoverBackend()) {
    await ensureSession();
    updateControls();
  }
});

(async function bootstrap() {
  renderSelected();
  updateControls();
  const connected = await discoverBackend();
  if (connected && await ensureSession()) {
    updateControls();
  }
})();
