/* Load app.js in a stubbed environment and exercise the load maths. */
const fs = require('fs');
const vm = require('vm');

const store = {};
const noop = () => {};
const fakeNode = new Proxy({}, {
  get(t, k) {
    if (k === 'appendChild' || k === 'addEventListener' || k === 'remove' || k === 'focus' || k === 'setAttribute' || k === 'scrollIntoView') return noop;
    if (k === 'querySelector' || k === 'querySelectorAll') return () => fakeNode;
    if (k === 'childNodes' || k === 'classList') return [];
    if (k === 'style') return {};
    return '';
  },
  set() { return true; }
});

const sandbox = {
  console,
  setTimeout, clearTimeout,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  fetch: () => Promise.reject(new Error('no network in test')),
  navigator: {},
  location: { hash: '', protocol: 'http:', replace: noop },
  document: {
    createElement: () => fakeNode,
    createTextNode: () => fakeNode,
    getElementById: () => fakeNode,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    body: fakeNode
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

/* ---- rounding to the nearest plate pair ---- */
console.log('rounding to 1.25:');
eq('15.6 -> 15',    ctx.roundToPlate(15.6), 15);
eq('14.4 -> 15',    ctx.roundToPlate(14.4), 15);
eq('18.75 exact',   ctx.roundToPlate(18.75), 18.75);
eq('0.5 -> 0',      ctx.roundToPlate(0.5), 0);
eq('19.4 -> 20',    ctx.roundToPlate(19.4), 20);
eq('19.0 -> 18.75', ctx.roundToPlate(19.0), 18.75);
eq('13.2 -> 13.75', ctx.roundToPlate(13.2), 13.75);

/* ---- formatting: no trailing zeros, no float dust ---- */
console.log('formatting:');
eq('18.75', ctx.fmtKg(18.75), '18.75');
eq('15',    ctx.fmtKg(15), '15');
eq('float dust', ctx.fmtKg(0.1 + 0.2), '0.3');

/* ---- with no baselines at all ---- */
console.log('no baselines:');
ctx.baselines = [];
eq('pct5RM missing', ctx.resolveLoad({type:'pct5RM', value:0.72}, '2026-09-21'), {text:'— set baselines', kg:null, missing:true});
eq('pctBW missing',  ctx.resolveLoad({type:'pctBW', value:0.20}, '2026-09-21'),  {text:'— set baselines', kg:null, missing:true});
eq('fixedKg fine',   ctx.resolveLoad({type:'fixedKg', value:5}, '2026-09-21'),   {text:'+5 kg', kg:5, missing:false});
eq('bodyweight',     ctx.resolveLoad({type:'bodyweight'}, '2026-09-21'),          {text:'Bodyweight', kg:null, missing:false});
eq('text',           ctx.resolveLoad({type:'text', text:'Heavy band'}, '2026-09-21'), {text:'Heavy band', kg:null, missing:false});
eq('none',           ctx.resolveLoad({type:'none'}, '2026-09-21'),                {text:'—', kg:null, missing:false});

/* ---- the brief's own worked example ---- */
console.log("the brief's example (heel raise +20% BW at 78 kg):");
ctx.baselines = [{ date:'2026-09-20', bodyweightKg:78, pullup5RMAddedKg:20 }];
eq('20% of 78 = 15.6 -> 15 kg', ctx.resolveLoad({type:'pctBW', value:0.20}, '2026-09-21').text, '+15 kg');
eq('72% of 20 = 14.4 -> 15 kg', ctx.resolveLoad({type:'pct5RM', value:0.72}, '2026-09-21').text, '+15 kg');

/* ---- THE critical one: history, not the newest row ---- */
console.log('dated resolution:');
ctx.baselines = [
  { date:'2026-09-20', bodyweightKg:78, pullup5RMAddedKg:20 },
  { date:'2026-11-06', bodyweightKg:79, pullup5RMAddedKg:26 },   // W8 recalibration
  { date:'2026-12-04', bodyweightKg:79, pullup5RMAddedKg:30 }
];
eq('before any baseline',  ctx.resolveLoad({type:'pct5RM', value:0.60}, '2026-09-01'), {text:'— set baselines', kg:null, missing:true});
eq('W2 uses the Sep row',  ctx.resolveLoad({type:'pct5RM', value:0.60}, '2026-09-21').text, '+12.5 kg');   // 0.6*20 = 12 -> 12.5
eq('day before recal',     ctx.resolveLoad({type:'pct5RM', value:0.60}, '2026-11-05').text, '+12.5 kg');
eq('recal day itself',     ctx.resolveLoad({type:'pct5RM', value:0.60}, '2026-11-06').text, '+15 kg');     // 0.6*26 = 15.6 -> 15
eq('after W12 recal',      ctx.resolveLoad({type:'pct5RM', value:0.60}, '2026-12-10').text, '+17.5 kg');   // 0.6*30 = 18 -> 17.5
eq('baselinesFor mid',     ctx.baselinesFor('2026-11-20').date, '2026-11-06');
eq('baselinesFor early',   ctx.baselinesFor('2026-09-01'), null);

/* ---- rows arriving out of order must still sort ---- */
console.log('out-of-order input:');
ctx.baselines = [
  { date:'2026-12-04', bodyweightKg:79, pullup5RMAddedKg:30 },
  { date:'2026-09-20', bodyweightKg:78, pullup5RMAddedKg:20 }
];
ctx.sortBaselines();
eq('sorted ascending', ctx.baselines.map(b => b.date), ['2026-09-20','2026-12-04']);
eq('resolves correctly after sort', ctx.resolveLoad({type:'pct5RM', value:0.60}, '2026-10-01').text, '+12.5 kg');

/* ---- never NaN, whatever the junk ---- */
console.log('garbage in:');
ctx.baselines = [{ date:'2026-09-20', bodyweightKg:0, pullup5RMAddedKg:null }];
eq('zero bodyweight',  ctx.resolveLoad({type:'pctBW', value:0.20}, '2026-09-21').missing, true);
eq('null 5RM',         ctx.resolveLoad({type:'pct5RM', value:0.72}, '2026-09-21').missing, true);
ctx.baselines = [{ date:'2026-09-20', bodyweightKg:'seventy-eight', pullup5RMAddedKg:20 }];
eq('non-numeric BW',   ctx.resolveLoad({type:'pctBW', value:0.20}, '2026-09-21').missing, true);
eq('bad pct value',    ctx.resolveLoad({type:'pct5RM', value:'x'}, '2026-09-21').text, '—');
eq('unknown type',     ctx.resolveLoad({type:'wat'}, '2026-09-21').text, '—');
eq('null load',        ctx.resolveLoad(null, '2026-09-21').text, '—');

/* ---- every load in the real plan resolves to something sane ---- */
console.log('all 282 exercises in the real plan:');
ctx.baselines = [{ date:'2026-09-20', bodyweightKg:78, pullup5RMAddedKg:20 }];
let bad = [];
ctx.plan.sessions.forEach(s => s.exercises.forEach(ex => {
  const r = ctx.resolveLoad(ex.load, s.date);
  if (/NaN|undefined|null/.test(r.text) || r.text === '') bad.push(`${s.id}/${ex.id}: "${r.text}"`);
  if (r.kg !== null && !isFinite(r.kg)) bad.push(`${s.id}/${ex.id}: kg=${r.kg}`);
  if (r.kg !== null && Math.abs(r.kg / 1.25 - Math.round(r.kg / 1.25)) > 1e-9) bad.push(`${s.id}/${ex.id}: ${r.kg} is not a plate multiple`);
}));
eq('no bad renders', bad, []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
