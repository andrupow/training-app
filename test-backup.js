/* Exercise the backup validation in a stubbed environment. */
const fs = require('fs');
const vm = require('vm');

const store = {};
const noop = () => {};
const fakeNode = new Proxy({}, {
  get(t, k) {
    if (['appendChild','addEventListener','remove','focus','setAttribute','removeAttribute','scrollIntoView','click'].includes(k)) return noop;
    if (k === 'querySelector' || k === 'querySelectorAll') return () => fakeNode;
    if (k === 'childNodes' || k === 'classList') return [];
    if (k === 'style') return {};
    return '';
  },
  set() { return true; }
});

const sandbox = {
  console, setTimeout, clearTimeout, Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: noop },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  fetch: () => Promise.reject(new Error('no network')),
  navigator: {}, location: { hash: '', protocol: 'http:', replace: noop },
  document: {
    createElement: () => fakeNode, createTextNode: () => fakeNode,
    getElementById: () => fakeNode, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop, body: fakeNode
  },
  window: { addEventListener: noop, scrollTo: noop, scrollY: 0 }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('app.js', 'utf8'), sandbox);
const ctx = sandbox;
ctx.plan = JSON.parse(fs.readFileSync('data/plan.json', 'utf8'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`  FAIL ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
}
function ok(label, cond) { if (cond) pass++; else { fail++; console.log(`  FAIL ${label}`); } }

/* ---- files that must be rejected, with nothing written ---- */
console.log('rejecting bad files:');
ok('not JSON',        !!ctx.inspectBackup('this is not json').error);
ok('truncated JSON',  !!ctx.inspectBackup('{"baselines": [').error);
ok('empty string',    !!ctx.inspectBackup('').error);
ok('a bare array',    !!ctx.inspectBackup('[1,2,3]').error);
ok('null',            !!ctx.inspectBackup('null').error);
ok('a number',        !!ctx.inspectBackup('42').error);
ok('another app',     !!ctx.inspectBackup('{"app":"hevy","setLogs":[]}').error);
ok('no known keys',   !!ctx.inspectBackup('{"app":"integrated-plan","junk":1}').error);
ok('baselines not an array', !!ctx.inspectBackup('{"baselines":{"a":1}}').error);
ok('setLogs a string',       !!ctx.inspectBackup('{"setLogs":"nope"}').error);
ok('settings an array',      !!ctx.inspectBackup('{"settings":[]}').error);
eq('bad-app message', ctx.inspectBackup('{"app":"hevy","setLogs":[]}').error, 'That backup belongs to a different app.');

/* ---- files that must be accepted ---- */
console.log('accepting good files:');
const good = JSON.stringify({
  app: 'integrated-plan', version: 1, exportedAt: '2026-10-12T09:00:00.000Z',
  baselines: [{date:'2026-09-20', bodyweightKg:78, pullup5RMAddedKg:20}],
  setLogs: [{sessionId:'W2-Mon', exerciseId:'wtd-c2b', setIdx:0, done:true}],
  checkIns: [], settings: { notifHour: 8 }
});
const r = ctx.inspectBackup(good);
ok('no error', !r.error);
eq('baselines through', r.data.baselines.length, 1);
eq('setLogs through', r.data.setLogs.length, 1);
eq('exportedAt kept', r.exportedAt, '2026-10-12T09:00:00.000Z');
eq('summary', ctx.describeBackup(r.data), '1 baseline entry, 1 logged set, 0 check-ins');

/* hand-written file with no app field is still usable */
const bare = ctx.inspectBackup('{"baselines":[],"setLogs":[]}');
ok('no app field is fine', !bare.error);
eq('partial file', ctx.describeBackup(ctx.inspectBackup('{"setLogs":[{},{}]}').data), '2 logged sets');

/* ---- round trip ---- */
console.log('round trip:');
ctx.baselines = [{date:'2026-09-20', bodyweightKg:78, pullup5RMAddedKg:20}];
ctx.saveBaselines();
ctx.setLogs = [{sessionId:'W2-Mon', exerciseId:'wtd-c2b', setIdx:0, done:true, ts:'x'}];
ctx.saveLogs();
const payload = ctx.exportPayload();
eq('app tag', payload.app, 'integrated-plan');
eq('build tag', payload.build, ctx.BUILD);
ok('has exportedAt', /^\d{4}-\d{2}-\d{2}T/.test(payload.exportedAt));
const back = ctx.inspectBackup(JSON.stringify(payload));
ok('its own export re-imports', !back.error);
eq('baselines survive', back.data.baselines, ctx.baselines);
eq('logs survive', back.data.setLogs, ctx.setLogs);

/* ---- the nag ---- */
console.log('the export nag:');
eq('days: same day',  ctx.daysBetween('2026-09-19','2026-09-19'), 0);
eq('days: 7',         ctx.daysBetween('2026-09-12','2026-09-19'), 7);
eq('days: over a month', ctx.daysBetween('2026-09-19','2026-11-06'), 48);
eq('days: across a year', ctx.daysBetween('2026-12-28','2027-01-04'), 7);

ctx.todayISO = () => '2026-09-19';
ctx.baselines = []; ctx.setLogs = []; ctx.settings = {};
eq('no data, no nag', ctx.exportOverdue(), false);
ctx.baselines = [{date:'2026-09-19', bodyweightKg:78, pullup5RMAddedKg:20}];
eq('data, never exported', ctx.exportOverdue(), true);
ctx.settings = { lastExport: '2026-09-19T08:00:00.000Z' };
eq('exported today', ctx.exportOverdue(), false);
eq('days since', ctx.daysSinceExport(), 0);
ctx.settings = { lastExport: '2026-09-13T08:00:00.000Z' };
eq('6 days: quiet', ctx.exportOverdue(), false);
ctx.settings = { lastExport: '2026-09-12T08:00:00.000Z' };
eq('7 days: nag', ctx.exportOverdue(), true);

/* ---- menus and what each day held ---- */
console.log('day plans and frozen days in a backup:');
const plans = { '2026-10-06': { sittings: [{ minutes: 45, areas: ['mu'] }], suggested: ['mu'], removed: {} } };
const frozen = { '2026-10-06:mu': { stage: 'M1', type: 'strength' } };
const withPlans = ctx.inspectBackup(JSON.stringify({ setLogs: [], dayPlans: plans, areaDays: frozen }));
ok('objects are accepted', !withPlans.error);
eq('dayPlans through', withPlans.data.dayPlans, plans);
eq('areaDays through', withPlans.data.areaDays, frozen);
ok('dayPlans as an array is rejected', !!ctx.inspectBackup('{"dayPlans":[]}').error);
ok('dayPlans as a string is rejected', !!ctx.inspectBackup('{"dayPlans":"x"}').error);
ok('areaDays as an array is rejected', !!ctx.inspectBackup('{"areaDays":[1]}').error);
eq('a file of only plans is still a backup', ctx.describeBackup(ctx.inspectBackup(JSON.stringify({ dayPlans: plans })).data), '1 planned day');
eq('the summary counts them', ctx.describeBackup({ setLogs: [{}], dayPlans: Object.assign({}, plans, { '2026-10-07': plans['2026-10-06'] }) }), '1 logged set, 2 planned days');
eq('an old file summarises as before', ctx.describeBackup({ baselines: [], setLogs: [{}] }), '0 baseline entries, 1 logged set');

console.log('exporting them:');
ctx.dayPlans = plans; ctx.saveDayPlans();
ctx.frozenDays = frozen; ctx.saveFrozenDays();
const out = ctx.exportPayload();
eq('dayPlans exported', out.dayPlans, plans);
eq('areaDays exported', out.areaDays, frozen);
ok('and they re-import', !ctx.inspectBackup(JSON.stringify(out)).error);

console.log('restoring them:');
const fresh = () => { Object.keys(store).forEach(k => delete store[k]); };
fresh();
store.setLogs = '[{"sessionId":"2026-10-06:mu"}]'; store.dayPlans = JSON.stringify(plans); store.areaDays = JSON.stringify(frozen);
ctx.writeBackup({ setLogs: [{ sessionId: 'W2-Mon' }], dayPlans: {}, areaDays: {} });
eq('a file that has them replaces them', [store.dayPlans, store.areaDays], ['{}', '{}']);
fresh();
store.dayPlans = JSON.stringify(plans); store.areaDays = JSON.stringify(frozen);
ctx.writeBackup({ setLogs: [{ sessionId: 'W2-Mon' }] });
eq('logs without them (an old file) clears them, so no menu points at lost sets', [store.dayPlans, store.areaDays], [undefined, undefined]);
ok('and the logs are written', store.setLogs === '[{"sessionId":"W2-Mon"}]');
fresh();
store.dayPlans = JSON.stringify(plans); store.areaDays = JSON.stringify(frozen);
ctx.writeBackup({ baselines: [{ date: '2026-09-19' }] });
eq('a file with no logs leaves them alone', [store.dayPlans, store.areaDays], [JSON.stringify(plans), JSON.stringify(frozen)]);
fresh();
ctx.writeBackup({ setLogs: [], dayPlans: plans });
eq('plans without frozen days: frozen are cleared', [store.dayPlans, store.areaDays], [JSON.stringify(plans), undefined]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
