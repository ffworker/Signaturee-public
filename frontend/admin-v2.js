const API_TOKEN_STORAGE_KEY='signaturee.apiToken';
const API_BASE_STORAGE_KEY='signaturee.apiBase';
const byId=(id)=>document.getElementById(id);

const connectionBadge=byId('adminConnectionBadge'),connectionPanel=byId('adminConnectionPanel'),connectionMessage=byId('adminConnectionMessage'),connectionApiBase=byId('adminConnectionApiBase'),retryBtn=byId('adminRetryBtn'),adminLogoutBtn=byId('adminLogoutBtn');
const organizationName=byId('organizationName'),directoryServer=byId('directoryServer'),directorySearchBase=byId('directorySearchBase'),previewPath=byId('previewPath'),productionPath=byId('productionPath'),secondaryTitleAttributes=byId('secondaryTitleAttributes');
const signatureCards=byId('signatureCards'),variableCards=byId('variableCards'),variableSearch=byId('variableSearch'),requiredVariablesOnly=byId('requiredVariablesOnly'),variableFilterSummary=byId('variableFilterSummary'),templateStatus=byId('templateStatus'),addSignatureBtn=byId('addSignatureBtn'),addVariableBtn=byId('addVariableBtn'),reloadProfileBtn=byId('reloadProfileBtn'),saveProfileBtn=byId('saveProfileBtn'),saveSummary=byId('saveSummary'),saveStatus=byId('saveStatus'),profileSourceBadge=byId('profileSourceBadge'),profileSourceText=byId('profileSourceText'),signatureTemplate=byId('signatureCardTemplate');
const summarySignatureCount=byId('summarySignatureCount'),summaryVariableCount=byId('summaryVariableCount'),summaryGroupCount=byId('summaryGroupCount'),summaryTemplateState=byId('summaryTemplateState');
const authUserList=byId('authUserList'),refreshAuthUsersBtn=byId('refreshAuthUsersBtn'),createAuthUserForm=byId('createAuthUserForm'),newAuthUsername=byId('newAuthUsername'),newAuthDisplayName=byId('newAuthDisplayName'),newAuthRole=byId('newAuthRole'),newAuthPassword=byId('newAuthPassword'),createAuthUserStatus=byId('createAuthUserStatus'),ldapStatus=byId('ldapStatus'),ldapTestForm=byId('ldapTestForm'),ldapTestUsername=byId('ldapTestUsername'),ldapTestPassword=byId('ldapTestPassword'),ldapCredentialTestBtn=byId('ldapCredentialTestBtn'),ldapConfigTestBtn=byId('ldapConfigTestBtn'),ldapTestResult=byId('ldapTestResult');
const onboardingChecklist=byId('onboardingChecklist'),copyOnboardingBtn=byId('copyOnboardingBtn'),profileSaveBar=byId('profileSaveBar');
const serviceGrid=byId('serviceGrid'),taskList=byId('taskList'),refreshSystemBtn=byId('refreshSystemBtn'),restartBackendBtn=byId('restartBackendBtn'),restartFrontendBtn=byId('restartFrontendBtn'),systemActionStatus=byId('systemActionStatus');
const testPreviewPathBtn=byId('testPreviewPathBtn'),testProductionPathBtn=byId('testProductionPathBtn'),previewPathStatus=byId('previewPathStatus'),productionPathStatus=byId('productionPathStatus');
const ldapDomainConfig=byId('ldapDomainConfig'),ldapServerConfig=byId('ldapServerConfig'),ldapContainerConfig=byId('ldapContainerConfig'),ldapUpnSuffixConfig=byId('ldapUpnSuffixConfig'),signatureGroupPrefixConfig=byId('signatureGroupPrefixConfig'),signatureConventionSettings=byId('signatureConventionSettings'),applyEnvConfigBtn=byId('applyEnvConfigBtn');
const envPathEditor=byId('envPathEditor'),copyDeploymentEnvBtn=byId('copyDeploymentEnvBtn'),copyDeploymentEnvStatus=byId('copyDeploymentEnvStatus'),adSearchTestBtn=byId('adSearchTestBtn'),adSearchTestResult=byId('adSearchTestResult');

let apiBase='',currentStatus={},currentProfile=null,dirty=false,envManaged=false,envRevision='',baseVariableIds=new Set(),envEditable=false,envPendingRestart=false;

