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

const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const idx=read('data/areas/index.json');
ctx.areaData={rules:read('data/rules.json'),legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};
const reset=()=>{ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.checkIns=[];ctx.schedule={};ctx.settings={};store.dayPlans=undefined;delete store.dayPlans;delete store.areaDays;};
const logAllSets=(sid)=>{ctx.sessionById(sid).exercises.forEach(e=>{for(let i=0;i<e.sets;i++)ctx.writeLog(sid,e.id,i,{done:true});});};

console.log('ids:');
eq('an area on a date', ctx.parseAreaDayId('2026-10-06:mu'), {date:'2026-10-06',area:'mu'});
eq('another area', ctx.parseAreaDayId('2026-12-31:oap'), {date:'2026-12-31',area:'oap'});
eq('a plan session is not one', ctx.parseAreaDayId('W3-Thu'), null);
eq('a test session is not one', ctx.parseAreaDayId('TEST-Dec29'), null);
eq('a loose date is not one', ctx.parseAreaDayId('2026-10-06'), null);
eq('round trip', ctx.parseAreaDayId(ctx.areaDayId('2026-10-06','kb')), {date:'2026-10-06',area:'kb'});

console.log('a day plan is cleaned, never trusted:');
eq('a good one', ctx.cleanDayPlan({sittings:[{minutes:45,areas:['mu','bridge']}],suggested:['mu'],removed:{pistol:'no time'}}),
   {sittings:[{minutes:45,areas:['mu','bridge']}],suggested:['mu'],removed:{pistol:'no time'}});
eq('not an object', ctx.cleanDayPlan('x'), null);
eq('an array', ctx.cleanDayPlan([]), null);
eq('no sittings', ctx.cleanDayPlan({sittings:[]}), null);
eq('sittings the wrong type', ctx.cleanDayPlan({sittings:'45'}), null);
eq('no more than three sittings', ctx.cleanDayPlan({sittings:[{minutes:30,areas:[]},{minutes:30,areas:[]},{minutes:30,areas:[]},{minutes:30,areas:[]}]}).sittings.length, 3);
eq('a nonsense length falls back', ctx.cleanDayPlan({sittings:[{minutes:-5,areas:[]}]}).sittings[0].minutes, 45);
eq('a huge length falls back', ctx.cleanDayPlan({sittings:[{minutes:99999,areas:[]}]}).sittings[0].minutes, 45);
eq('areas are de-duplicated and typed', ctx.cleanDayPlan({sittings:[{minutes:30,areas:['mu','mu',7,null,'kb']}]}).sittings[0].areas, ['mu','kb']);
eq('removed reasons are strings', ctx.cleanDayPlan({sittings:[{minutes:30,areas:[]}],removed:{a:5,b:'tired'}}).removed, {a:'',b:'tired'});

console.log('storage round trip and bad data:');
reset();
ctx.dayPlans={'2026-10-06':{sittings:[{minutes:30,areas:['mu']}],suggested:['mu'],removed:{}}};
ctx.saveDayPlans(); ctx.dayPlans={}; ctx.loadDayPlans();
eq('survives a reload', ctx.dayPlans['2026-10-06'].sittings[0].areas, ['mu']);
store.dayPlans=JSON.stringify({'2026-10-06':{sittings:[{minutes:30,areas:['mu']}]},'not-a-date':{sittings:[{minutes:30,areas:[]}]},'2026-10-07':'junk','2026-10-08':{sittings:[]}});
ctx.loadDayPlans();
eq('only the good day is kept', Object.keys(ctx.dayPlans), ['2026-10-06']);
store.dayPlans='[1,2]'; ctx.loadDayPlans(); eq('an array is an empty store', ctx.dayPlans, {});
store.dayPlans='not json'; ctx.loadDayPlans(); eq('garbage is an empty store', ctx.dayPlans, {});
store.areaDays=JSON.stringify({'2026-10-06:mu':{stage:'M1',type:'strength'},'2026-10-06:kb':{stage:'K1'},'bad':{stage:'M1'},'2026-10-07:mu':{type:'skill'}});
ctx.loadFrozenDays();
eq('frozen days keep the well-formed', Object.keys(ctx.frozenDays).sort(), ['2026-10-06:kb','2026-10-06:mu']);
eq('and their type only when they have one', [ctx.frozenDays['2026-10-06:kb'], ctx.frozenDays['2026-10-06:mu']], [{stage:'K1'},{stage:'M1',type:'strength'}]);

