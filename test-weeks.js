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

/* the area data, as the app would have fetched it */
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const idx=read('data/areas/index.json');
ctx.areaData={rules:read('data/rules.json'),legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};
const A=id=>ctx.areaById(id);
/* These tests are about status and menu logic, so every week is pinned to the targets
   as authored: no time fit, no ramp-in. test-fit.js covers those. */
const pinWeeks=()=>{const t={};ctx.areaList().forEach(a=>{t[a.id]=ctx.stageWeek(a,ctx.currentStage(a)).target;});ctx.weekFits={};
  for(let d='2026-08-31',i=0;i<30;i++,d=ctx.addDays(d,7))ctx.weekFits[d]={budget:999,cost:0,minCost:0,startCost:0,verdict:'fits',targets:Object.assign({},t),trimmed:[],ramp:[]};};
pinWeeks();
const S=id=>ctx.plan.sessions.find(s=>s.id===id);
const ci=(date,pain)=>({date,pain:Object.assign({elbow:0,shoulder:0,achilles:0,hamstring:0},pain),stiffness:'none'});
ctx.checkIns=[]; ctx.schedule={}; ctx.setLogs=[]; ctx.logIndex={};
const logAll=id=>S(id).exercises.forEach(e=>{for(let i=0;i<e.sets;i++)ctx.writeLog(id,e.id,i,{done:true});});
const rec=(date,area,full=true)=>({date,area,done:full?4:1,total:4,full});

console.log('weeks run Monday to Sunday:');
eq('Monday is day 0', ctx.isoDow('2026-10-05'), 0);
eq('Sunday is day 6', ctx.isoDow('2026-10-11'), 6);
eq('a Sunday belongs to the week that started six days before', ctx.weekStartOf('2026-10-11'), '2026-10-05');
eq('a Monday starts its own week', ctx.weekStartOf('2026-10-05'), '2026-10-05');
eq('across a month end', ctx.weekStartOf('2026-11-01'), '2026-10-26');
eq('across a year end', ctx.weekStartOf('2027-01-01'), '2026-12-28');

console.log('old sessions split by exercise into area-days:');
ctx.schedule={'W2-Mon':'2026-09-20','W2-Tue':'2026-09-23','W2-Thu':'2026-09-29'};
['W2-Mon','W2-Tue','W2-Thu'].forEach(logAll);
let days=ctx.areaDays();
const pick=(date,area)=>days.find(r=>r.date===date&&r.area===area);
ok('Monday counts as muscle-up', pick('2026-09-20','mu') && pick('2026-09-20','mu').full);
eq('the weighted pull-up in it is not counted', pick('2026-09-20','mu').total, 10);   // par-dips 4 + bar-support 3 + hollow 3
ok('Tuesday heel raises are plyometrics', pick('2026-09-23','plyo') && pick('2026-09-23','plyo').done===4);
ok('Tuesday sprints, hinge and kettlebell press are history only', !pick('2026-09-23','kb') && days.filter(r=>r.date==='2026-09-23').length===1);
ok('Thursday is Nordic and plyometrics the same day', pick('2026-09-29','nordic') && pick('2026-09-29','plyo'));
eq('plyometrics there is pogo plus Achilles holds', pick('2026-09-29','plyo').done, 9);
eq('Thursday has exactly those two', days.filter(r=>r.date==='2026-09-29').length, 2);
eq('five area-days in all', days.length, 4);