function safeGet(k){try{return localStorage.getItem(k)}catch{return null}}
function safeSet(k,v){try{localStorage.setItem(k,v)}catch{}}
function normalizeBase(v){return String(v||'').trim().replace(/\/$/,'')}
function runtimeBase(){const r=globalThis.__SIGNATUREE_RUNTIME__||globalThis.SIGNATUREE_RUNTIME||{};return normalizeBase(r.apiBase||r.backendBase||'')}
function candidateBases(){const protocol=['http:','https:'].includes(location.protocol)?location.protocol:'http:';const sameOrigin=['http:','https:'].includes(location.protocol)?normalizeBase(location.origin):'';const same=`${protocol}//${location.hostname||'localhost'}:3001`;let saved=normalizeBase(safeGet(API_BASE_STORAGE_KEY));try{const u=new URL(saved);if(!['localhost','127.0.0.1','::1'].includes(String(location.hostname).toLowerCase())&&['localhost','127.0.0.1','::1'].includes(u.hostname.toLowerCase())){u.hostname=location.hostname;saved=normalizeBase(u.href)}}catch{}return[...new Set([runtimeBase(),sameOrigin,same,saved].filter(Boolean))]}
async function fetchTimeout(url,init={},timeout=8000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);const token=String(safeGet(API_TOKEN_STORAGE_KEY)||'').trim();const h=new Headers(init.headers||{});if(token)h.set('Authorization',`Bearer ${token}`);try{return await fetch(url,{...init,headers:h,signal:c.signal})}finally{clearTimeout(t)}}
async function jsonResponse(r){const text=await r.text();let body={};if(text){try{body=JSON.parse(text)}catch{body={error:text}}}return{ok:r.ok,status:r.status,body}}
function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
async function connect(){for(const base of candidateBases()){try{const r=await fetchTimeout(`${base}/health`);if(!r.ok)continue;apiBase=base;safeSet(API_BASE_STORAGE_KEY,base);connectionBadge.textContent='Backend verbunden';connectionPanel.hidden=true;return true}catch{}}apiBase='';connectionBadge.textContent='Backend nicht erreichbar';connectionPanel.hidden=false;connectionMessage.textContent='Signaturee Backend auf Port 3001 konnte nicht erreicht werden.';connectionApiBase.textContent=candidateBases().join(' · ');return false}
async function ensureAdminSession(){if(!apiBase&&!(await connect()))return false;const{ok,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/auth/me`));if(!ok)return false;if(body.authRequired&&!body.authenticated){const u=new URL('login.html',location.href);u.searchParams.set('next','admin.html');location.replace(u.href);return false}const role=String(body.role||'').toLowerCase();if(body.authRequired&&role!=='admin'){location.replace(role==='selfservice'?'self-service.html':'index.html');return false}connectionBadge.textContent=body.username?`${body.username} · Admin`:'Admin';return true}
function splitList(v){return String(v||'').split(/[;,\n]/).map(x=>x.trim()).filter(Boolean)}
function updateSaveBarVisibility(){const active=document.querySelector('.admin-nav-item.active')?.dataset.adminView||'overview';const profileView=['overview','deployment','signatures','variables'].includes(active);profileSaveBar.hidden=!profileView&&!dirty}
function markDirty(){if(envManaged&&!envEditable)return;dirty=true;applyEnvConfigBtn.hidden=true;saveProfileBtn.disabled=false;saveStatus.textContent='Ungespeicherte Änderungen.';updateSaveBarVisibility()}
function markClean(message='Gespeichert.'){dirty=false;saveProfileBtn.disabled=true;saveStatus.textContent=message;updateSaveBarVisibility()}
function field(card,name){return card.querySelector(`[data-field="${name}"]`)}

function switchView(name){document.querySelectorAll('.admin-nav-item').forEach(b=>b.classList.toggle('active',b.dataset.adminView===name));document.querySelectorAll('.admin-view').forEach(v=>v.classList.toggle('active',v.dataset.view===name));location.hash=name;updateSaveBarVisibility()}
document.querySelectorAll('.admin-nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.adminView)));

function addSignatureCard(key='',value={}){const card=signatureTemplate.content.firstElementChild.cloneNode(true);field(card,'key').value=key;field(card,'label').value=value.label||key;field(card,'adGroups').value=(value.adGroups||[]).join(', ');field(card,'templateHtml').value=value.templateHtml||'';field(card,'templateTxt').value=value.templateTxt||'';field(card,'resourceFolder').value=value.resourceFolder||'';field(card,'customTitleAttr').value=value.customTitleAttr||'';field(card,'faxFallback').value=value.faxFallback||'';card.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{card.querySelector('.signature-title').textContent=field(card,'key').value.trim()||'Neue Signatur';markDirty();renderOnboarding()}));card.querySelector('.remove-signature').addEventListener('click',()=>{card.remove();markDirty();renderOnboarding()});const upload=card.querySelector('[data-upload="templateFiles"]');upload.addEventListener('change',async()=>{const files=[...(upload.files||[])];if(!files.length)return;const status=card.querySelector('.asset-upload-status');status.textContent='Upload läuft ...';try{if(!(await ensureAdminSession()))return;const form=new FormData();files.forEach(file=>form.append('templates',file,file.name));const parsed=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/templates/import`,{method:'POST',body:form},30000));if(!parsed.ok)throw new Error(parsed.body.error||`HTTP ${parsed.status}`);if(!envManaged){files.forEach(file=>{const lower=file.name.toLowerCase();if(lower.endsWith('.txt'))field(card,'templateTxt').value=file.name;if(lower.endsWith('.htm')||lower.endsWith('.html'))field(card,'templateHtml').value=file.name});markDirty()}status.textContent=envManaged?`${files.length} Datei(en) hochgeladen. Dateinamen in .env prüfen.`:`${files.length} Datei(en) hochgeladen. Profil noch speichern.`}catch(error){status.textContent=`Upload fehlgeschlagen: ${error.message}`}finally{upload.value=''}});signatureCards.appendChild(card);return card}
function variableField(card,name){return card.querySelector(`[data-variable-field="${name}"]`)}
function variablePlaceholderPreview(card){
  const placeholders=splitList(variableField(card,'placeholders')?.value||'');
  const id=variableField(card,'id')?.value.trim()||'variable';
  return placeholders[0]||`$${id}`;
}
function variableAdPreview(card){
  const attrs=splitList(variableField(card,'adProperties')?.value||'');
  const id=variableField(card,'id')?.value.trim()||'AD-Feld';
  return attrs[0]||id;
}
function refreshVariableCard(card){
  const displayName=variableField(card,'displayName').value.trim()||variableField(card,'id').value.trim()||'Neue Variable';
  const placeholder=variablePlaceholderPreview(card);
  const adSource=variableAdPreview(card);
  const required=variableField(card,'required').checked;
  const title=card.querySelector('.variable-card-name');
  const code=card.querySelector('.variable-card-placeholder');
  const badge=card.querySelector('.variable-badge');
  const summary=card.querySelector('.variable-card-summary');
  if(title)title.textContent=displayName;
  if(code)code.textContent=placeholder;
  if(badge){
    badge.textContent=required?'Pflichtfeld':'Optional';
    badge.className=`variable-badge ${required?'required':''}`;
  }
  if(summary)summary.textContent=`${adSource} → ${placeholder}`;
  card.classList.toggle('required',required);
  applyVariableFilters();
}
function applyVariableFilters(){
  if(!variableCards)return;
  const query=String(variableSearch?.value||'').trim().toLowerCase();
  const requiredOnly=Boolean(requiredVariablesOnly?.checked);
  const cards=[...variableCards.querySelectorAll('.variable-card')];
  let shown=0;
  cards.forEach(card=>{
    const required=Boolean(variableField(card,'required')?.checked);
    const haystack=[
      variableField(card,'id')?.value,
      variableField(card,'displayName')?.value,
      variableField(card,'description')?.value,
      variableField(card,'adProperties')?.value,
      variableField(card,'placeholders')?.value,
      variableField(card,'csvHeader')?.value,
    ].join(' ').toLowerCase();
    const visible=(!query||haystack.includes(query))&&(!requiredOnly||required);
    card.hidden=!visible;
    if(visible)shown+=1;
  });
  if(variableFilterSummary){
    const requiredCount=cards.filter(card=>variableField(card,'required')?.checked).length;
    variableFilterSummary.textContent=`${shown} von ${cards.length} · ${requiredCount} Pflichtfelder`;
  }
}
function addVariableCard(value={}){
  const card=document.createElement('article');
  card.className='variable-card';
  card.__variableOriginal=JSON.parse(JSON.stringify(value||{}));
  const id=String(value.id||'').trim();
  const displayName=String(value.displayName||id||'').trim();
  const description=String(value.description||'').trim();
  const placeholders=Array.isArray(value.placeholders)&&value.placeholders.length?value.placeholders:[id?`$${id}`:''];
  const adProperties=Array.isArray(value.adProperties)&&value.adProperties.length?value.adProperties:[id||''];
  const csvHeader=String(value.csvHeader||'').trim();

  card.innerHTML=`
    <div class="variable-card-head">
      <div class="variable-card-title">
        <div class="variable-card-title-line">
          <h3 class="variable-card-name">${escapeHtml(displayName||'Neue Variable')}</h3>
          <code class="variable-card-placeholder">${escapeHtml(placeholders[0]||'$variable')}</code>
          <span class="variable-badge ${value.required?'required':''}">${value.required?'Pflichtfeld':'Optional'}</span>
        </div>
        <span class="variable-card-summary">${escapeHtml(adProperties[0]||id||'AD-Feld')} → ${escapeHtml(placeholders[0]||'$variable')}</span>
      </div>
    </div>

    <div class="variable-primary-settings">
      <label>Anzeigename
        <input data-variable-field="displayName" type="text" value="${escapeHtml(displayName)}" placeholder="z. B. E-Mail">
      </label>
      <label class="variable-required-toggle">
        <input data-variable-field="required" type="checkbox" ${value.required?'checked':''}>
        Muss im Preflight vorhanden sein
      </label>
    </div>

    <div class="variable-card-body">
      <label class="variable-map-block">
        <span>AD-Quelle</span>
        <input data-variable-field="adProperties" type="text" value="${escapeHtml(adProperties.filter(Boolean).join(', '))}" placeholder="mail, userPrincipalName">
        <small>Erster vorhandener Wert wird verwendet. Mehrere Felder = Fallback-Reihenfolge.</small>
      </label>
      <div class="variable-map-arrow">→</div>
      <label class="variable-map-block">
        <span>Template-Platzhalter</span>
        <input data-variable-field="placeholders" type="text" value="${escapeHtml(placeholders.filter(Boolean).join(', '))}" placeholder="$mail">
        <small>So wird der Wert in HTML-/TXT-Templates angesprochen.</small>
      </label>
    </div>

    <details class="variable-advanced">
      <summary>Erweitert</summary>
      <div class="variable-advanced-grid">
        <label>Interne ID
          <input data-variable-field="id" type="text" value="${escapeHtml(id)}" placeholder="mail">
        </label>
        <label>CSV-Header
          <input data-variable-field="csvHeader" type="text" value="${escapeHtml(csvHeader)}" placeholder="leer = interne ID">
        </label>
        <label class="wide">Beschreibung / Hinweis
          <input data-variable-field="description" type="text" value="${escapeHtml(description)}" placeholder="Optionaler Hinweis für Administratoren">
        </label>
      </div>
    </details>

    <div class="variable-remove-row">
      <button type="button" class="danger remove-variable">Variable entfernen</button>
    </div>`;

  card.querySelectorAll('input').forEach(input=>{
    input.addEventListener('input',()=>{refreshVariableCard(card);markDirty();renderOnboarding()});
    input.addEventListener('change',()=>{refreshVariableCard(card);markDirty();renderOnboarding()});
  });
  card.querySelector('.remove-variable').addEventListener('click',()=>{
    const name=variableField(card,'displayName').value.trim()||variableField(card,'id').value.trim()||'diese Variable';
    if(!window.confirm(`"${name}" wirklich entfernen?`))return;
    card.remove();
    markDirty();
    renderOnboarding();
    applyVariableFilters();
  });
  variableCards.appendChild(card);
  refreshVariableCard(card);
  return card;
}