console.log('how long you have, per weekday:');
reset();
eq('the first time it is the default', ctx.defaultMinutes('2026-10-06'), 45);
ctx.rememberMinutes('2026-10-06', 30);                      // a Tuesday
eq('Tuesdays are now 30', ctx.defaultMinutes('2026-10-13'), 30);
eq('Wednesdays are not', ctx.defaultMinutes('2026-10-07'), 45);
ok('and it is saved', JSON.parse(store.settings).weekdayMinutes[1] === 30);

console.log('muscle-up alternates strength and skill:');
reset();
const mu=ctx.areaById('mu');
eq('never done: the first type', ctx.nextSessionType(mu, mu.stages[0], '2026-10-05'), 'strength');
ctx.freezeAreaDay('2026-10-05','mu');
eq('frozen as strength', ctx.frozenDays['2026-10-05:mu'], {stage:'M1',type:'strength'});
eq('planned but not done does not count', ctx.nextSessionType(mu, mu.stages[0], '2026-10-07'), 'strength');
ctx.writeLog('2026-10-05:mu','par-dips',0,{done:true});
eq('once something is logged, skill is next', ctx.nextSessionType(mu, mu.stages[0], '2026-10-07'), 'skill');
ctx.freezeAreaDay('2026-10-07','mu'); ctx.writeLog('2026-10-07:mu','sternum-pull',0,{done:true});
eq('then strength again', ctx.nextSessionType(mu, mu.stages[0], '2026-10-09'), 'strength');
eq('a day is frozen once: asking again changes nothing', ctx.freezeAreaDay('2026-10-05','mu'), {stage:'M1',type:'strength'});
eq('and the past is not rewritten by what came after', ctx.areaDaySession('2026-10-05','mu').type, 'strength');
eq('an area with no types freezes with only a stage', ctx.freezeAreaDay('2026-10-05','pistol'), {stage:'P1'});

console.log('taking an area off before doing it:');
reset();
ctx.freezeAreaDay('2026-10-05','mu'); ctx.unfreezeAreaDay('2026-10-05','mu');
eq('forgotten', ctx.frozenDays, {});
ctx.freezeAreaDay('2026-10-05','mu'); ctx.writeLog('2026-10-05:mu','par-dips',0,{done:true}); ctx.unfreezeAreaDay('2026-10-05','mu');
ok('but not once something is logged', !!ctx.frozenDays['2026-10-05:mu']);

console.log('an area-day looks like a session:');
reset();
ctx.freezeAreaDay('2026-10-05','mu');
const s=ctx.sessionById('2026-10-05:mu');
eq('found by id', s.id, '2026-10-05:mu');
eq('dated', ctx.sessionDate(s), '2026-10-05');
eq('a Monday', s.day, 'Mon');
eq('knows its area and stage', [s.areaId, s.stageId, s.type], ['mu','M1','strength']);
eq('strength is the five old exercises', s.exercises.map(e=>e.id), ['par-dips','bar-support','hollow','dip-neg','strict-pull']);
eq('with 17 sets', ctx.totalSets(s), 17);
ctx.freezeAreaDay('2026-10-06','pistol');
eq('an untyped area has all of its exercises', ctx.sessionById('2026-10-06:pistol').exercises.length, 4);
eq('a draft is marked', [ctx.sessionById('2026-10-06:pistol').draft, s.draft], [true, false]);
eq('an unknown area is not a session', ctx.sessionById('2026-10-06:rowing'), null);
eq('plan sessions are untouched', ctx.sessionById('W2-Mon').name, 'A — Pull Strength & Dip Volume');
eq('the gate works on it', Object.keys(ctx.sessionGate(s).suppressed), []);
eq('an unfrozen day previews the same thing', ctx.sessionById('2026-10-07:mu').type, 'strength');

