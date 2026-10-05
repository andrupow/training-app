/* The service worker's install step, run against a fake cache: the area data
   is precached from its own index, a missing file never breaks the install,
   and a new area needs no edit to sw.js. */
const fs = require('fs'), vm = require('vm');

let pass = 0, fail = 0;
function eq(l, g, w) { const ok = JSON.stringify(g) === JSON.stringify(w); if (ok) pass++; else { fail++; console.log(`  FAIL ${l}\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`); } }
function ok(l, c) { if (c) pass++; else { fail++; console.log(`  FAIL ${l}`); } }

/* Run sw.js and fire its install event. `files` maps url -> body (a string) or
   undefined for a 404. Resolves to the list of urls the cache ended up with. */
async function install(files) {
  const handlers = {}, stored = {}, warnings = [];
  const fakeCache = {
    add: async url => {
      const body = files(url);
      if (body === undefined) throw new Error('404 ' + url);
      stored[url] = body;
    },
    match: async url => (url in stored ? { json: async () => JSON.parse(stored[url]) } : undefined)
  };
  const sandbox = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} }, location: { origin: 'http://x' } },
    caches: { open: async () => fakeCache, keys: async () => [], delete: async () => true },
    console: { warn: (...a) => warnings.push(a.join(' ')), log() {} },
    URL, Response: { error: () => null }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('sw.js', 'utf8'), sandbox);
  let done;
  handlers.install({ waitUntil: p => { done = p; } });
  await done;
  return { urls: Object.keys(stored).sort(), warnings };
}

const read = f => fs.readFileSync(f, 'utf8');
const real = url => { const p = url === './' ? 'index.html' : url; return fs.existsSync(p) ? read(p) : undefined; };
const ids = JSON.parse(read('data/areas/index.json')).areas;

(async () => {
  console.log('the real files:');
  let r = await install(real);
  eq('every area file is precached', ids.map(i => 'data/areas/' + i + '.json').filter(u => !r.urls.includes(u)), []);
  ok('the index, rules and legacy map are precached', ['data/areas/index.json', 'data/rules.json', 'data/legacy.json'].every(u => r.urls.includes(u)));
  ok('the plan and the shell still are', ['data/plan.json', 'index.html', 'app.js', 'style.css'].every(u => r.urls.includes(u)));
  eq('nothing warned', r.warnings, []);

  console.log('a ninth area needs no edit to sw.js:');
  const extra = JSON.stringify({ schema: 1, areas: ids.concat(['rowing']) });
  r = await install(u => u === 'data/areas/index.json' ? extra : u === 'data/areas/rowing.json' ? '{"id":"rowing"}' : real(u));
  ok('it is precached', r.urls.includes('data/areas/rowing.json'));

  console.log('a missing file never costs the install:');
  r = await install(u => u === 'data/areas/mu.json' ? undefined : real(u));
  ok('the install still completes', r.urls.length > 5);
  ok('the missing one is reported', r.warnings.some(w => w.includes('data/areas/mu.json')));
  ok('the others are all there', ids.filter(i => i !== 'mu').every(i => r.urls.includes('data/areas/' + i + '.json')));

  console.log('an unreadable index still installs the shell:');
  r = await install(u => u === 'data/areas/index.json' ? '{ not json' : real(u));
  ok('shell cached', r.urls.includes('index.html') && r.urls.includes('app.js'));
  ok('and says why', r.warnings.some(w => w.includes('index unreadable')));
  r = await install(u => u === 'data/areas/index.json' ? undefined : real(u));
  ok('a missing index installs too', r.urls.includes('index.html'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