function renderStatus(status={}){currentStatus=status;const map=new Map((status.signatureStatus||[]).map(item=>[String(item.key).toLowerCase(),item]));let okCount=0;signatureCards.querySelectorAll('.signature-card').forEach(card=>{const key=field(card,'key').value.trim();const state=map.get(key.toLowerCase());const health=card.querySelector('.signature-health');if(!state){health.textContent='Noch nicht geprüft';health.className='signature-health';return}const ok=state.html?.exists&&state.txt?.exists&&(!state.resources||state.resources.exists);if(ok)okCount++;health.textContent=ok?'Templates vollständig':'Template-Dateien prüfen';health.className=`signature-health ${ok?'ok':'bad'}`});const list=status.signatureStatus||[];if(!list.length){templateStatus.className='template-status empty-state';templateStatus.textContent='Keine Signaturen konfiguriert.'}else{templateStatus.className='template-status';templateStatus.innerHTML=list.map(item=>{const asset=(label,state)=>!state?`<span class="asset-state"><span class="health-dot unknown"></span>${label}: nicht verwendet</span>`:`<span class="asset-state"><span class="health-dot ${state.exists?'ok':'bad'}"></span>${label}: <code>${escapeHtml(state.path||'')}</code></span>`;return`<div class="template-status-row"><strong>${escapeHtml(item.key)}</strong>${asset('HTML',item.html)}${asset('TXT',item.txt)}${asset('Assets',item.resources)}</div>`}).join('')}summaryTemplateState.textContent=list.length?`${okCount}/${list.length} OK`:'–'}

