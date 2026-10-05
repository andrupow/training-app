const fs=require('fs'), vm=require('vm');
const store={}; const noop=()=>{};
const fakeNode=new Proxy({},{get(t,k){if(['appendChild','addEventListener','remove','focus','setAttribute','removeAttribute','scrollIntoView','click'].includes(k))return noop;if(k==='querySelector'||k==='querySelectorAll')return()=>fakeNode;if(k==='childNodes'||k==='classList')return[];if(k==='style')return{};return'';},set(){return true;}});
const sandbox={console,setTimeout,clearTimeout,Blob:class{},URL:{createObjectURL:()=>'blob:x',revokeObjectURL:noop},
 localStorage:{getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
 fetch:()=>Promise.reject(new Error('x')),navigator:{},location:{hash:'',protocol:'http:',replace:noop},
 document:{createElement:()=>fakeNode,createTextNode:()=>fakeNode,getElementById:()=>fakeNode,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop,removeEventListener:noop,body:fakeNode},
 window:{addEventListener:noop,scrollTo:noop,scrollY:0}};
sandbox.globalThis=sandbox; vm.createContext(sandbox);
/* The runner needs a body with a classList and an interval; the shared fake DOM has neither. */
sandbox.setInterval=()=>0; sandbox.clearInterval=noop;
sandbox.document.body=new Proxy({},{get(t,k){return k==='classList'?{add:noop,remove:noop}:fakeNode[k];},set(){return true;}});
vm.runInContext(fs.readFileSync('app.js','utf8'),sandbox);
const ctx=sandbox;
ctx.plan=JSON.parse(fs.readFileSync('data/plan.json','utf8'));
ctx.baselines=[{date:'2026-09-01',bodyweightKg:78,pullup5RMAddedKg:20}];

let pass=0,fail=0;
function eq(l,g,w){const ok=JSON.stringify(g)===JSON.stringify(w);if(ok)pass++;else{fail++;console.log(`  FAIL ${l}\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`);}}

function ok(l,c){if(c)pass++;else{fail++;console.log(`  FAIL ${l}`);}}

const ci=(date,pain,stiff)=>({date,pain:Object.assign({elbow:0,shoulder:0,achilles:0,hamstring:0},pain),stiffness:stiff||'none'});
const S=id=>ctx.plan.sessions.find(s=>s.id===id);
const idx=(s,id)=>s.exercises.findIndex(e=>e.id===id);

/* The real case: hamstring check-in of 8/10 on 3 Oct, so red until 9 Oct, and
   the session on 5 Oct (D: pogo, nordic, achilles-iso, copenhagen, kb-light). */
ctx.checkIns=[ci('2026-10-03',{hamstring:8})];
ctx.schedule={'W3-Thu':'2026-10-05'};
const thu=S('W3-Thu');
const names=thu.exercises.map(e=>e.id);
console.log('session under test: '+names.join(', '));

console.log('what the runner may walk:');
ok('nordic is suppressed by the gate', ctx.sessionGate(thu).suppressed.nordic === true);
eq('indexes skip nordic', ctx.runnableIndexes(thu).map(i=>thu.exercises[i].id), names.filter(n=>n!=='nordic'));
eq('next after pogo skips nordic', thu.exercises[ctx.nextRunnable(thu, idx(thu,'pogo')+1)].id, 'achilles-iso');
eq('at nordic itself, moves on', thu.exercises[ctx.nextRunnable(thu, idx(thu,'nordic'))].id, 'achilles-iso');
eq('past the last, nothing left', ctx.nextRunnable(thu, thu.exercises.length), -1);

console.log('the sums leave the paused exercise out:');
const nordicSets=thu.exercises[idx(thu,'nordic')].sets;
const allSets=thu.exercises.reduce((n,e)=>n+e.sets,0);
eq('total excludes nordic', ctx.totalSets(thu), allSets-nordicSets);
ctx.setLogs=[]; ctx.logIndex={};
ctx.writeLog('W3-Thu','nordic',0,{done:true});           // logged before the light, say
eq('done ignores the paused exercise', ctx.doneSets(thu), 0);
ok('but the log is still there', ctx.sessionHasLogs(thu));
ctx.setLogs=[]; ctx.logIndex={};

console.log('walking the session with skip-exercise never lands on nordic:');
ctx.enterRunner('W3-Thu', 0);
const seen=[];
for (let i=0;i<10 && ctx.runner && ctx.runner.phase!=='finished';i++) { seen.push(ctx.runExercise().id); ctx.skipExercise(); }
eq('visited', seen, names.filter(n=>n!=='nordic'));
eq('then finished', ctx.runner.phase, 'finished');

console.log('a link straight to the paused exercise moves on instead:');
ctx.leaveRunner();
ctx.enterRunner('W3-Thu', idx(thu,'nordic'));
eq('lands on the next one', ctx.runExercise().id, 'achilles-iso');
ctx.leaveRunner();

console.log('walking with skip-set also steps over it:');
ctx.enterRunner('W3-Thu', idx(thu,'pogo'));
const pogoSets=thu.exercises[idx(thu,'pogo')].sets;
for (let i=0;i<pogoSets;i++) ctx.skipSet();
eq('after pogo comes achilles-iso', ctx.runExercise().id, 'achilles-iso');
ctx.leaveRunner();

console.log('once the red window lapses, nordic is back:');
ctx.checkIns=[ci('2026-10-03',{hamstring:8})];
ctx.schedule={'W3-Thu':'2026-10-12'};                    // trained after 9 Oct
eq('indexes include nordic again', ctx.runnableIndexes(thu).length, thu.exercises.length);
eq('total is the full total', ctx.totalSets(thu), allSets);

console.log('every exercise paused: nothing to run, and no crash:');
ctx.checkIns=[ci('2026-10-03',{elbow:8,shoulder:8,achilles:8,hamstring:8})];
ctx.schedule={'W2-Tue':'2026-10-05'};
const tue=S('W2-Tue');                                   // sprint, hinge, heel-raise, kb-press, kb-floor
ok('kb-floor has no track, so it still runs', ctx.runnableIndexes(tue).length >= 1);
eq('only untracked exercises remain', ctx.runnableIndexes(tue).map(i=>tue.exercises[i].id), ['kb-floor']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