console.log('partial versus full:');
ctx.setLogs=[]; ctx.logIndex={};
ctx.writeLog('W2-Mon','par-dips',0,{done:true}); ctx.writeLog('W2-Mon','par-dips',1,{done:true});
days=ctx.areaDays();
ok('two sets of ten is trained but not full', pick('2026-09-20','mu') && !pick('2026-09-20','mu').full);
eq('and it says how much', [pick('2026-09-20','mu').done, pick('2026-09-20','mu').total], [2,10]);
ctx.writeLog('W2-Mon','par-dips',2,{done:true}); ctx.writeLog('W2-Mon','par-dips',3,{done:true});
ctx.writeLog('W2-Mon','bar-support',0,{done:true}); ctx.writeLog('W2-Mon','bar-support',1,{done:true}); ctx.writeLog('W2-Mon','bar-support',2,{done:true});
ctx.writeLog('W2-Mon','hollow',0,{done:true}); ctx.writeLog('W2-Mon','hollow',1,{done:true}); ctx.writeLog('W2-Mon','hollow',2,{done:true});
days=ctx.areaDays();
ok('every set of the block makes it full', pick('2026-09-20','mu').full);
ctx.setLogs=[]; ctx.logIndex={};
eq('nothing logged, nothing trained', ctx.areaDays(), []);

console.log('the week, for an area with target 2, 2 days apart (muscle-up):');
const mu=A('mu');
const wk=(today,recs,start='2026-10-05')=>ctx.areaWeek(mu,start,today,recs);
eq('Wednesday, nothing yet: room to spare', wk('2026-10-07',[]).status.key, 'track');
eq('Thursday, nothing yet: must go today', wk('2026-10-08',[]).status.key, 'due');
eq('Friday: still must go today', wk('2026-10-09',[]).status.key, 'due');
eq('Saturday: two no longer fit, and its minimum is also two, so at risk', wk('2026-10-10',[]).status.key, 'risk');
eq('Sunday: same', wk('2026-10-11',[]).status.key, 'risk');
eq('one done Monday, Wednesday is on track', wk('2026-10-07',[rec('2026-10-05','mu')]).status.key, 'track');
eq('one done Monday, Thursday still has room', wk('2026-10-08',[rec('2026-10-05','mu')]).status.key, 'track');
eq('one done Monday, Sunday is the last chance, so due', wk('2026-10-11',[rec('2026-10-05','mu')]).status.key, 'due');
eq('target reached is done', wk('2026-10-08',[rec('2026-10-05','mu'),rec('2026-10-07','mu')]).status.key, 'done');
eq('days trained, with the cells', wk('2026-10-08',[rec('2026-10-05','mu'),rec('2026-10-07','mu',false)]).cells.map(c=>c.state), ['full','none','partial','none','future','future','future']);
eq('a partial day counts toward the week', wk('2026-10-08',[rec('2026-10-05','mu'),rec('2026-10-07','mu',false)]).touched, 2);
eq('but only the full one counts as full', wk('2026-10-08',[rec('2026-10-05','mu'),rec('2026-10-07','mu',false)]).full, 1);

console.log('spacing carries over from last week:');
eq('trained Sunday: Monday is too soon, still on track', wk('2026-10-05',[rec('2026-10-04','mu')]).status.key, 'track');
eq('trained Sunday, nothing since: Thursday is due', wk('2026-10-08',[rec('2026-10-04','mu')]).status.key, 'due');
eq('trained today: the next one is two days off', ctx.areaWeek(mu,'2026-10-05','2026-10-05',[rec('2026-10-05','mu')]).status.key, 'track');

console.log('a long gap needs an earlier start (one-arm pull-up: target 2, 3 days apart):');
const oap=A('oap');
const wo=(today,recs)=>ctx.areaWeek(oap,'2026-10-05',today,recs);
eq('Monday: on track', wo('2026-10-05',[]).status.key, 'track');
eq('Thursday: two 3 days apart still just fit, so due', wo('2026-10-08',[]).status.key, 'due');
eq('Friday: only one fits, the minimum is one', wo('2026-10-09',[]).status.key, 'behind');
eq('Monday of next week would be a new week', ctx.areaWeek(oap,'2026-10-12','2026-10-12',[]).status.key, 'track');
eq('a partial Saturday leaves nothing that fits on Sunday', ctx.areaWeek(mu,'2026-10-05','2026-10-11',[rec('2026-10-10','mu',false)]).status.key, 'risk');
eq('kettlebell needs two more with exactly two days left, so due', ctx.areaWeek(A('kb'),'2026-10-05','2026-10-10',[rec('2026-10-06','kb')]).status.key, 'due');
eq('kettlebell with one done on Saturday, Sunday left: behind', ctx.areaWeek(A('kb'),'2026-10-05','2026-10-11',[rec('2026-10-10','kb')]).status.key, 'behind');