function renderProfile(profile,status={}){currentProfile=profile;organizationName.value=profile.organization?.name||'';directoryServer.value=profile.directory?.server||'';directorySearchBase.value=profile.directory?.searchBase||'';previewPath.value=profile.targets?.preview?.path||'';productionPath.value=profile.targets?.production?.path||'';secondaryTitleAttributes.value=(profile.secondaryTitleAttributes||[]).join(', ');signatureCards.innerHTML='';Object.entries(profile.signatures||{}).forEach(([key,value])=>addSignatureCard(key,value));variableCards.innerHTML='';const variables=profile.variables?.variables||[];variables.forEach(addVariableCard);applyVariableFilters();renderStatus(status);summarySignatureCount.textContent=Object.keys(profile.signatures||{}).length;summaryVariableCount.textContent=variables.length;summaryGroupCount.textContent=Object.values(profile.signatures||{}).reduce((n,s)=>n+(s.adGroups||[]).length,0);saveSummary.textContent=`${Object.keys(profile.signatures||{}).length} Signaturen · ${variables.length} Variablen`;markClean(envManaged?'Konfiguration aus .env (nur lesbar). Änderungen an .env erfordern einen Backend-Neustart.':'Profil geladen.');
  // Local accounts and template uploads remain operational; all v2 profile
  // settings are read-only so the UI cannot diverge from the .env source.
  const readonlyInputs=[organizationName,directoryServer,directorySearchBase,secondaryTitleAttributes];
  readonlyInputs.forEach(el=>{el.disabled=envManaged&&!envEditable});
  // Paths may be drafted in the UI, but the only persistent source is .env.
  // No hidden database write and no automatic restart.
  previewPath.disabled=envManaged&&!envEditable;productionPath.disabled=envManaged&&!envEditable;
  envPathEditor.hidden=!envManaged;
  copyDeploymentEnvStatus.textContent='';

  signatureCards.querySelectorAll('input:not([type="file"]), select').forEach(el=>{el.disabled=envManaged});
  variableCards.querySelectorAll('input, select').forEach(el=>{el.disabled=envManaged&&!envEditable});
  signatureCards.querySelectorAll('.remove-signature').forEach(el=>{el.disabled=envManaged});
  variableCards.querySelectorAll('.remove-variable').forEach(el=>{
    const card=el.closest('.variable-card');
    const id=variableField(card,'id').value.trim().toLowerCase();
    const builtin=envManaged&&baseVariableIds.has(id);
    el.disabled=envManaged&&(!envEditable||builtin);
    if(builtin) {
      el.title='Standardvariable kann nicht entfernt werden.';
      variableField(card,'id').readOnly=true;
    }
  });
  addSignatureBtn.disabled=envManaged;
  addVariableBtn.disabled=envManaged&&!envEditable;
  saveProfileBtn.disabled=true;
  signatureConventionSettings.hidden=!envManaged;
  renderOnboarding()}
function collectProfile(){const signatures={},seen=new Set(),dupes=new Set();signatureCards.querySelectorAll('.signature-card').forEach(card=>{const key=field(card,'key').value.trim();if(!key)return;const low=key.toLowerCase();if(seen.has(low))dupes.add(key);seen.add(low);signatures[key]={label:field(card,'label').value.trim()||key,adGroups:splitList(field(card,'adGroups').value),templateHtml:field(card,'templateHtml').value.trim(),templateTxt:field(card,'templateTxt').value.trim(),resourceFolder:field(card,'resourceFolder').value.trim(),customTitleAttr:field(card,'customTitleAttr').value.trim(),faxFallback:field(card,'faxFallback').value.trim()}});if(dupes.size)throw new Error(`Doppelte Signatur-Schlüssel: ${[...dupes].join(', ')}`);const variables=[];variableCards.querySelectorAll('.variable-card').forEach(card=>{const id=variableField(card,'id').value.trim();if(!id)return;const original=card.__variableOriginal&&typeof card.__variableOriginal==='object'?card.__variableOriginal:{};const item={...original,id,displayName:variableField(card,'displayName').value.trim()||id,required:variableField(card,'required').checked,adProperties:splitList(variableField(card,'adProperties').value),placeholders:splitList(variableField(card,'placeholders').value)};const csv=variableField(card,'csvHeader').value.trim();if(csv)item.csvHeader=csv;else delete item.csvHeader;const description=variableField(card,'description').value.trim();if(description)item.description=description;else delete item.description;variables.push(item)});return{version:2,organization:{name:organizationName.value.trim()},directory:{server:directoryServer.value.trim(),searchBase:directorySearchBase.value.trim()},targets:{preview:{path:previewPath.value.trim()},production:{path:productionPath.value.trim()}},signatures,secondaryTitleAttributes:splitList(secondaryTitleAttributes.value),variables:{variables,ordering:variables.map(v=>v.id)}}}

