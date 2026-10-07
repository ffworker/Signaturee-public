const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const storage = new Map();
const element = () => ({ value: '', textContent: '', className: '', addEventListener() {} });
const context = {
  document: { getElementById: element },
  location: {
    search: '?apiBase=https://untrusted.example',
    protocol: 'https:',
    origin: 'https://signature.example',
    hostname: 'signature.example',
  },
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  },
  URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
  fetch: async () => { throw new Error('offline'); },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/login.js'), 'utf8'), context);
const candidates = Array.from(vm.runInContext('candidates()', context));
assert.ok(!candidates.includes('https://untrusted.example'),
  'a link must not override the login API destination');
assert.ok(candidates.includes('https://signature.example'), 'same-origin discovery must remain available');

const generationSource = fs.readFileSync(path.join(__dirname, '../../frontend/generate-v2.js'), 'utf8');
const generationContext = {
  document: { getElementById: element },
  location: context.location,
  localStorage: context.localStorage,
  URL, URLSearchParams,
};
generationContext.globalThis = generationContext;
vm.createContext(generationContext);
vm.runInContext(generationSource.split('const nativeFetch =')[0], generationContext);
const generationCandidates = Array.from(vm.runInContext('apiCandidates()', generationContext));
assert.ok(!generationCandidates.includes('https://untrusted.example'),
  'the generation page must not persist a backend URL from an untrusted link');
console.log('login-origin.test.js: ok');
