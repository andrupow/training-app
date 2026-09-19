const fs=require('fs'), vm=require('vm');
const store={}; const noop=()=>{};
const fakeNode=new Proxy({},{get(t,k){if(['appendChild','addEventListener','remove','focus','setAttribute','removeAttribute','scrollIntoView','click'].includes(k))return noop;if(k==='querySelector'||k==='querySelectorAll')return()=>fakeNode;if(k==='childNodes'||k==='classList')return[];if(k==='style')return{};return'';},set(){return true;}});
const sandbox={console,setTimeout,clearTimeout,Blob:class{},URL:{createObjectURL:()=>'blob:x',revokeObjectURL:noop},
 localStorage:{getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
 fetch:()=>Promise.reject(new Error('x')),navigator:{},location:{hash:'',protocol:'http:',replace:noop},
 document:{createElement:()=>fakeNode,createTextNode:()=>fakeNode,getElementById:()=>fakeNode,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop,removeEventListener:noop,body:fakeNode},
 window:{addEventListener:noop,scrollTo:noop,scrollY:0}};
sandbox.globalThis=sandbox; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('app.js','utf8'),sandbox);
const ctx=sandbox;
ctx.plan=JSON.parse(fs.readFileSync('data/plan.json','utf8'));
ctx.baselines=[{date:'2026-09-01',bodyweightKg:78,pullup5RMAddedKg:20}];

let pass=0,fail=0;
function eq(l,g,w){const ok=JSON.stringify(g)===JSON.stringify(w);if(ok)pass++;else{fail++;console.log(`  FAIL ${l}\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`);}}
function ok(l,c){if(c)pass++;else{fail++;console.log(`  FAIL ${l}`);}}

const ci=(date,pain,stiff)=>({date,pain:Object.assign({elbow:0,shoulder:0,achilles:0,hamstring:0},pain),stiffness:stiff||'none'});
const S=id=>ctx.plan.sessions.find(s=>s.id===id);

/* W5 starts 2026-10-12, W6 starts 2026-10-19 */
const W5=ctx.plan.weeks.find(w=>w.id==='W5'), W6=ctx.plan.weeks.find(w=>w.id==='W6');
console.log('week windows:');
eq('W5 window', ctx.weekWindow(W5), {from:'2026-10-12', to:'2026-10-18'});
eq('previous of W6', ctx.previousWeek('W6').id, 'W5');
eq('previous of first', ctx.previousWeek('W2'), null);
eq('addDays across month', ctx.addDays('2026-10-30', 5), '2026-11-04');
eq('addDays across year', ctx.addDays('2026-12-30', 5), '2027-01-04');

/* ---- no check-ins: nothing is gated ---- */
console.log('no check-ins:');
ctx.checkIns=[];
let g=ctx.sessionGate(S('W6-Mon'));
eq('no holds', g.holds, {});
eq('no suppression', g.suppressed, {});

/* ---- amber in week N holds week N+1 ---- */
console.log('amber in W5 holds W6:');
ctx.checkIns=[ci('2026-10-14',{achilles:4})];          // amber, mid-W5
g=ctx.sessionGate(S('W6-Mon'));
eq('achilles tracks held', Object.keys(g.holds).sort(), ['heelRaise','pogo']);
eq('held area named', g.heldAreas, ['achilles']);
eq('nothing suppressed', g.suppressed, {});

console.log('...but not week N itself:');
g=ctx.sessionGate(S('W5-Mon'));
eq('W5 ungated by its own amber', g.holds, {});

console.log('...and not week N+2:');
g=ctx.sessionGate(S('W7-Mon'));
eq('W7 clear again', g.holds, {});

console.log('amber outside the week window does not carry:');
ctx.checkIns=[ci('2026-10-11',{achilles:4})];          // day before W5 starts
eq('W6 unaffected', ctx.sessionGate(S('W6-Mon')).holds, {});

/* ---- a held exercise shows last week's load ---- */
console.log("held load is last week's:");
ctx.checkIns=[ci('2026-10-14',{elbow:4})];             // amber elbow in W5 -> holds pullup, dips in W6
const w6mon=S('W6-Mon'), w6pull=w6mon.exercises.find(e=>e.track==='pullup');
const prev=ctx.previousWeek('W6');
/* W5 pull-up is 72% and W6 is 76%. At a 20 kg 5RM both round to the same
   plate, so use a 5RM where the two weeks genuinely separate. */