async function loadAdminEnvSettings(){
  if(!envManaged)return;
  const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/admin/env`,{},12000));
  if(!ok){
    envEditable=false;
    saveStatus.textContent=body.error||`Admin .env editor nicht verfügbar (HTTP ${status}).`;
    renderProfile(currentProfile,currentStatus);
    return;
  }
  envEditable=true;
  envRevision=body.revision;
  envPendingRestart=Boolean(body.requiresRestart);
  baseVariableIds=new Set((body.baseVariables||[]).map(v=>String(v.id).toLowerCase()));
  // Populate the on-disk values, rather than an in-memory profile that may
  // still reflect an older generation of the backend before restart.
  const val=body.values||{};
  for(const [el,key] of [
    [organizationName,'SIGNATUREE_ORGANIZATION_NAME'],
    [directoryServer,'AD_SERVER'],[directorySearchBase,'OU_SEARCH_BASE'],
    [secondaryTitleAttributes,'SIGNATUREE_SECONDARY_TITLE_ATTRIBUTES'],
    [previewPath,'LOCAL_DEPLOYMENT_PATH'],[productionPath,'NETWORK_DEPLOYMENT_PATH'],
    [ldapDomainConfig,'AUTH_LDAP_DOMAIN'],[ldapServerConfig,'AUTH_LDAP_SERVER'],
    [ldapContainerConfig,'AUTH_LDAP_CONTAINER'],[ldapUpnSuffixConfig,'AUTH_LDAP_UPN_SUFFIX'],
    [signatureGroupPrefixConfig,'SIGNATUREE_AUTO_GROUP_PREFIX'],
  ]){el.value=val[key]||'';el.disabled=false}
  signatureGroupPrefixConfig.value=val.SIGNATUREE_AUTO_GROUP_PREFIX||'Signature-';
  signatureConventionSettings.hidden=false;
  variableCards.innerHTML='';
  for(const variable of body.variables||[])addVariableCard(variable);
  variableCards.querySelectorAll('.variable-card').forEach(card=>{
    const builtin=baseVariableIds.has(variableField(card,'id').value.trim().toLowerCase());
    if(builtin){
      variableField(card,'id').readOnly=true;
      const remove=card.querySelector('.remove-variable');
      remove.disabled=true;
      remove.title='Standardvariable kann nicht entfernt werden.';
    }
  });
  addVariableBtn.disabled=false;
  markClean(envPendingRestart?'Die gespeicherte .env enthält noch nicht aktivierte Änderungen.':'Direkte .env-Bearbeitung bereit.');
  applyEnvConfigBtn.hidden=!envPendingRestart;
}
function collectEnvValues(){
  return{
    SIGNATUREE_ORGANIZATION_NAME:organizationName.value.trim(),
    AD_SERVER:directoryServer.value.trim(),
    OU_SEARCH_BASE:directorySearchBase.value.trim(),
    SIGNATUREE_SECONDARY_TITLE_ATTRIBUTES:secondaryTitleAttributes.value.trim(),
    LOCAL_DEPLOYMENT_PATH:previewPath.value.trim(),
    NETWORK_DEPLOYMENT_PATH:productionPath.value.trim(),
    AUTH_LDAP_DOMAIN:ldapDomainConfig.value.trim(),
    AUTH_LDAP_SERVER:ldapServerConfig.value.trim(),
    AUTH_LDAP_CONTAINER:ldapContainerConfig.value.trim(),
    AUTH_LDAP_UPN_SUFFIX:ldapUpnSuffixConfig.value.trim(),
    SIGNATUREE_AUTO_GROUP_PREFIX:signatureGroupPrefixConfig.value.trim(),
  };
}
async function saveEnvSettings(){
  if(!envEditable){saveStatus.textContent='Admin .env-Bearbeitung nicht verfügbar.';return}
  let variables;
  try{variables=collectProfile().variables.variables}
  catch(error){saveStatus.textContent=error.message;return}
  saveProfileBtn.disabled=true;
  saveStatus.textContent='Validiere und sichere .env ...';
  try{
    const {ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/admin/env`,{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({revision:envRevision,values:collectEnvValues(),variables})
    },28000));
    if(!ok)throw new Error(body.error||`HTTP ${status}`);
    envRevision=body.revision;
    envPendingRestart=true;
    markClean('.env gespeichert und Backup angelegt. Bitte Backend neu starten, um die Einstellungen zu aktivieren.');
    applyEnvConfigBtn.hidden=false;
  }catch(error){
    saveStatus.textContent='Speichern fehlgeschlagen: '+error.message;
    saveProfileBtn.disabled=false;
  }
}
async function applySavedEnv(){
  if(!confirm('Gespeicherte .env aktivieren? Der Backend-Dienst wird neu gestartet und bestehende Sitzungen können unterbrochen werden.'))return;
  applyEnvConfigBtn.disabled=true;
  saveStatus.textContent='Backend-Neustart wird ausgelöst ...';
  try{
    await fetchTimeout(`${apiBase}/api/runner/control`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'restart',scope:'backend'})
    },8000);
  }catch{} // The restarting backend may close the active HTTP connection.
  await new Promise(resolve=>setTimeout(resolve,2500));
  apiBase='';
  let active=false;
  for(let i=0;i<15;i++){
    try{
      if(await connect()){
        const status=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/admin/env`,{},6500));
        if(status.ok&&!status.body.requiresRestart){active=true;break}
      }
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(active){
    await loadProfile();
    await loadAdminEnvSettings();
    applyEnvConfigBtn.hidden=true;
    envPendingRestart=false;
    saveStatus.textContent='Backend neu gestartet. Die .env-Änderungen sind jetzt aktiv.';
  }else{
    saveStatus.textContent='Neustart nicht bestätigt oder alte .env weiterhin aktiv. Bitte auf dem Server scripts/reload-config.ps1 ausführen.';
    applyEnvConfigBtn.disabled=false;
  }
}
async function loadProfile(){if(!(await ensureAdminSession()))return;saveSummary.textContent='Profil wird geladen ...';const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/profile`,{},10000));if(!ok){saveSummary.textContent='Profil konnte nicht geladen werden';saveStatus.textContent=body.error||`HTTP ${status}`;return}envManaged=String(body.source||'').startsWith('environment');profileSourceBadge.textContent=body.source||'profile_v2';profileSourceText.textContent=envManaged?'Konfigurationsquelle: .env. Freigegebene Einstellungen kannst du hier mit Backup und Validierung bearbeiten. Änderungen werden nach Backend-Neustart aktiv.':'Konfigurationsquelle: profile_v2 in SQLite. Änderungen werden in der Datenbank gespeichert.';renderProfile(body.profile,body.status)}
async function saveProfile(){if(envManaged){return saveEnvSettings()}if(!(await ensureAdminSession()))return;let profile;try{profile=collectProfile()}catch(error){saveStatus.textContent=error.message;return}saveProfileBtn.disabled=true;saveStatus.textContent='Speichern und prüfen ...';const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/profile`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile})},15000));if(!ok){saveProfileBtn.disabled=false;const details=Array.isArray(body.errors)?body.errors.join(' · '):'';saveStatus.textContent=`${body.error||`HTTP ${status}`}${details?` — ${details}`:''}`;return}renderProfile(body.profile,body.status);saveStatus.textContent='Gespeichert. V2 verwendet ab jetzt genau diesen Stand.'}

function renderService(name,service){const ok=Boolean(service?.healthy);const detail=service?.statusCode?`HTTP ${service.statusCode} · ${service.responseMs??0} ms`:(service?.error||'nicht erreichbar');return `<div class="service-card"><span class="health-dot ${ok?'ok':'bad'}"></span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></div></div>`}
function renderSystem(snapshot={}){const services=snapshot.services||{};serviceGrid.innerHTML=[renderService('Backend',services.backend),renderService('Frontend',services.frontend)].join('');const tasks=Array.isArray(snapshot?.tasks?.tasks)?snapshot.tasks.tasks:[];if(!tasks.length){taskList.className='task-list empty-state';taskList.textContent=snapshot?.tasks?.reason||'Keine Task-Daten verfügbar.'}else{taskList.className='task-list';taskList.innerHTML=tasks.map(task=>`<div class="task-row"><span><strong>${escapeHtml(task.taskName)}</strong><br><small>Last result: ${escapeHtml(task.lastTaskResult??'--')}</small></span><span>${escapeHtml(task.state||'Unknown')}</span></div>`).join('')}}
async function loadSystemStatus(){if(!(await ensureAdminSession()))return;systemActionStatus.textContent='Status wird geladen ...';try{const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/runner/status`,{},12000));if(!ok)throw new Error(body.error||`HTTP ${status}`);renderSystem(body);systemActionStatus.textContent=body.summary?.healthy?'Alles läuft.':'Status geladen – Prüfung empfohlen.';systemActionStatus.className=`inline-status ${body.summary?.healthy?'success':''}`}catch(error){systemActionStatus.textContent=`Systemstatus: ${error.message}`;systemActionStatus.className='inline-status error'}}
async function runnerAction(scope){if(!(await ensureAdminSession()))return;systemActionStatus.textContent=`${scope} wird neu gestartet ...`;systemActionStatus.className='inline-status';try{const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/runner/control`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'restart',scope})},12000));if(!ok)throw new Error(body.error||`HTTP ${status}`);systemActionStatus.textContent=body.message||'Aktion ausgeführt.';systemActionStatus.className='inline-status success';if(scope==='backend'){apiBase='';setTimeout(async()=>{await connect();await loadSystemStatus()},3500)}else{setTimeout(loadSystemStatus,1200)}}catch(error){if(scope==='backend'){systemActionStatus.textContent='Backend-Restart ausgelöst; Verbindung wird erneut geprüft ...';setTimeout(async()=>{await connect();await loadSystemStatus()},3500);return}systemActionStatus.textContent=error.message;systemActionStatus.className='inline-status error'}}
async function checkDeploymentTarget(target){
  if(!(await ensureAdminSession()))return;
  const isProduction=target==='production';
  const statusEl=isProduction?productionPathStatus:previewPathStatus;
  const button=isProduction?testProductionPathBtn:testPreviewPathBtn;
  statusEl.textContent='Wird geprüft ...';
  statusEl.className='path-status muted';
  button.disabled=true;
  try{
    if(envManaged&&envPendingRestart){statusEl.textContent='Zuerst die gespeicherte .env aktivieren.';statusEl.className='path-status error';return}
    if(envManaged) {
      const actual=isProduction?currentProfile?.targets?.production?.path:currentProfile?.targets?.preview?.path;
      const drafted=(isProduction?productionPath:previewPath).value.trim();
      if(drafted!==String(actual||'').trim()){
        statusEl.textContent='Bitte die neuen Pfade erst in .env übernehmen und den Backend-Dienst neu laden. Bis dahin würde nur der alte Pfad geprüft.';
        statusEl.className='path-status error';
        return;
      }
    }
    if(dirty){
      statusEl.textContent='Bitte Konfiguration zuerst speichern, damit der gespeicherte Pfad geprüft wird.';
      statusEl.className='path-status error';
      return;
    }
    const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/targets/check`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({target})
    },15000));
    if(!ok)throw new Error(body.error||`HTTP ${status}`);
    if(body.exists&&body.directory&&body.writable&&(!isProduction||body.aclWritable)){
      statusEl.textContent=body.message||'✓ Erreichbar und schreibbar';
      statusEl.className='path-status success';
    }else{
      statusEl.textContent=`✗ ${body.error||'Pfad ist nicht schreibbar.'}${body.hint?' — '+body.hint:''}`;
      statusEl.className='path-status error';
    }
  }catch(error){
    statusEl.textContent=`✗ ${error.message}`;
    statusEl.className='path-status error';
  }finally{
    button.disabled=false;
  }
}

