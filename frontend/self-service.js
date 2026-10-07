const TOKEN_KEY='signaturee.apiToken',BASE_KEY='signaturee.apiBase';
const byId=id=>document.getElementById(id);
const userBadge=byId('selfUserBadge'),logoutBtn=byId('selfLogoutBtn'),connectionPanel=byId('selfConnectionPanel'),connectionMessage=byId('selfConnectionMessage'),retryBtn=byId('selfRetryBtn'),identityEl=byId('selfIdentity'),signatureChoicesEl=byId('selfSignatureChoices'),checksEl=byId('selfChecks'),actionSummary=byId('selfActionSummary'),generateBtn=byId('selfGenerateBtn'),resultEl=byId('selfResult'),resultText=byId('selfResultText'),downloadBtn=byId('selfDownloadBtn');
let apiBase='',bootstrapState=null,latestDownload='';
const selectedSignatures=new Set();

function get(k){try{return localStorage.getItem(k)}catch{return null}}
function set(k,v){try{localStorage.setItem(k,v)}catch{}}
function norm(v){return String(v||'').trim().replace(/\/$/,'')}
function candidates(){const r=globalThis.__SIGNATUREE_RUNTIME__||globalThis.SIGNATUREE_RUNTIME||{};const protocol=['http:','https:'].includes(location.protocol)?location.protocol:'http:';const sameOrigin=['http:','https:'].includes(location.protocol)?norm(location.origin):'';let saved=norm(get(BASE_KEY));try{const u=new URL(saved);if(!['localhost','127.0.0.1','::1'].includes(String(location.hostname).toLowerCase())&&['localhost','127.0.0.1','::1'].includes(u.hostname.toLowerCase())){u.hostname=location.hostname;saved=norm(u.href)}}catch{}return[...new Set([norm(r.apiBase||r.backendBase),sameOrigin,`${protocol}//${location.hostname||'localhost'}:3001`,saved].filter(Boolean))]}
async function request(url,init={},timeout=15000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout),headers=new Headers(init.headers||{}),token=String(get(TOKEN_KEY)||'').trim();if(token)headers.set('Authorization',`Bearer ${token}`);try{return await fetch(url,{...init,headers,signal:c.signal})}finally{clearTimeout(t)}}
async function parsed(r){const text=await r.text();let body={};try{body=text?JSON.parse(text):{}}catch{body={error:text}}return{ok:r.ok,status:r.status,body}}
function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
async function connect(){for(const base of candidates()){try{const r=await request(`${base}/health`,{},3000);if(!r.ok)continue;apiBase=base;set(BASE_KEY,base);connectionPanel.hidden=true;return true}catch{}}apiBase='';connectionPanel.hidden=false;connectionMessage.textContent='Signaturee Backend konnte nicht erreicht werden.';return false}
function login(){const u=new URL('login.html',location.href);u.searchParams.set('next','self-service.html');location.replace(u.href)}
async function session(){if(!apiBase&&!(await connect()))return false;const{ok,body}=await parsed(await request(`${apiBase}/api/auth/me`));if(!ok||!body.authenticated){login();return false}const role=String(body.role||'').toLowerCase();if(role!=='selfservice'){if(['admin','it','operator','user'].includes(role)){location.replace('index.html');return false}login();return false}userBadge.textContent=`${body.username||'Benutzer'} · ${body.source==='ldap'?'AD':'Signaturee'}`;return true}

function updateGenerateState(){
  const count=selectedSignatures.size;
  generateBtn.disabled=!bootstrapState?.ready||count===0;
  actionSummary.textContent=count
    ? `${count} Signatur${count===1?'':'en'} ausgewählt`
    : 'Wähle mindestens eine bereite Signatur aus.';
}

