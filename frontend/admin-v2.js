const API_TOKEN_STORAGE_KEY='signaturee.apiToken';
const API_BASE_STORAGE_KEY='signaturee.apiBase';
const byId=(id)=>document.getElementById(id);

const connectionBadge=byId('adminConnectionBadge'),connectionPanel=byId('adminConnectionPanel'),connectionMessage=byId('adminConnectionMessage'),connectionApiBase=byId('adminConnectionApiBase'),retryBtn=byId('adminRetryBtn'),adminLogoutBtn=byId('adminLogoutBtn');
const organizationName=byId('organizationName'),directoryServer=byId('directoryServer'),directorySearchBase=byId('directorySearchBase'),previewPath=byId('previewPath'),productionPath=byId('productionPath'),secondaryTitleAttributes=byId('secondaryTitleAttributes');
const signatureCards=byId('signatureCards'),variableCards=byId('variableCards'),variableSearch=byId('variableSearch'),requiredVariablesOnly=byId('requiredVariablesOnly'),variableFilterSummary=byId('variableFilterSummary'),templateStatus=byId('templateStatus'),addSignatureBtn=byId('addSignatureBtn'),addVariableBtn=byId('addVariableBtn'),reloadProfileBtn=byId('reloadProfileBtn'),saveProfileBtn=byId('saveProfileBtn'),saveSummary=byId('saveSummary'),saveStatus=byId('saveStatus'),profileSourceBadge=byId('profileSourceBadge'),profileSourceText=byId('profileSourceText'),signatureTemplate=byId('signatureCardTemplate');
const summarySignatureCount=byId('summarySignatureCount'),summaryVariableCount=byId('summaryVariableCount'),summaryGroupCount=byId('summaryGroupCount'),summaryTemplateState=byId('summaryTemplateState'),templateStripChips=byId('templateStripChips'),templateDetails=byId('templateDetails');
const authUserList=byId('authUserList'),refreshAuthUsersBtn=byId('refreshAuthUsersBtn'),createAuthUserForm=byId('createAuthUserForm'),newAuthUsername=byId('newAuthUsername'),newAuthDisplayName=byId('newAuthDisplayName'),newAuthRole=byId('newAuthRole'),newAuthPassword=byId('newAuthPassword'),createAuthUserStatus=byId('createAuthUserStatus'),ldapStatus=byId('ldapStatus'),ldapTestForm=byId('ldapTestForm'),ldapTestUsername=byId('ldapTestUsername'),ldapTestPassword=byId('ldapTestPassword'),ldapCredentialTestBtn=byId('ldapCredentialTestBtn'),ldapConfigTestBtn=byId('ldapConfigTestBtn'),ldapTestResult=byId('ldapTestResult');
const onboardingChecklist=byId('onboardingChecklist'),copyOnboardingBtn=byId('copyOnboardingBtn'),profileSaveBar=byId('profileSaveBar');
const serviceGrid=byId('serviceGrid'),taskList=byId('taskList'),refreshSystemBtn=byId('refreshSystemBtn'),restartBackendBtn=byId('restartBackendBtn'),restartFrontendBtn=byId('restartFrontendBtn'),systemActionStatus=byId('systemActionStatus');
const testPreviewPathBtn=byId('testPreviewPathBtn'),testProductionPathBtn=byId('testProductionPathBtn'),previewPathStatus=byId('previewPathStatus'),productionPathStatus=byId('productionPathStatus');
const ldapDomainConfig=byId('ldapDomainConfig'),ldapServerConfig=byId('ldapServerConfig'),ldapContainerConfig=byId('ldapContainerConfig'),ldapUpnSuffixConfig=byId('ldapUpnSuffixConfig'),signatureGroupPrefixConfig=byId('signatureGroupPrefixConfig'),signatureConventionSettings=byId('signatureConventionSettings'),applyEnvConfigBtn=byId('applyEnvConfigBtn');
const newSignatureWizard=byId('newSignatureWizard'),newSignatureForm=byId('newSignatureForm'),newSignatureKey=byId('newSignatureKey'),newSignatureHtml=byId('newSignatureHtml'),newSignatureTxt=byId('newSignatureTxt'),newSignatureGroupPreview=byId('newSignatureGroupPreview'),newSignatureStatus=byId('newSignatureStatus'),submitSignatureCreateBtn=byId('submitSignatureCreateBtn'),cancelSignatureCreateBtn=byId('cancelSignatureCreateBtn');
const signaturePrefixPreview=byId('signaturePrefixPreview'),signaturePrefixEditor=byId('signaturePrefixEditor'),editSignaturePrefixBtn=byId('editSignaturePrefixBtn');
const productionPathHelp=byId('productionPathHelp'),productionPathHelpText=byId('productionPathHelpText'),profileSourceBanner=byId('profileSourceBanner'),adSearchTestBtn=byId('adSearchTestBtn'),adSearchTestResult=byId('adSearchTestResult');