async function runAdSearchDiagnostic(){
  if(!(await ensureAdminSession()))return;
  adSearchTestBtn.disabled=true;
  adSearchTestResult.hidden=false;
  adSearchTestResult.className='ldap-test-result';
  adSearchTestResult.textContent='Prüfe Get-ADUser unter der effektiven Backend-Identität ...';
  try{
    const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/ad/test`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}',
    },30000));
    if(!ok)throw new Error(body.error||`HTTP ${status}`);
    adSearchTestResult.className=`ldap-test-result ${body.ok?'success':'error'}`;
    adSearchTestResult.textContent=[
      body.message||body.code,
      `Status: ${body.code||'unbekannt'}`,
      `Server: ${body.server||'(Windows-Standard)'} · Suchbasis: ${body.searchBase||'(ganze Domäne)'}`,
      `Ausführung: ${body.authMode==='dedicated-read-account'?'eigenes AD-Lesekonto':'Windows-Dienstidentität (bei SYSTEM: Computerkonto)'}`,
      body.hint||'',
    ].filter(Boolean).join('\n');
  }catch(e){
    adSearchTestResult.className='ldap-test-result error';
    adSearchTestResult.textContent='AD-Diagnose fehlgeschlagen: '+e.message;
  }finally{adSearchTestBtn.disabled=false}
}
adSearchTestBtn.addEventListener('click',runAdSearchDiagnostic);
copyDeploymentEnvBtn.addEventListener('click',async()=>{
  const local=previewPath.value.trim(),network=productionPath.value.trim();
  if(!local||!network||/[\r\n]/.test(local+network)){
    copyDeploymentEnvStatus.textContent='Beide Pfade müssen gesetzt sein (ohne Zeilenumbrüche).';return;
  }
  const snippet=`LOCAL_DEPLOYMENT_PATH=${local}\nNETWORK_DEPLOYMENT_PATH=${network}`;
  try{await navigator.clipboard.writeText(snippet);copyDeploymentEnvStatus.textContent='Kopiert! In .env ersetzen, speichern und reload-config.ps1 ausführen.'}
  catch{prompt('Diese Zeilen in .env übernehmen:',snippet);copyDeploymentEnvStatus.textContent='Einstellungen danach neu laden.'}
});
function authRoleLabel(role){return role==='admin'?'Admin':'IT'}

function renderLdap(system={}){
  const ldap=system.ldap||{};
  ldapStatus.className='ldap-status';
  ldapStatus.innerHTML=`<div class="ldap-grid">
    <div class="ldap-box"><small>Login</small><strong>${ldap.enabled?'Aktiv':'Deaktiviert'}</strong></div>
    <div class="ldap-box"><small>Server / Domäne</small><strong>${escapeHtml(ldap.server||ldap.domain||'Windows-Domänenkontext')}</strong></div>
    <div class="ldap-box"><small>Suchcontainer</small><strong>${escapeHtml(ldap.container||'Gesamte Domäne')}</strong></div>
    <div class="ldap-box"><small>UPN-Suffix</small><strong>${escapeHtml(ldap.upnSuffix||ldap.domain||'Windows-Standard')}</strong></div>
    <div class="ldap-box"><small>Rollenregeln</small><strong>${Number(ldap.roleRules||0)} konfiguriert</strong></div>
    <div class="ldap-box"><small>Standardrolle</small><strong>Self-Service</strong></div>
  </div>
  ${ldap.enabled?'':'<div class="check warning">Für AD-Login AUTH_LDAP_ENABLED=true setzen und Backend neu starten.</div>'}`;
}

async function runLdapDiagnostic(withCredentials){
  if(!(await ensureAdminSession()))return;
  if(withCredentials&&location.protocol!=='https:'&&!['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname.toLowerCase())){
    ldapTestResult.hidden=false;
    ldapTestResult.className='ldap-test-result error';
    ldapTestResult.textContent='Passworttests erfordern HTTPS oder localhost. Keine AD-Passwörter über unverschlüsseltes HTTP übertragen.';
    return;
  }
  const username=withCredentials?ldapTestUsername.value.trim():'';
  const password=withCredentials?ldapTestPassword.value:'';
  if(withCredentials&&(!username||!password)){
    ldapTestResult.hidden=false;
    ldapTestResult.className='ldap-test-result error';
    ldapTestResult.textContent='Bitte AD-Benutzername und Passwort eingeben.';
    return;
  }
  ldapTestResult.hidden=false;
  ldapTestResult.className='ldap-test-result';
  ldapTestResult.textContent=withCredentials?'Prüfe echte AD-Anmeldung ...':'Prüfe geladene LDAP-Konfiguration ...';
  ldapConfigTestBtn.disabled=true;
  ldapCredentialTestBtn.disabled=true;
  try{
    const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/auth/ldap/test`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password}),
    },33000));
    if(!ok)throw new Error(body.error||`HTTP ${status}`);
    ldapTestResult.className=`ldap-test-result ${body.ok?'success':'error'}`;
    const config=body.config;
    const lines=[body.message||body.code||'Keine Antwort',body.code?`Status: ${body.code}`:'',
      body.account?`AD-Account: ${body.account.username} · Rolle: ${body.account.role}`:'',
      config?`Server: ${config.server||'(Domänenkontext)'}, Domäne: ${config.domain||'(auto)'}, Container: ${config.container||'(keiner)'}, UPN-Suffix: ${config.upnSuffix||'(auto)'}`:'',
      body.hint||''].filter(Boolean);
    ldapTestResult.textContent=lines.join('\n');
  }catch(error){
    ldapTestResult.className='ldap-test-result error';
    ldapTestResult.textContent=`LDAP-Test fehlgeschlagen: ${error.message}`;
  }finally{
    ldapTestPassword.value='';
    ldapConfigTestBtn.disabled=false;
    ldapCredentialTestBtn.disabled=false;
  }
}
ldapTestForm.addEventListener('submit',(event)=>{event.preventDefault();runLdapDiagnostic(true)});
ldapConfigTestBtn.addEventListener('click',()=>runLdapDiagnostic(false));