function renderBootstrap(body){
  bootstrapState=body;
  const user=body.user||{};
  const options=Array.isArray(body.signatureOptions)?body.signatureOptions:[];
  identityEl.className='identity-card';
  identityEl.innerHTML=`<div class="identity-main"><div><h3>${esc(user.displayName||body.username)}</h3><p>${esc(user.mail||'')}</p></div></div><div class="identity-fields"><div class="identity-field"><small>Benutzername</small><strong>${esc(user.id||body.username)}</strong></div><div class="identity-field"><small>Abteilung</small><strong>${esc(user.department||'–')}</strong></div></div>`;

  selectedSignatures.clear();
  options.filter(option=>option.ready).forEach(option=>selectedSignatures.add(option.key));

  if(!options.length){
    signatureChoicesEl.className='self-signature-list empty-state';
    signatureChoicesEl.textContent='Für dein AD-Konto ist aktuell keine Signatur zugeordnet.';
  }else{
    signatureChoicesEl.className='self-signature-list';
    signatureChoicesEl.innerHTML=options.map(option=>`<div class="self-signature-option ${option.ready?'':'not-ready'}">
      <label>
        <input type="checkbox" value="${esc(option.key)}" ${option.ready?'checked':'disabled'}>
        <span>${esc(option.displayLabel||option.key)}</span>
      </label>
      <span class="self-signature-status ${option.ready?'ready':'not-ready'}">${option.ready?'bereit':'nicht bereit'}</span>
    </div>`).join('');
    signatureChoicesEl.querySelectorAll('input[type="checkbox"]').forEach(input=>{
      input.addEventListener('change',()=>{
        if(input.checked)selectedSignatures.add(input.value);
        else selectedSignatures.delete(input.value);
        resultEl.hidden=true;
        updateGenerateState();
      });
    });
  }

  const issues=Array.isArray(body.issues)?body.issues:[];
  checksEl.innerHTML=issues.map(issue=>`<div class="check ${issue.level==='error'?'error':'warning'}">! ${esc(issue.message)}</div>`).join('');
  updateGenerateState();
}

async function bootstrap(){
  if(!(await session()))return;
  const{ok,body,status}=await parsed(await request(`${apiBase}/api/self/bootstrap`,{},30000));
  if(!ok){
    checksEl.innerHTML=`<div class="check error">${esc(body.error||`HTTP ${status}`)}</div>`;
    return;
  }
  renderBootstrap(body);
}

async function generate(){
  if(!bootstrapState?.ready||!selectedSignatures.size)return;
  const chosen=[...selectedSignatures];
  generateBtn.disabled=true;
  generateBtn.textContent='Wird erstellt ...';
  resultEl.hidden=true;
  const{ok,body,status}=await parsed(await request(`${apiBase}/api/self/generate`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({signatures:chosen})
  },120000));
  generateBtn.textContent='Meine Signatur erstellen';
  updateGenerateState();
  if(!ok){
    checksEl.insertAdjacentHTML('beforeend',`<div class="check error">Generierung: ${esc(body.error||`HTTP ${status}`)}</div>`);
    return;
  }
  latestDownload=body.download?.url||'/api/self/signature/download';
  resultEl.hidden=false;
  resultText.textContent=`${(body.signatures||[]).map(key=>{
    const option=(bootstrapState.signatureOptions||[]).find(item=>item.key===key);
    return option?.displayLabel||key;
  }).join(', ')} wurde erfolgreich erstellt.`;
}

async function download(){if(!latestDownload)return;const url=latestDownload.startsWith('http')?latestDownload:`${apiBase}${latestDownload.startsWith('/')?'':'/'}${latestDownload}`;const r=await request(url,{},30000);if(!r.ok)return;const blob=await r.blob();const disposition=r.headers.get('content-disposition')||'';const match=disposition.match(/filename="?([^";]+)"?/i);const filename=match?.[1]||'signaturee-signatures.zip';const object=URL.createObjectURL(blob);const a=document.createElement('a');a.href=object;a.download=filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(object)}
async function logout(){try{if(apiBase)await request(`${apiBase}/api/auth/logout`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})}catch{}set(TOKEN_KEY,'');login()}
generateBtn.addEventListener('click',generate);
downloadBtn.addEventListener('click',download);
logoutBtn.addEventListener('click',logout);
retryBtn.addEventListener('click',bootstrap);
(async()=>{if(await connect())await bootstrap()})();