console.log('at risk: even the minimum is out of reach (muscle-up, 2 a week minimum):');
eq('Sunday with nothing, trained Saturday', ctx.areaWeek(mu,'2026-10-05','2026-10-11',[rec('2026-10-10','mu')]).status.key, 'risk');

console.log('finished weeks are judged by what happened:');
const done=(touched)=>ctx.areaWeek(mu,'2026-10-05','2026-10-20',Array.from({length:touched},(_,i)=>rec(ctx.addDays('2026-10-05',i*2),'mu'))).status.key;
eq('none', done(0), 'missed');
eq('one is below the minimum of two', done(1), 'missed');
eq('two is the target', done(2), 'hit');
eq('three is the max, not over', done(3), 'hit');
eq('four is over', done(4), 'over');
eq('one-arm pull-up needs only one to meet its minimum', ctx.areaWeek(oap,'2026-10-05','2026-10-20',[rec('2026-10-06','oap')]).status.key, 'met');

console.log('the red light holds an area:');
ctx.checkIns=[ci('2026-10-03',{hamstring:8})];
const nordic=A('nordic');
const wn=ctx.areaWeek(nordic,'2026-10-05','2026-10-06',[]);
eq('Nordic is held while the hamstring is red', wn.status.key, 'held');
eq('and says why', wn.status.label, 'Held · hamstring red');
eq('muscle-up is not held by it', ctx.areaWeek(mu,'2026-10-05','2026-10-06',[]).status.key, 'track');
eq('plyometrics is guarded by Achilles and knee, so not held', ctx.areaWeek(A('plyo'),'2026-10-05','2026-10-06',[]).status.key, 'track');
eq('held lapses with the window', ctx.areaWeek(nordic,'2026-10-05','2026-10-10',[]).status.key !== 'held', true);
ctx.checkIns=[ci('2026-10-03',{achilles:8})];
eq('an Achilles red holds plyometrics (kept for it)', ctx.areaWeek(A('plyo'),'2026-10-05','2026-10-06',[]).status.key, 'held');
eq('target reached beats held', ctx.areaWeek(A('plyo'),'2026-10-05','2026-10-06',[rec('2026-10-05','plyo'),rec('2026-10-06','plyo')]).status.key, 'done');
ctx.checkIns=[];

console.log('stage overrides apply:');
const wN=ctx.areaWeek(nordic,'2026-10-05','2026-10-06',[]);
eq('Nordic in N1 runs 2 / 3 / 3', [wN.min,wN.target,wN.max], [2,3,3]);
eq('with 2 days between', wN.gap, 2);
eq('kettlebell target is 3 even though 5 is the nominal', [A('kb').perWeek.target,A('kb').perWeek.nominalTarget], [3,5]);

console.log('recent weeks and history bounds:');
const hist=[rec('2026-09-20','mu'),rec('2026-09-27','mu'),rec('2026-10-03','mu')];
const first=ctx.firstWeekStart(hist);
eq('first week reaches back to the Sunday before the plan', first, '2026-09-14');
eq('three weeks before 5 Oct', ctx.recentWeekCounts(mu,'2026-10-05',3,hist,first), [1,1,1]);
eq('before there was history is null', ctx.recentWeekCounts(mu,'2026-09-21',3,hist,first), [null,null,1]);
ctx.plan.meta.startDate='2026-09-21';
eq('without earlier logs the plan start sets it', ctx.firstWeekStart([]), '2026-09-21');

console.log('stage progress:');
eq('full days only, in the first stage', ctx.stageProgress(mu,[rec('2026-10-05','mu'),rec('2026-10-07','mu',false),rec('2026-10-09','mu')]).full, 2);
eq('against the review count', ctx.stageProgress(mu,[]).askAfter, 12);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