function renderAuthUsers(users=[]){authUserList.className='auth-user-list';if(!users.length){authUserList.className='auth-user-list empty-state';authUserList.textContent='Noch keine lokalen Benutzer.';return}authUserList.innerHTML='';users.forEach(user=>{const row=document.createElement('div');row.className='auth-user-row';row.innerHTML=`<div class="auth-user-identity"><strong>${escapeHtml(user.username)}</strong><small>lokales Konto</small></div><input data-user-field="displayName" value="${escapeHtml(user.displayName||'')}" placeholder="Anzeigename"><select data-user-field="role"><option value="it" ${user.role==='it'||user.role==='operator'||user.role==='user'?'selected':''}>IT</option><option value="admin" ${user.role==='admin'?'selected':''}>Admin</option></select><label><input data-user-field="enabled" type="checkbox" ${user.enabled?'checked':''}> aktiv</label><input data-user-field="password" type="password" placeholder="neues Passwort (optional)"><div class="auth-user-actions"><button type="button" class="secondary" data-user-action="save">Speichern</button><button type="button" class="danger" data-user-action="delete">Löschen</button></div>`;row.querySelector('[data-user-action="save"]').addEventListener('click',async()=>{const payload={displayName:row.querySelector('[data-user-field="displayName"]').value.trim(),role:row.querySelector('[data-user-field="role"]').value,enabled:row.querySelector('[data-user-field="enabled"]').checked};const password=row.querySelector('[data-user-field="password"]').value;if(password)payload.password=password;const result=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/auth/users/${encodeURIComponent(user.username)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));if(!result.ok){alert(result.body.error||`HTTP ${result.status}`);return}await loadAuthUsers()});row.querySelector('[data-user-action="delete"]').addEventListener('click',async()=>{if(!confirm(`Lokalen Benutzer "${user.username}" wirklich löschen?`))return;const result=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/auth/users/${encodeURIComponent(user.username)}`,{method:'DELETE'}));if(!result.ok){alert(result.body.error||`HTTP ${result.status}`);return}await loadAuthUsers()});authUserList.appendChild(row)})}
async function loadAuthUsers(){if(!(await ensureAdminSession()))return;const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/auth/users`,{},10000));if(!ok){authUserList.className='auth-user-list empty-state';authUserList.textContent=body.error||`HTTP ${status}`;return}renderAuthUsers(body.users||[]);renderLdap(body.system||{})}

function currentProfileForChecklist(){try{return collectProfile()}catch{return currentProfile||{}}}
function onboardingText(profile){const signatures=profile.signatures||{},vars=profile.variables?.variables||[];const required=vars.filter(v=>v.required);const groups=[];Object.entries(signatures).forEach(([key,sig])=>(sig.adGroups||[]).forEach(g=>groups.push(`${g} → ${key}`)));const custom=Object.entries(signatures).filter(([,sig])=>sig.customTitleAttr).map(([key,sig])=>`${key}: ${sig.customTitleAttr}`);return[`Signaturee Onboarding – ${profile.organization?.name||''}`,'','Pflicht im AD:','- Benutzerkonto aktiviert','- sAMAccountName gesetzt',...required.map(v=>`- ${v.displayName||v.id}: ${(v.adProperties||[v.id]).join(' / ')}`),'','Signatur-Zuordnung:','- Mitgliedschaft in mindestens einer passenden Signaturgruppe',...groups.map(g=>`- ${g}`),...(custom.length?['','Signatur-spezifische Attribute:',...custom.map(x=>`- ${x}`)]:[]),'','Abschluss:','- Benutzer in Signaturee suchen','- Preflight muss grün sein'].join('\n')}
function renderOnboarding(){if(!onboardingChecklist)return;const profile=currentProfileForChecklist();const vars=profile.variables?.variables||[];const required=vars.filter(v=>v.required);const signatures=profile.signatures||{};const groups=Object.entries(signatures).flatMap(([key,sig])=>(sig.adGroups||[]).map(group=>({group,key})));const custom=Object.entries(signatures).filter(([,sig])=>sig.customTitleAttr);onboardingChecklist.innerHTML=`<div class="onboarding-group"><h3>1. Pflichtfelder im AD</h3><ul><li>AD-Benutzer ist aktiviert.</li><li><code>sAMAccountName</code> ist gesetzt.</li>${required.map(v=>`<li><strong>${escapeHtml(v.displayName||v.id)}</strong>: ${escapeHtml((v.adProperties&&v.adProperties.length?v.adProperties:[v.id]).join(' / '))}</li>`).join('')}</ul></div><div class="onboarding-group"><h3>2. Signaturgruppe</h3><ul><li>Der Benutzer benötigt mindestens eine passende Signaturgruppe.</li>${groups.map(x=>`<li><code>${escapeHtml(x.group)}</code> → ${escapeHtml(x.key)}</li>`).join('')}</ul></div>${custom.length?`<div class="onboarding-group"><h3>3. Signatur-spezifische Attribute</h3><ul>${custom.map(([key,sig])=>`<li><strong>${escapeHtml(key)}</strong>: <code>${escapeHtml(sig.customTitleAttr)}</code></li>`).join('')}</ul></div>`:''}<div class="onboarding-group"><h3>${custom.length?4:3}. Abschlusskontrolle</h3><ul><li>Benutzer in der IT-Oberfläche suchen.</li><li>Preflight ausführen.</li><li>Onboarding ist erst abgeschlossen, wenn der Preflight ohne blockierenden Fehler grün ist.</li></ul></div>`}
copyOnboardingBtn.addEventListener('click',async()=>{const text=onboardingText(currentProfileForChecklist());try{await navigator.clipboard.writeText(text);copyOnboardingBtn.textContent='Kopiert ✓';setTimeout(()=>copyOnboardingBtn.textContent='Checkliste kopieren',1600)}catch{prompt('Checkliste kopieren:',text)}});

async function logoutAdmin() {
  if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen und abmelden?')) return;
  try {
    if (apiBase) {
      await fetchTimeout(`${apiBase}/api/auth/logout`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:'{}'
      }, 5000);
    }
  } catch {
    // Local logout must still work when backend is unavailable.
  }
  safeSet(API_TOKEN_STORAGE_KEY,'');
  const login=new URL('login.html',location.href);
  login.searchParams.set('next','admin.html');
  location.replace(login.href);
}
adminLogoutBtn?.addEventListener('click',logoutAdmin);