console.log('logging it, and how it counts:');
reset();
ctx.freezeAreaDay('2026-10-05','mu');
ctx.writeLog('2026-10-05:mu','par-dips',0,{done:true}); ctx.writeLog('2026-10-05:mu','par-dips',1,{done:true});
let days=ctx.areaDays();
eq('two sets of seventeen is a partial day', days.filter(r=>r.date==='2026-10-05'&&r.area==='mu').map(r=>[r.done,r.total,r.full]), [[2,17,false]]);
logAllSets('2026-10-05:mu');
days=ctx.areaDays();
eq('every set makes it full', days.find(r=>r.date==='2026-10-05'&&r.area==='mu').full, true);
eq('its counts', ctx.doneSets(ctx.sessionById('2026-10-05:mu')), 17);
ctx.writeLog('2026-10-05:mu','not-an-exercise',0,{done:true});
eq('a set against an exercise the day does not hold is not counted', ctx.areaDays().find(r=>r.date==='2026-10-05'&&r.area==='mu').done, 17);
ctx.writeLog('2026-10-05:mu','par-dips',9,{done:true});
eq('nor one past its sets', ctx.areaDays().find(r=>r.date==='2026-10-05'&&r.area==='mu').done, 17);

console.log('old and new history add up on the same day:');
reset();
ctx.schedule={'W2-Mon':'2026-10-05'}; logAllSets('W2-Mon');                  // old muscle-up: 10 sets that day
ctx.freezeAreaDay('2026-10-05','mu'); ctx.writeLog('2026-10-05:mu','par-dips',0,{done:true});
const merged=ctx.areaDays().filter(r=>r.date==='2026-10-05'&&r.area==='mu');
eq('one record', merged.length, 1);
eq('added together', [merged[0].done, merged[0].total], [11, 27]);
ctx.schedule={};

console.log('the red light pauses a whole area:');
reset();
ctx.checkIns=[ci('2026-10-03',{hamstring:8})];
ctx.freezeAreaDay('2026-10-05','nordic'); ctx.freezeAreaDay('2026-10-05','mu');
const nd=ctx.sessionById('2026-10-05:nordic'), md=ctx.sessionById('2026-10-05:mu');
eq('Nordic is paused', ctx.areaPaused(nd), true);
eq('so it has nothing to do', [ctx.totalSets(nd), ctx.runnableIndexes(nd), ctx.nextRunnable(nd,0)], [0, [], -1]);
eq('muscle-up is not', [ctx.areaPaused(md), ctx.totalSets(md)], [false, 17]);
eq('a day after the window it is back', ctx.areaPaused(ctx.sessionById('2026-10-10:nordic')), false);
ctx.checkIns=[ci('2026-10-03',{achilles:8})];
eq('Achilles red pauses plyometrics', ctx.areaPaused(ctx.areaDaySession('2026-10-05','plyo')), true);
eq('but not Nordic', ctx.areaPaused(ctx.areaDaySession('2026-10-05','nordic')), false);
ctx.checkIns=[];

console.log('the runner can run an area-day:');
reset();
ctx.freezeAreaDay('2026-10-05','hspu');
ctx.enterRunner('2026-10-05:hspu', 0);
const seen=[];
for (let i=0;i<10 && ctx.runner && ctx.runner.phase!=='finished';i++){ seen.push(ctx.runExercise().id); ctx.skipExercise(); }
eq('walks every exercise', seen, ['wrist-prep','pike-pushup','pike-shrug','hollow']);
eq('and finishes', ctx.runner.phase, 'finished');
ctx.leaveRunner();
ctx.checkIns=[ci('2026-10-03',{hamstring:8})];
ctx.freezeAreaDay('2026-10-05','nordic');
ctx.location.hash='';
ctx.enterRunner('2026-10-05:nordic', 0);
eq('a paused area is not run, it sends you back to Today', ctx.location.hash, '#/today');
ok('and no runner was left open', !ctx.runner || ctx.runner.sessionId !== '2026-10-05:nordic');
ctx.checkIns=[];

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
