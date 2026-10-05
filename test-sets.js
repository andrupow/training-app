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
function ok(l,c){if(c)pass++;else{fail++;console.log(`  FAIL ${l}`);}}
sandbox.document.createElementNS=()=>fakeNode;
sandbox.document.body=new Proxy({},{get(t,k){return k==='classList'?{add:noop,remove:noop}:fakeNode[k];},set(){return true;}});
vm.runInContext(fs.readFileSync('app.js','utf8'),sandbox);
const ctx=sandbox;
ctx.plan=JSON.parse(fs.readFileSync('data/plan.json','utf8'));
ctx.baselines=[{date:'2026-09-01',bodyweightKg:78,pullup5RMAddedKg:20}];

let pass=0,fail=0;
function eq(l,g,w){const ok=JSON.stringify(g)===JSON.stringify(w);if(ok)pass++;else{fail++;console.log(`  FAIL ${l}\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`);}}

sandbox.document.createElementNS=()=>fakeNode;

const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const idx=read('data/areas/index.json');
ctx.areaData={rules:read('data/rules.json'),legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};
const reset=()=>{ctx.setLogs=[];ctx.logIndex={};ctx.schedule={};ctx.settings={};delete store.setLogs;};
const put=(e)=>{ctx.setLogs.push(e);ctx.logIndex[ctx.logKey(e.sessionId,e.exerciseId,e.setIdx)]=e;};
const L=ctx.SET_LIMITS;

console.log('what the set sheet accepts:');
eq('blank means as planned', ctx.checkSetValue('',L[0]), {value:undefined});
eq('spaces are blank too', ctx.checkSetValue('  ',L[1]), {value:undefined});
eq('a plain number', ctx.checkSetValue('20',L[0]), {value:20});
eq('a decimal comma', ctx.checkSetValue('22,5',L[0]), {value:22.5});
eq('the top of the load range', ctx.checkSetValue('250',L[0]), {value:250});
eq('zero reps is allowed (a failed attempt)', ctx.checkSetValue('0',L[1]), {value:0});
eq('RPE 1 and 10 are the ends', [ctx.checkSetValue('1',L[2]).value, ctx.checkSetValue('10',L[2]).value], [1,10]);

console.log('and what it refuses, with a message that says why:');
eq('500 kg', ctx.checkSetValue('500',L[0]), {error:'Load has to be between 0 and 250 kg.'});
eq('just over the load limit', ctx.checkSetValue('250.1',L[0]).error, 'Load has to be between 0 and 250 kg.');
eq('a negative load', ctx.checkSetValue('-1',L[0]).error, 'Load has to be between 0 and 250 kg.');
eq('999 reps', ctx.checkSetValue('999',L[1]), {error:'Reps has to be between 0 and 300.'});
eq('RPE 0', ctx.checkSetValue('0',L[2]), {error:'RPE has to be between 1 and 10.'});
eq('RPE 11', ctx.checkSetValue('11',L[2]).error, 'RPE has to be between 1 and 10.');
eq('letters', ctx.checkSetValue('abc',L[1]), {error:'Reps has to be a number.'});
eq('exponent notation is a number, and far too big', ctx.checkSetValue('1e3',L[1]).error, 'Reps has to be between 0 and 300.');
ok('nothing is trimmed to the limit: refused values carry no value', !('value' in ctx.checkSetValue('999',L[1])));