[organizationName,directoryServer,directorySearchBase,previewPath,productionPath,secondaryTitleAttributes].forEach(input=>input.addEventListener('input',()=>{markDirty();renderOnboarding();if(input===previewPath){previewPathStatus.textContent='Noch nicht geprüft.';previewPathStatus.className='path-status muted'}if(input===productionPath){productionPathStatus.textContent='Noch nicht geprüft.';productionPathStatus.className='path-status muted'}}));
addSignatureBtn.addEventListener('click',()=>{addSignatureCard();markDirty();renderOnboarding()});
addVariableBtn.addEventListener('click',()=>{const card=addVariableCard({required:false});markDirty();renderOnboarding();card.scrollIntoView({behavior:'smooth',block:'center'});variableField(card,'displayName').focus()});
reloadProfileBtn.addEventListener('click',async()=>{if(dirty&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;await loadProfile();await loadAdminEnvSettings()});
saveProfileBtn.addEventListener('click',saveProfile);
applyEnvConfigBtn.addEventListener('click',applySavedEnv);
[ldapDomainConfig,ldapServerConfig,ldapContainerConfig,ldapUpnSuffixConfig,signatureGroupPrefixConfig].forEach(el=>el.addEventListener('input',markDirty));
retryBtn.addEventListener('click',async()=>{if(await connect()){await loadProfile();await loadAdminEnvSettings();await loadAuthUsers()}});
refreshAuthUsersBtn.addEventListener('click',loadAuthUsers);
createAuthUserForm.addEventListener('submit',async(event)=>{event.preventDefault();createAuthUserStatus.textContent='Wird angelegt ...';const payload={username:newAuthUsername.value.trim(),displayName:newAuthDisplayName.value.trim(),role:newAuthRole.value,password:newAuthPassword.value,enabled:true};const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/auth/users`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},10000));if(!ok){createAuthUserStatus.textContent=body.error||`HTTP ${status}`;return}createAuthUserForm.reset();newAuthRole.value='it';createAuthUserStatus.textContent='Benutzer angelegt.';await loadAuthUsers()});
refreshSystemBtn.addEventListener('click',loadSystemStatus);
restartBackendBtn.addEventListener('click',()=>runnerAction('backend'));
restartFrontendBtn.addEventListener('click',()=>runnerAction('frontend'));
testPreviewPathBtn.addEventListener('click',()=>checkDeploymentTarget('preview'));
testProductionPathBtn.addEventListener('click',()=>checkDeploymentTarget('production'));
variableSearch?.addEventListener('input',applyVariableFilters);
requiredVariablesOnly?.addEventListener('change',applyVariableFilters);
window.addEventListener('beforeunload',event=>{if(!dirty)return;event.preventDefault();event.returnValue=''});

(async function bootstrap(){const hash=location.hash.replace('#','');if(['overview','deployment','signatures','variables','access','onboarding','system'].includes(hash))switchView(hash);if(await connect()&&await ensureAdminSession()){await loadProfile();await loadAdminEnvSettings();await loadAuthUsers();await loadSystemStatus()}})();