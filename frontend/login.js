const TOKEN_KEY='signaturee.apiToken',BASE_KEY='signaturee.apiBase';
const form=document.getElementById('loginForm'),username=document.getElementById('loginUsername'),password=document.getElementById('loginPassword'),statusEl=document.getElementById('loginStatus'),apiInput=document.getElementById('loginApiBase'),retryBtn=document.getElementById('retryBackendBtn');
let activeBase='';

function get(k){try{return localStorage.getItem(k)}catch{return null}}function set(k,v){try{localStorage.setItem(k,v)}catch{}}
function norm(v){return String(v||'').trim().replace(/\/$/,'')}
function candidates(){const r=globalThis.__SIGNATUREE_RUNTIME__||globalThis.SIGNATUREE_RUNTIME||{},protocol=['http:','https:'].includes(location.protocol)?location.protocol:'http:';const sameOrigin=['http:','https:'].includes(location.protocol)?norm(location.origin):'';let saved=norm(get(BASE_KEY));try{const u=new URL(saved);if(!['localhost','127.0.0.1','::1'].includes(String(location.hostname).toLowerCase())&&['localhost','127.0.0.1','::1'].includes(u.hostname.toLowerCase())){u.hostname=location.hostname;saved=norm(u.href)}}catch{}return[...new Set([norm(r.apiBase||r.backendBase),sameOrigin,`${protocol}//${location.hostname||'localhost'}:3001`,saved].filter(Boolean))]}
function setStatus(message,kind=''){statusEl.textContent=message;statusEl.className=`inline-status ${kind}`.trim()}
async function request(url,init={},timeout=10000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{return await fetch(url,{...init,signal:c.signal})}finally{clearTimeout(t)}}
async function body(r){const text=await r.text();try{return text?JSON.parse(text):{}}catch{return{error:text}}}
async function discover(){setStatus('Backend wird gesucht ...');const manual=norm(apiInput.value);const list=manual?[manual,...candidates().filter(x=>x!==manual)]:candidates();for(const base of list){try{const r=await request(`${base}/health`,{},3000);if(!r.ok)continue;activeBase=base;apiInput.value=base;set(BASE_KEY,base);setStatus('Bereit.','success');return true}catch{}}activeBase='';setStatus('Backend nicht erreichbar. Verbindungsdetails prüfen.','error');return false}
function destination(role){
  const normalized=String(role||'').toLowerCase();
  let requested='';
  try{requested=new URLSearchParams(location.search).get('next')||''}catch{}
  const safe=/^(?:index|admin|self-service)\.html$/i.test(requested)?requested.toLowerCase():'';

  // Role always wins over a stale or foreign "next" URL.
  if(normalized==='selfservice')return 'self-service.html';
  if(normalized==='admin'){
    return safe==='admin.html'?'admin.html':'index.html';
  }
  if(['it','operator','user'].includes(normalized))return 'index.html';
  return 'login.html';
}
async function verify(token){const r=await request(`${activeBase}/api/auth/me`,{headers:{Authorization:`Bearer ${token}`}});const b=await body(r);if(!r.ok||!b.authenticated)throw new Error(b.error||'Session konnte nicht erstellt werden.');return b}
async function login(event){event.preventDefault();if(!activeBase&&!(await discover()))return;const u=username.value.trim(),p=password.value;if(!u||!p){setStatus('Benutzername und Passwort eingeben.','error');return}setStatus('Anmeldung läuft ...');try{const r=await request(`${activeBase}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})},15000);const b=await body(r);if(!r.ok)throw new Error(b.error||`HTTP ${r.status}`);if(!b.token)throw new Error('Login-Token fehlt.');set(TOKEN_KEY,b.token);const session=await verify(b.token);location.replace(destination(String(session.role||b.role||'').toLowerCase()))}catch(error){setStatus(`Anmeldung fehlgeschlagen: ${error.message}`,'error')}}
async function existing(){const token=String(get(TOKEN_KEY)||'').trim();if(!token||!activeBase)return;try{const s=await verify(token);location.replace(destination(String(s.role||'').toLowerCase()))}catch{}}
form.addEventListener('submit',login);retryBtn.addEventListener('click',()=>{activeBase='';discover()});apiInput.addEventListener('change',()=>{activeBase=norm(apiInput.value);set(BASE_KEY,activeBase)});(async()=>{if(await discover())await existing()})();