let apiBase='',currentStatus={},currentProfile=null,dirty=false,envManaged=false,envRevision='',baseVariableIds=new Set(),envEditable=false,envPendingRestart=false,automaticSignatures=false,activeSignatureGroupPrefix='Signature-';

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
function updateSaveBarVisibility(){profileSaveBar.hidden=!dirty&&!envPendingRestart}
function markDirty(){if(envManaged&&!envEditable)return;dirty=true;applyEnvConfigBtn.hidden=true;saveProfileBtn.disabled=false;saveStatus.textContent='Ungespeicherte Änderungen.';updateSaveBarVisibility()}
function markClean(message='Gespeichert.'){dirty=false;saveProfileBtn.disabled=true;saveStatus.textContent=message;updateSaveBarVisibility()}
function field(card,name){return card.querySelector(`[data-field="${name}"]`)}

function switchView(name){document.querySelectorAll('.admin-nav-item').forEach(b=>b.classList.toggle('active',b.dataset.adminView===name));document.querySelectorAll('.admin-view').forEach(v=>v.classList.toggle('active',v.dataset.view===name));location.hash=name;profileSourceBanner.hidden=true;updateSaveBarVisibility()}
document.querySelectorAll('.admin-nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.adminView)));

function addSignatureCard(key='',value={}){const card=signatureTemplate.content.firstElementChild.cloneNode(true);field(card,'key').value=key;field(card,'label').value=value.label||key;field(card,'adGroups').value=(value.adGroups||[]).join(', ');field(card,'templateHtml').value=value.templateHtml||'';field(card,'templateTxt').value=value.templateTxt||'';field(card,'resourceFolder').value=value.resourceFolder||'';field(card,'customTitleAttr').value=value.customTitleAttr||'';field(card,'faxFallback').value=value.faxFallback||'';const updateMapping=()=>{const groups=splitList(field(card,'adGroups').value);const label=card.querySelector('.signature-mapping-preview');if(label){label.textContent=groups.join(', ')||'Keine Gruppe';label.title=groups.length?groups.join('\n'):'Keine AD-Gruppe konfiguriert';}};updateMapping();card.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{card.querySelector('.signature-title').textContent=field(card,'key').value.trim()||'Neue Signatur';updateMapping();markDirty();renderOnboarding()}));card.querySelector('.remove-signature').addEventListener('click',()=>{card.remove();markDirty();renderOnboarding()});const upload=card.querySelector('[data-upload="templateFiles"]');upload.addEventListener('change',async()=>{const files=[...(upload.files||[])];if(!files.length)return;const status=card.querySelector('.asset-upload-status');status.textContent='Upload läuft ...';try{if(!(await ensureAdminSession()))return;const form=new FormData();files.forEach(file=>form.append('templates',file,file.name));const parsed=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/templates/import`,{method:'POST',body:form},30000));if(!parsed.ok)throw new Error(parsed.body.error||`HTTP ${parsed.status}`);if(!envManaged){files.forEach(file=>{const lower=file.name.toLowerCase();if(lower.endsWith('.txt'))field(card,'templateTxt').value=file.name;if(lower.endsWith('.htm')||lower.endsWith('.html'))field(card,'templateHtml').value=file.name});markDirty()}status.textContent=envManaged?`${files.length} Datei(en) hochgeladen. Neue Templates nach Backend-Neustart erkannt.`:`${files.length} Datei(en) hochgeladen. Profil noch speichern.`}catch(error){status.textContent=`Upload fehlgeschlagen: ${error.message}`}finally{upload.value=''}});signatureCards.appendChild(card);return card}
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
    <details class="variable-editor">
    <summary class="variable-card-head">
      <div class="variable-card-title">
        <div class="variable-card-title-line">
          <h3 class="variable-card-name">${escapeHtml(displayName||'Neue Variable')}</h3>
          <code class="variable-card-placeholder">${escapeHtml(placeholders[0]||'$variable')}</code>
          <span class="variable-badge ${value.required?'required':''}">${value.required?'Pflichtfeld':'Optional'}</span>
        </div>
        <span class="variable-card-summary">${escapeHtml(adProperties[0]||id||'AD-Feld')} → ${escapeHtml(placeholders[0]||'$variable')}</span>
      </div>
    </summary>

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
    </div>
    </details>`;

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


function renderStatus(status={}){
  currentStatus=status;
  const list=Array.isArray(status.signatureStatus)?status.signatureStatus:[];
  const byKey=new Map(list.map(item=>[String(item.key).toLowerCase(),item]));
  const healthy=(item)=>Boolean(item?.html?.exists&&item?.txt?.exists&&(!item?.resources||item.resources.exists));
  const good=list.filter(healthy).length;
  const bad=list.length-good;
  signatureCards.querySelectorAll('.signature-card').forEach(card=>{
    const key=field(card,'key').value.trim();
    const state=byKey.get(key.toLowerCase());
    const health=card.querySelector('.signature-health');
    if(!state){health.textContent='Nicht geprüft';health.className='signature-health';return}
    const ok=healthy(state);
    health.textContent=ok?'✓ Vollständig':'! Dateien fehlen';
    health.className='signature-health '+(ok?'ok':'bad');
  });
  summaryTemplateState.textContent=list.length
    ? bad===0 ? `${good} / ${list.length} OK` : `${bad} fehlerhaft · ${good} OK`
    : 'Keine Signaturen';
  summaryTemplateState.className='template-overview-count '+(bad?'bad':list.length?'ok':'muted');
  templateStripChips.innerHTML=list.map((item,i)=>{
    const ok=healthy(item);
    const lines=[
      'HTML: '+(item.html?.exists?'✓ ':'✗ ')+(item.html?.path||'fehlend'),
      'TXT: '+(item.txt?.exists?'✓ ':'✗ ')+(item.txt?.path||'fehlend'),
      'Assets: '+(!item.resources?'nicht benötigt':(item.resources.exists?'✓ ':'✗ ')+(item.resources.path||'fehlend'))
    ];
    const title=lines.join('\n');
    return `<button type="button" class="template-chip ${ok?'ok':'bad'}" data-template-index="${i}" title="${escapeHtml(title)}" aria-label="${escapeHtml(item.key)}: ${ok?'Template vollständig':'Dateien prüfen'}. Details öffnen."><span class="health-dot ${ok?'ok':'bad'}"></span><strong>${escapeHtml(item.key)}</strong></button>`;
  }).join('');
  if(!list.length){
    templateStatus.className='template-status empty-state';
    templateStatus.textContent='Keine Signaturen konfiguriert.';
  }else{
    templateStatus.className='template-status';
    const asset=(label,item)=>{
      if(!item)return `<span class="asset-state neutral">${label}: –</span>`;
      const file=String(item.path||'').split(/[\\/]/).pop();
      return `<span class="asset-state ${item.exists?'ok':'bad'}" title="${escapeHtml(item.path||'')}"><span class="health-dot ${item.exists?'ok':'bad'}"></span>${label}: ${escapeHtml(file||'fehlt')}</span>`;
    };
    templateStatus.innerHTML=list.map((item,i)=>
      `<div class="template-status-row" data-template-detail="${i}"><strong>${escapeHtml(item.key)}</strong>${asset('HTML',item.html)}${asset('TXT',item.txt)}${asset('Assets',item.resources)}</div>`
    ).join('');
  }
}
templateStripChips?.addEventListener('click',event=>{
  const button=event.target.closest('button[data-template-index]');
  if(!button)return;
  templateDetails.open=true;
  const row=templateStatus.querySelector('[data-template-detail="'+button.dataset.templateIndex+'"]');
  row?.scrollIntoView({block:'nearest',behavior:'smooth'});
});

function renderProfile(profile,status={}){currentProfile=profile;organizationName.value=profile.organization?.name||'';directoryServer.value=profile.directory?.server||'';directorySearchBase.value=profile.directory?.searchBase||'';previewPath.value=profile.targets?.preview?.path||'';productionPath.value=profile.targets?.production?.path||'';secondaryTitleAttributes.value=(profile.secondaryTitleAttributes||[]).join(', ');signatureCards.innerHTML='';Object.entries(profile.signatures||{}).forEach(([key,value])=>addSignatureCard(key,value));variableCards.innerHTML='';const variables=profile.variables?.variables||[];variables.forEach(addVariableCard);applyVariableFilters();renderStatus(status);summarySignatureCount.textContent=Object.keys(profile.signatures||{}).length;summaryVariableCount.textContent=variables.length;summaryGroupCount.textContent=Object.values(profile.signatures||{}).reduce((n,s)=>n+(s.adGroups||[]).length,0);saveSummary.textContent='Ungespeicherte Änderungen';markClean(envManaged?'Konfiguration geladen.':'Profil geladen.');
  // Local accounts and template uploads remain operational; all v2 profile
  // settings are read-only so the UI cannot diverge from the .env source.
  const readonlyInputs=[organizationName,directoryServer,directorySearchBase,secondaryTitleAttributes];
  readonlyInputs.forEach(el=>{el.disabled=envManaged&&!envEditable});
  // Paths may be drafted in the UI, but the only persistent source is .env.
  // No hidden database write and no automatic restart.
  previewPath.disabled=envManaged&&!envEditable;productionPath.disabled=envManaged&&!envEditable;


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
  addSignatureBtn.hidden=envManaged&&!automaticSignatures;
  addSignatureBtn.disabled=envManaged&&!automaticSignatures;
  addVariableBtn.disabled=envManaged&&!envEditable;
  saveProfileBtn.disabled=true;
  signatureConventionSettings.hidden=!envManaged||!automaticSignatures;
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
  signatureConventionSettings.hidden=!automaticSignatures;
  signaturePrefixPreview.textContent=val.SIGNATUREE_AUTO_GROUP_PREFIX||'Signature-';
  signaturePrefixEditor.hidden=true;
  editSignaturePrefixBtn.disabled=false;
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
async function restartBackendVerified(statusEl){
  const before=await jsonResponse(await fetchTimeout(`${apiBase}/health`,{},10000));
  if(!before.ok||!before.body.instanceId)
    throw new Error('Die aktuelle Backend-Instanz konnte nicht identifiziert werden.');
  const previousInstance=before.body.instanceId;
  const response=await jsonResponse(await fetchTimeout(`${apiBase}/api/runner/control`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'restart',scope:'backend'})
  },22000));
  if(!response.ok||!response.body.execution?.queued)
    throw new Error(response.body.error||'Windows-Neustartauftrag konnte nicht angelegt werden.');
  statusEl.textContent='Neustart beauftragt. Warte auf neuen Backend-Prozess ...';
  // User sessions live in process memory and vanish after restart. /health
  // stays unauthenticated, so new instance detection works without old tokens.
  const base=apiBase;
  for(let attempt=0;attempt<43;attempt++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    try{
      const check=await jsonResponse(await fetchTimeout(`${base}/health`,{},2500));
      if(check.ok&&check.body.instanceId&&check.body.instanceId!==previousInstance){
        apiBase=base;
        return true;
      }
    }catch{}
  }
  throw new Error('Keine neue Backend-Instanz bestätigt. Logs/backend-restart.log auf dem Server prüfen.');
}
function finishBackendRestart(){
  // Old bearer tokens are in-memory and are deliberately invalid after restart.
  // Avoid using them for another Admin request; let the operator sign in again.
  try{localStorage.removeItem(API_TOKEN_STORAGE_KEY)}catch{}
  setTimeout(()=>{location.assign('login.html')},1400);
}
async function applySavedEnv(){
  if(!confirm('Gespeicherte Konfiguration aktivieren? Das Backend startet neu; du meldest dich danach erneut an.'))return;
  applyEnvConfigBtn.disabled=true;
  saveStatus.textContent='Backend-Neustart wird vorbereitet ...';
  try{
    await restartBackendVerified(saveStatus);
    saveStatus.textContent='✓ Backend neu gestartet. Bitte erneut anmelden.';
    finishBackendRestart();
  }catch(e){
    saveStatus.textContent='Neustart fehlgeschlagen: '+e.message;
    applyEnvConfigBtn.disabled=false;
  }
}
async function loadProfile(){if(!(await ensureAdminSession()))return;saveSummary.textContent='Profil wird geladen ...';const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/profile`,{},10000));if(!ok){saveSummary.textContent='Profil konnte nicht geladen werden';saveStatus.textContent=body.error||`HTTP ${status}`;return}envManaged=String(body.source||'').startsWith('environment');
automaticSignatures=Boolean(body.automaticSignatures);
activeSignatureGroupPrefix=String(body.automaticGroupPrefix||'Signature-');
updateNewSignatureGroupPreview();
profileSourceBadge.textContent=body.source||'Konfiguration';profileSourceText.textContent=envManaged?'Konfigurationsquelle: .env. Freigegebene Einstellungen kannst du hier mit Backup und Validierung bearbeiten. Änderungen werden nach Backend-Neustart aktiv.':'Konfigurationsquelle: profile_v2 in SQLite. Änderungen werden in der Datenbank gespeichert.';renderProfile(body.profile,body.status)}
async function saveProfile(){if(envManaged){return saveEnvSettings()}if(!(await ensureAdminSession()))return;let profile;try{profile=collectProfile()}catch(error){saveStatus.textContent=error.message;return}saveProfileBtn.disabled=true;saveStatus.textContent='Speichern und prüfen ...';const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/profile`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile})},15000));if(!ok){saveProfileBtn.disabled=false;const details=Array.isArray(body.errors)?body.errors.join(' · '):'';saveStatus.textContent=`${body.error||`HTTP ${status}`}${details?` — ${details}`:''}`;return}renderProfile(body.profile,body.status);saveStatus.textContent='Gespeichert.'}

