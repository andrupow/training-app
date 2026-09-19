const fs = require('fs'); const vm = require('vm');
const store = {}; const noop = () => {};
const fakeNode = new Proxy({}, { get(t,k){ if(['appendChild','addEventListener','remove','focus','setAttribute','removeAttribute','scrollIntoView','click'].includes(k)) return noop; if(k==='querySelector'||k==='querySelectorAll') return ()=>fakeNode; if(k==='childNodes'||k==='classList') return []; if(k==='style') return {}; return ''; }, set(){return true;} });
const sandbox = { console, setTimeout, clearTimeout, Blob: class {}, URL:{createObjectURL:()=>'blob:x',revokeObjectURL:noop},
  localStorage:{ getItem:k=>(k in store?store[k]:null), setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];} },
  fetch:()=>Promise.reject(new Error('no net')), navigator:{}, location:{hash:'',protocol:'http:',replace:noop},
  document:{ createElement:()=>fakeNode, createTextNode:()=>fakeNode, getElementById:()=>fakeNode, querySelector:()=>null, querySelectorAll:()=>[], addEventListener:noop, removeEventListener:noop, body:fakeNode },
  window:{ addEventListener:noop, scrollTo:noop, scrollY:0 } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('app.js','utf8'), sandbox);
const ctx = sandbox;
ctx.plan = JSON.parse(fs.readFileSync('data/plan.json','utf8'));

let pass=0, fail=0;
function eq(label, got, want){ const ok=JSON.stringify(got)===JSON.stringify(want); if(ok)pass++; else {fail++; console.log(`  FAIL ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);} }

const ci = (pain, stiffness, date) => ({ date: date||'2026-10-01', pain: Object.assign({elbow:0,shoulder:0,achilles:0,hamstring:0}, pain), stiffness: stiffness||'none' });
const st = (pain, stiffness, prior) => ctx.areaState('elbow', ci({elbow:pain}, stiffness), prior||[]);

/* ---- the three rules, exactly as the brief states them ---- */
console.log('green: maxPain <= 3 AND stiffness in (none, under30)');
eq('0 / none',      st(0,'none'), 'green');
eq('3 / none',      st(3,'none'), 'green');
eq('3 / under30',   st(3,'under30'), 'green');

console.log('amber: maxPain 4-5 OR stiffness == 30to60');
eq('4 / none',      st(4,'none'), 'amber');
eq('5 / none',      st(5,'none'), 'amber');
eq('0 / 30to60',    st(0,'30to60'), 'amber');
eq('3 / 30to60',    st(3,'30to60'), 'amber');

console.log('red: maxPain > 5 OR stiffness == over60');
eq('6 / none',      st(6,'none'), 'red');
eq('10 / none',     st(10,'none'), 'red');
eq('0 / over60',    st(0,'over60'), 'red');
eq('red beats amber', st(4,'over60'), 'red');
eq('pain 6 beats stiffness none', st(6,'under30'), 'red');

console.log('boundaries:');
eq('3 -> green', st(3,'none'), 'green');
eq('4 -> amber', st(4,'none'), 'amber');
eq('5 -> amber', st(5,'none'), 'amber');
eq('6 -> red',   st(6,'none'), 'red');

console.log('nothing unclassified slips through as green:');
const bare = { date:'2026-10-01', pain:{elbow:0,shoulder:0,achilles:0,hamstring:0} };   /* no stiffness at all */
eq('missing stiffness', ctx.areaState('elbow', bare, []), 'amber');
eq('junk stiffness',    st(0, 'wat'), 'amber');
eq('no pain object',    ctx.areaState('elbow', { date:'2026-10-01', stiffness:'none' }, []), 'green');

/* ---- rising across 3 consecutive check-ins ---- */
console.log('pain rising 3 running:');
const mk = (d,p) => ci({elbow:p}, 'none', d);
eq('1,2,3 rising -> red', ctx.areaState('elbow', mk('2026-10-03',3), [mk('2026-10-01',1), mk('2026-10-02',2)]), 'red');
eq('1,2,2 plateau -> not red', ctx.areaState('elbow', mk('2026-10-03',2), [mk('2026-10-01',1), mk('2026-10-02',2)]), 'green');
eq('3,2,1 falling -> not red', ctx.areaState('elbow', mk('2026-10-03',1), [mk('2026-10-01',3), mk('2026-10-02',2)]), 'green');
eq('only 2 of history', ctx.areaState('elbow', mk('2026-10-02',2), [mk('2026-10-01',1)]), 'green');
eq('rising but all zero-ish still red', ctx.areaState('elbow', mk('2026-10-03',3), [mk('2026-10-01',0), mk('2026-10-02',1)]), 'red');
eq('rising in elbow does not redden shoulder',
   ctx.areaState('shoulder', mk('2026-10-03',3), [mk('2026-10-01',1), mk('2026-10-02',2)]), 'green');

/* ---- per area, not globally ---- */
console.log('per area, not globally:');
const mixed = ci({elbow:5, shoulder:0, achilles:7, hamstring:2}, 'none');
eq('states', ctx.areaStates(mixed, []), { elbow:'amber', shoulder:'green', achilles:'red', hamstring:'green' });
eq('worst', ctx.worstState(ctx.areaStates(mixed, [])), 'red');
console.log('stiffness applies to every area:');
eq('all amber from stiffness', ctx.areaStates(ci({}, '30to60'), []), { elbow:'amber', shoulder:'amber', achilles:'amber', hamstring:'amber' });

/* ---- the plan's own words ---- */
console.log("verdict text comes from the plan:");
eq('amber text', ctx.stateAction('amber'), 'Hold the current load another full week. No progression. Keep the volume.');
eq('green text', ctx.stateAction('green'), 'Progress as written.');
eq('red text starts', ctx.stateAction('red').slice(0,13), 'Cut load 30%.');

/* ---- area to track mapping comes from the plan ---- */
console.log('area to tracks:');
eq('elbow',    ctx.tracksForArea('elbow'), ['pullup','dips']);
eq('shoulder', ctx.tracksForArea('shoulder'), ['dips','kbPress']);
eq('achilles', ctx.tracksForArea('achilles'), ['heelRaise','pogo']);
eq('hamstring',ctx.tracksForArea('hamstring'), ['nordic','hinge','sprint']);
eq('unknown area', ctx.tracksForArea('nose'), []);

/* ---- derived, never stored ---- */
console.log('derived state:');
ctx.checkIns = [ci({elbow:8},'none','2026-10-01')];
ctx.sortCheckIns();
eq('red before correction', ctx.areaStates(ctx.checkIns[0], []).elbow, 'red');
ctx.checkIns[0].pain.elbow = 2;                    /* correcting the input... */
eq('green after correction', ctx.areaStates(ctx.checkIns[0], []).elbow, 'green');   /* ...fixes the verdict */

console.log('priorTo excludes same-day and later:');
ctx.checkIns = [ci({},'none','2026-10-01'), ci({},'none','2026-10-02'), ci({},'none','2026-10-03')];
eq('prior to middle', ctx.priorTo('2026-10-02').map(c=>c.date), ['2026-10-01']);
eq('prior to first', ctx.priorTo('2026-10-01').map(c=>c.date), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