ctx.baselines=[{date:'2026-09-01',bodyweightKg:78,pullup5RMAddedKg:40}];
const heldTxt=ctx.heldLoad(w6pull, w6mon, prev).text;
const ownTxt=ctx.resolveLoad(w6pull.load, w6mon.date).text;
const w5pull=ctx.sessionsForWeek('W5').flatMap(s=>s.exercises).find(e=>e.track==='pullup');
const w5date=ctx.sessionsForWeek('W5').find(s=>s.exercises.some(e=>e.track==='pullup')).date;
eq('held equals W5 resolved', heldTxt, ctx.resolveLoad(w5pull.load, w5date).text);
eq('W5 72% of 40 = 28.8 -> 28.75', heldTxt, '+28.75 kg');
eq('W6 76% of 40 = 30.4 -> 30', ownTxt, '+30 kg');
ok('hold shows last week, not the rise', heldTxt !== ownTxt);

/* and at the real 20 kg 5RM the two collapse onto one plate — not a bug,
   that is the 1.25 kg rounding doing its job */
ctx.baselines=[{date:'2026-09-01',bodyweightKg:78,pullup5RMAddedKg:20}];
eq('collapse at 20 kg', ctx.heldLoad(w6pull, w6mon, prev).text, ctx.resolveLoad(w6pull.load, w6mon.date).text);

/* ---- red suppresses for 7 days ---- */
console.log('red suppresses for 7 days:');
ctx.checkIns=[ci('2026-10-19',{hamstring:8})];         // red on the Monday of W6
eq('day 1 suppressed', Object.keys(ctx.sessionGate({week:'W6',date:'2026-10-19',exercises:[]}).suppressed).sort(), ['hinge','nordic','sprint']);
eq('day 7 still suppressed', Object.keys(ctx.sessionGate({week:'W6',date:'2026-10-25',exercises:[]}).suppressed).sort(), ['hinge','nordic','sprint']);
eq('day 8 clear', ctx.sessionGate({week:'W6',date:'2026-10-26',exercises:[]}).suppressed, {});
eq('before it happened', ctx.sessionGate({week:'W6',date:'2026-10-18',exercises:[]}).suppressed, {});

console.log('suppressed tracks are not also badged HOLD:');
ctx.checkIns=[ci('2026-10-14',{hamstring:4}), ci('2026-10-19',{hamstring:8})];
g=ctx.sessionGate({week:'W6',date:'2026-10-19',exercises:[]});
eq('no overlap', Object.keys(g.holds).filter(t=>g.suppressed[t]), []);

/* ---- the hardcoded elbow rule ---- */
console.log('elbow amber holds the pull-up regardless of week boundaries:');
ctx.checkIns=[ci('2026-10-20',{elbow:4})];             // amber elbow mid-W6
g=ctx.sessionGate({week:'W6',date:'2026-10-21',exercises:[]});
ok('pull-up held same week', g.holds.pullup === true);
eq('no week-rule areas', g.heldAreas, []);
console.log('   and it lapses after seven days:');
eq('day 8 clear', ctx.sessionGate({week:'W6',date:'2026-10-28',exercises:[]}).holds, {});

console.log('a non-elbow amber does NOT hold the pull-up mid-week:');
ctx.checkIns=[ci('2026-10-20',{achilles:4})];
eq('no pull-up hold', ctx.sessionGate({week:'W6',date:'2026-10-21',exercises:[]}).holds.pullup, undefined);

/* ---- red in week N also holds week N+1 ---- */
console.log('red in week N still holds week N+1 once suppression lapses:');
ctx.checkIns=[ci('2026-10-13',{achilles:8})];          // red early in W5
g=ctx.sessionGate(S('W6-Mon'));                        // W6-Mon is 2026-10-19, 6 days later
ok('either suppressed or held', Object.keys(g.suppressed).length > 0 || Object.keys(g.holds).length > 0);
g=ctx.sessionGate({week:'W6',date:'2026-10-24',exercises:[]});   // past the 7 days
eq('now held not suppressed', Object.keys(g.holds).sort(), ['heelRaise','pogo']);
eq('suppression lapsed', g.suppressed, {});

/* ---- derived: correcting the входной entry re-gates ---- */
console.log('derived, not stored:');
ctx.checkIns=[ci('2026-10-14',{achilles:4})];
ok('held before correction', Object.keys(ctx.sessionGate(S('W6-Mon')).holds).length === 2);
ctx.checkIns[0].pain.achilles=1;
eq('clear after correction', ctx.sessionGate(S('W6-Mon')).holds, {});

/* ---- every session gates without throwing ---- */
console.log('all 73 sessions:');
ctx.checkIns=[ci('2026-10-14',{elbow:4,achilles:8}), ci('2026-11-10',{hamstring:6})];
let errs=[];
ctx.plan.sessions.forEach(s=>{ try { ctx.sessionGate(s); } catch(e){ errs.push(s.id+': '+e.message); } });
eq('no throws', errs, []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