function renderService(name,service){const ok=Boolean(service?.healthy);const detail=service?.statusCode?`HTTP ${service.statusCode} · ${service.responseMs??0} ms`:(service?.error||'nicht erreichbar');return `<div class="service-card"><span class="health-dot ${ok?'ok':'bad'}"></span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></div></div>`}
function renderSystem(snapshot={}){const services=snapshot.services||{};serviceGrid.innerHTML=[renderService('Backend',services.backend),renderService('Frontend',services.frontend)].join('');const tasks=Array.isArray(snapshot?.tasks?.tasks)?snapshot.tasks.tasks:[];if(!tasks.length){taskList.className='task-list empty-state';taskList.textContent=snapshot?.tasks?.reason||'Keine Task-Daten verfügbar.'}else{taskList.className='task-list';taskList.innerHTML=tasks.map(task=>`<div class="task-row"><span><strong>${escapeHtml(task.taskName)}</strong><br><small>Last result: ${escapeHtml(task.lastTaskResult??'--')}</small></span><span>${escapeHtml(task.state||'Unknown')}</span></div>`).join('')}}
async function loadSystemStatus(){if(!(await ensureAdminSession()))return;systemActionStatus.textContent='Status wird geladen ...';try{const{ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/runner/status`,{},12000));if(!ok)throw new Error(body.error||`HTTP ${status}`);renderSystem(body);systemActionStatus.textContent=body.summary?.healthy?'Alles läuft.':'Status geladen – Prüfung empfohlen.';systemActionStatus.className=`inline-status ${body.summary?.healthy?'success':''}`}catch(error){systemActionStatus.textContent=`Systemstatus: ${error.message}`;systemActionStatus.className='inline-status error'}}
async function runnerAction(scope){
  if(!(await ensureAdminSession()))return;
  const button=scope==='backend'?restartBackendBtn:restartFrontendBtn;
  button.disabled=true;
  systemActionStatus.textContent=scope==='backend'?'Backend-Neustart wird vorbereitet ...':'Frontend wird neu gestartet ...';
  systemActionStatus.className='inline-status';
  try{
    if(scope==='backend'){
      await restartBackendVerified(systemActionStatus);
      systemActionStatus.textContent='✓ Backend neu gestartet. Erneute Anmeldung erforderlich.';
      finishBackendRestart();
    }else{
      const {ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/runner/control`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'restart',scope:'frontend'})
      },15000));
      if(!ok)throw new Error(body.error||`HTTP ${status}`);
      systemActionStatus.textContent='Frontend-Neustart beauftragt. Seite ggf. neu laden.';
    }
    systemActionStatus.className='inline-status success';
  }catch(e){
    systemActionStatus.textContent='Neustart fehlgeschlagen: '+e.message;
    systemActionStatus.className='inline-status error';
  }finally{button.disabled=false}
}
async function checkDeploymentTarget(target){
  if(!(await ensureAdminSession()))return;
  const production=target==='production';
  const input=production?productionPath:previewPath;
  const statusEl=production?productionPathStatus:previewPathStatus;
  const button=production?testProductionPathBtn:testPreviewPathBtn;
  const entered=input.value.trim();
  if(!entered){
    statusEl.textContent='Bitte zuerst einen Pfad eingeben.';
    statusEl.className='path-status error';return;
  }
  if(production){productionPathHelp.hidden=true;productionPathHelp.open=false;productionPathHelpText.textContent=''}
  statusEl.textContent='Prüfe eingegebenen Pfad ...';
  statusEl.className='path-status muted';
  button.disabled=true;
  try{
    // Admin-only, one-off probe. This does not save a path, edit .env or run
    // generation; the backend creates no folders for trial paths.
    const {ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/targets/check`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({target,path:entered})
    },20000));
    if(!ok)throw new Error(body.error||`HTTP ${status}`);
    const success=body.exists&&body.directory&&body.writable&&(!production||body.aclWritable);
    const active=production?currentProfile?.targets?.production?.path:currentProfile?.targets?.preview?.path;
    const modified=entered!==String(active||'').trim();
    if(success){
      statusEl.textContent=modified?'✓ Test erfolgreich – noch nicht gespeichert':'✓ Pfad erreichbar und beschreibbar';
      statusEl.className='path-status success';
    }else{
      statusEl.textContent=body.code==='SMB_ACCESS_DENIED'
        ? '✗ Kein Zugriff auf die SMB-Freigabe'
        : body.code==='SMB_PATH_NOT_FOUND'?'✗ Netzwerkpfad nicht gefunden'
          : body.stage==='acl'||(body.writable&&!body.aclWritable)?'✗ Berechtigung für Ordner-ACLs fehlt'
            :'✗ '+(body.message||body.error||'Pfad nicht beschreibbar.');
      statusEl.className='path-status error';
      if(production){
        productionPathHelp.hidden=false;
        productionPathHelpText.textContent=[body.hint,
          body.error?'Technisch: '+body.error:'',
          body.stage?'Schritt: '+body.stage:''].filter(Boolean).join('\n');
      }
    }
  }catch(error){
    statusEl.textContent='✗ '+error.message;
    statusEl.className='path-status error';
  }finally{button.disabled=false}
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
function renderOnboarding(){
  if(!onboardingChecklist)return;
  const profile=currentProfileForChecklist();
  const vars=profile.variables?.variables||[];
  const required=vars.filter(v=>v.required);
  const signatures=profile.signatures||{};
  const groups=Object.entries(signatures).flatMap(([key,sig])=>
    (sig.adGroups||[]).map(group=>({group,key})));
  const custom=Object.entries(signatures).filter(([,sig])=>sig.customTitleAttr);
  const section=(heading,body)=>`<section class="onboarding-group">
    <h3>${heading}</h3><ul>${body}</ul></section>`;
  const fields='<li>AD-Benutzer aktiviert, <code>sAMAccountName</code> gesetzt</li>'+
    required.map(v=>`<li><strong>${escapeHtml(v.displayName||v.id)}</strong>: ${escapeHtml((v.adProperties?.length?v.adProperties:[v.id]).join(' / '))}</li>`).join('');
  const groupRows='<li>Mindestens eine passende AD-Signaturgruppe</li>'+
    groups.map(x=>`<li><code>${escapeHtml(x.group)}</code> → ${escapeHtml(x.key)}</li>`).join('');
  const customRows=custom.map(([key,sig])=>`<li><strong>${escapeHtml(key)}</strong>: <code>${escapeHtml(sig.customTitleAttr)}</code></li>`).join('');
  onboardingChecklist.innerHTML=[
    section('1. Pflichtfelder im AD',fields),
    section('2. Signaturgruppen',groupRows),
    ...(custom.length?[section('3. Zusatzattribute',customRows)]:[]),
    section(custom.length?'4. Abschlusskontrolle':'3. Abschlusskontrolle',
      '<li>Benutzer in Signaturee suchen</li><li>Preflight ohne blockierende Fehler durchführen</li>')
  ].join('');
}

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

[organizationName,directoryServer,directorySearchBase,previewPath,productionPath,secondaryTitleAttributes].forEach(input=>input.addEventListener('input',()=>{markDirty();renderOnboarding();if(input===previewPath){previewPathStatus.textContent='Noch nicht geprüft.';previewPathStatus.className='path-status muted'}if(input===productionPath){productionPathStatus.textContent='Noch nicht geprüft.';productionPathStatus.className='path-status muted';productionPathHelp.hidden=true;productionPathHelp.open=false}}));
function updateNewSignatureGroupPreview(){
  const key=newSignatureKey.value.trim()||'XY';
  newSignatureGroupPreview.textContent=activeSignatureGroupPrefix+key;
}
newSignatureKey.addEventListener('input',updateNewSignatureGroupPreview);
editSignaturePrefixBtn.addEventListener('click',()=>{
  if(!envEditable)return;
  signaturePrefixEditor.hidden=false;
  editSignaturePrefixBtn.hidden=true;
  signatureGroupPrefixConfig.focus();
});
cancelSignatureCreateBtn.addEventListener('click',()=>{
  newSignatureWizard.hidden=true;
  newSignatureForm.reset();
  newSignatureStatus.textContent='';
});
addSignatureBtn.addEventListener('click',()=>{
  if(envManaged){
    if(!automaticSignatures)return;
    newSignatureWizard.hidden=!newSignatureWizard.hidden;
    if(!newSignatureWizard.hidden){
      newSignatureStatus.textContent='';
      updateNewSignatureGroupPreview();
      newSignatureKey.focus();
    }
    return;
  }
  const card=addSignatureCard();
  card.querySelector('.signature-editor').open=true;
  markDirty();renderOnboarding();field(card,'key').focus();
});
newSignatureForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const key=newSignatureKey.value.trim();
  const html=newSignatureHtml.files?.[0],txt=newSignatureTxt.files?.[0];
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(key)||key.toLowerCase()==='example'){
    newSignatureStatus.textContent='Bitte ein gültiges Kürzel (z. B. HR) eingeben.';
    return;
  }
  if(!html||!txt||!/.html?$/i.test(html.name)||!/.txt$/i.test(txt.name)){
    newSignatureStatus.textContent='Eine HTML- und eine TXT-Datei auswählen.';
    return;
  }
  if(!(await ensureAdminSession()))return;
  const form=new FormData();
  form.append('key',key);
  form.append('html',html,html.name);
  form.append('txt',txt,txt.name);
  submitSignatureCreateBtn.disabled=true;
  newSignatureStatus.textContent='Prüfe und speichere Vorlagen …';
  try{
    const {ok,status,body}=await jsonResponse(await fetchTimeout(`${apiBase}/api/v2/signatures/create`,{
      method:'POST',body:form
    },30000));
    if(!ok)throw new Error(body.error||`HTTP ${status}`);
    await loadProfile();
    await loadAdminEnvSettings();
    newSignatureStatus.textContent=`✓ ${body.key} angelegt. Gruppe: ${body.group}. Die AD-Gruppe muss bereits existieren.`;
    newSignatureForm.reset();
    newSignatureKey.value=key;
    updateNewSignatureGroupPreview();
    newSignatureWizard.hidden=false;
  }catch(error){
    newSignatureStatus.textContent='✗ '+error.message;
  }finally{submitSignatureCreateBtn.disabled=false}
});
addVariableBtn.addEventListener('click',()=>{const card=addVariableCard({required:false});card.querySelector('.variable-editor').open=true;markDirty();renderOnboarding();card.scrollIntoView({behavior:'smooth',block:'center'});variableField(card,'displayName').focus()});
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