console.log('sets already on the phone that cannot be real:');
reset();
eq('nothing logged, nothing suspect', ctx.suspectSets(), []);
put({sessionId:'W2-Tue',exerciseId:'heel-raise',setIdx:0,done:true,loadKg:500,reps:999,rpe:10,ts:'2026-09-23T10:48:11.994Z'});
put({sessionId:'W2-Tue',exerciseId:'heel-raise',setIdx:1,done:true,ts:'2026-09-23T10:51:47.574Z'});
put({sessionId:'W2-Mon',exerciseId:'par-dips',setIdx:0,done:true,loadKg:20,reps:5,rpe:8,ts:'2026-09-20T03:51:32.241Z'});
put({sessionId:'W2-Mon',exerciseId:'par-dips',setIdx:1,done:true,loadKg:250,reps:300,rpe:1,ts:'2026-09-20T03:54:18.231Z'});
let sus=ctx.suspectSets();
eq('only the 500 kg × 999 set', sus.map(s=>[s.entry.sessionId,s.entry.exerciseId,s.entry.setIdx]), [['W2-Tue','heel-raise',0]]);
eq('with load and reps as the odd ones', sus[0].bad.map(l=>l.key), ['loadKg','reps']);
eq('the limits themselves are fine', ctx.suspectSets().some(s=>s.entry.exerciseId==='par-dips'), false);
put({sessionId:'W2-Mon',exerciseId:'hollow',setIdx:0,done:true,rpe:0,ts:'2026-09-20T04:05:52.860Z'});
put({sessionId:'W2-Mon',exerciseId:'hollow',setIdx:1,done:true,reps:'5',ts:'2026-09-20T04:07:24.862Z'});
sus=ctx.suspectSets();
eq('an RPE of 0 and a string where a number belongs are caught too', sus.slice(1).map(s=>[s.entry.exerciseId,s.entry.setIdx,s.bad.map(l=>l.key)]), [['hollow',0,['rpe']],['hollow',1,['reps']]]);

console.log('clearing keeps the set done:');
reset();
const typo={sessionId:'W2-Tue',exerciseId:'heel-raise',setIdx:0,done:true,loadKg:500,reps:999,rpe:10,ts:'2026-09-23T10:48:11.994Z'};
put(typo);
ctx.clearSuspect(ctx.suspectSets()[0]);
let kept=ctx.getLog('W2-Tue','heel-raise',0);
eq('still there and still done', [!!kept, kept&&kept.done], [true,true]);
eq('the odd numbers are gone, the sound one stays', [kept.loadKg,kept.reps,kept.rpe], [undefined,undefined,10]);
eq('and the time it was logged is unchanged', kept.ts, '2026-09-23T10:48:11.994Z');
eq('nothing is suspect any more', ctx.suspectSets(), []);
ok('and it was saved', JSON.parse(store.setLogs).some(e=>e.sessionId==='W2-Tue'&&e.done&&e.loadKg===undefined));
reset();
put({sessionId:'W2-Tue',exerciseId:'heel-raise',setIdx:2,done:false,loadKg:900,ts:'2026-09-23T10:50:00.000Z'});
ctx.clearSuspect(ctx.suspectSets()[0]);
eq('a set that was never done and held only the typo disappears', ctx.getLog('W2-Tue','heel-raise',2), null);

console.log('saying where it came from:');
reset();
const d1=ctx.describeLoggedSet({sessionId:'W2-Tue',exerciseId:'heel-raise',setIdx:0,ts:'2026-09-23T10:48:11.994Z'});
const s1=ctx.sessionById('W2-Tue');
eq('the exercise by name and the set by number', d1.what, s1.exercises.find(x=>x.id==='heel-raise').name+' · set 1');
eq('on the day the session was held', d1.when, ctx.fmtDate(ctx.sessionDate(s1)));
const d2=ctx.describeLoggedSet({sessionId:'gone-session',exerciseId:'mystery',setIdx:2,ts:'2026-09-23T10:48:11.994Z'});
eq('a session that no longer exists falls back to the id and the time stamp', [d2.what,d2.when], ['mystery · set 3',ctx.fmtDate('2026-09-23')]);
eq('and with no time stamp either, says so', ctx.describeLoggedSet({sessionId:'gone-session',exerciseId:'mystery',setIdx:0}).when, 'date unknown');
eq('values read back as written', ctx.setBits({loadKg:500,reps:999,rpe:10}), ['500 kg','999 reps','RPE 10']);
eq('one rep is singular', ctx.setBits({reps:1}), ['1 rep']);

console.log('the card and the tab dot:');
reset();
ok('no card when everything is fine', ctx.dataCheckSection()===null);
put(typo);
put({sessionId:'W2-Mon',exerciseId:'hollow',setIdx:0,done:true,rpe:0,ts:'2026-09-20T04:05:52.860Z'});
ok('a card when something is off, with one or several', (()=>{try{return ctx.dataCheckSection()!==null;}catch(e){return false;}})());
ok('the tab dot logic runs with suspects present', (()=>{try{ctx.paintTabBadge();return true;}catch(e){return false;}})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
