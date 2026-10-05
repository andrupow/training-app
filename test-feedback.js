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

const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const idx=read('data/areas/index.json');
const rules=read('data/rules.json');
const real={rules,legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};
const T=rules.verdicts;
const ci=(date,pain,stiff)=>({date,pain:Object.assign({elbow:0,shoulder:0,achilles:0,hamstring:0},pain),stiffness:stiff||'none'});
const reset=()=>{ctx.areaData=real;ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.progress={};ctx.decisions=[];ctx.checkIns=[];ctx.schedule={};ctx.settings={};ctx.weekFits={};
  ['progress','decisions','areaDays','dayPlans','settings','weekFits','checkIns'].forEach(k=>delete store[k]);};
const rec=(date,area,full=true,done,total)=>({date,area,done:done!==undefined?done:(full?4:1),total:total!==undefined?total:4,full});
const W=(...s)=>s.map(status=>({status}));
const F=(weeks,o)=>Object.assign({weeks:W(...weeks),firstTrained:'2026-08-03',lastTrained:'2026-10-03',today:'2026-10-05',intoLights:0},o||{});
const V=(weeks,o)=>ctx.verdictOf(F(weeks,o),T).key;
reset();

console.log('the thresholds are data:');
eq('as the plan sketched them', T, {window:4,consistentHits:3,buildingHits:3,slippingMisses:2,slippingWindow:3,dormantDays:14,newWeeks:2,mostlyPartialPct:70});

console.log('too new to judge:');
eq('never trained', V(['hit'],{firstTrained:null,lastTrained:null}), 'new');
eq('first trained 13 days ago', V(['hit','hit'],{firstTrained:'2026-09-22'}), 'new');
eq('14 days ago it can be judged', V(['hit','hit'],{firstTrained:'2026-09-21'}), 'consistent');
eq('and says why', ctx.verdictOf(F([],{firstTrained:'2026-09-30'}),T).why, 'Under 2 weeks of history, so too early to judge.');

console.log('gone quiet:');
eq('nothing for 14 days', V(['hit','hit','hit','hit'],{lastTrained:'2026-09-21'}), 'dormant');
eq('13 days is not yet', V(['hit','hit','hit','hit'],{lastTrained:'2026-09-22'}), 'consistent');
eq('it beats slipping: of course it missed, it stopped', V(['missed','missed','missed'],{lastTrained:'2026-09-01'}), 'dormant');
eq('and says how long', ctx.verdictOf(F(['hit'],{lastTrained:'2026-09-21'}),T).why, 'Nothing for 14 days.');

console.log('pushing too hard:');
eq('over its maximum last week', V(['hit','hit','hit','over']), 'overreaching');
eq('or the week before', V(['hit','hit','over','hit']), 'overreaching');
eq('three weeks ago is not recent', V(['hit','over','hit','hit']), 'consistent');
eq('it beats consistent: a safety flag outranks a good run', V(['hit','hit','hit','over']), 'overreaching');
eq('trained twice into an amber or red light in two weeks', V(['hit','hit','hit','hit'],{intoLights:2}), 'overreaching');
eq('once is not', V(['hit','hit','hit','hit'],{intoLights:1}), 'consistent');
eq('the reasons', [ctx.verdictOf(F(['over']),T).why, ctx.verdictOf(F(['hit'],{intoLights:3}),T).why], ['Went over its weekly maximum recently.','Trained 3 times in the last two weeks with a guarding body area amber or red.']);

console.log('slipping:');
eq('missed its minimum in 2 of the last 3', V(['hit','missed','missed']), 'slipping');
eq('not consecutive', V(['hit','missed','met','missed']), 'slipping');
eq('one miss is not, whatever else it is', [V(['hit','hit','hit','missed']), V(['hit','hit','met','missed'])], ['consistent','building']);
eq('2 of 4 but only 1 of the last 3 is not', V(['missed','met','hit','missed']), 'mixed');
eq('slipping beats consistent', V(['hit','missed','missed','hit']), 'slipping');
eq('the reason counts the weeks', ctx.verdictOf(F(['hit','missed','missed']),T).why, 'Missed its minimum in 2 of the last 3 weeks.');
eq('with only two finished weeks, both missed is slipping', V(['missed','missed']), 'slipping');
eq('and one of two is not', V(['hit','missed']), 'mixed');

console.log('consistent, building, uneven:');
eq('hit its target in 3 of 4', V(['hit','hit','met','hit']), 'consistent');
eq('3 hits in the last 4, the oldest missed', V(['missed','hit','hit','hit']), 'consistent');
eq('met the minimum in 3 of 4 without hitting the target', V(['met','met','hit','missed']), 'building');
eq('only the last four weeks count', V(['missed','hit','hit','hit','hit']), 'consistent');
eq('met the minimum in 2 of 4', V(['missed','met','hit','missed']), 'mixed');
eq('words for each', [V(['hit','hit','hit']),V(['met','met','met']),V(['missed','met','hit','missed'])].map(k=>ctx.VERDICT_LABEL[k]), ['Consistent','Building','Uneven']);
eq('with fewer weeks than the rule: all of them. Three of three', ctx.verdictOf(F(['hit','hit','hit']),T).why, 'Hit its target in 3 of the last 3 weeks.');
eq('two clean weeks since it began are consistent, not uneven', V(['hit','hit']), 'consistent');
eq('and two weeks of just the minimum are building', V(['met','met']), 'building');

console.log('mostly partial:');
const C=(...c)=>c.map(completion=>({completion}));
eq('under 70 per cent two weeks running', ctx.isMostlyPartial(C(80,60,65),T), true);
eq('only the last of them', ctx.isMostlyPartial(C(60,80,65),T), false);
eq('exactly 70 is not under', ctx.isMostlyPartial(C(70,60),T), false);
eq('a week with no training does not count', ctx.isMostlyPartial(C(null,60),T), false);
eq('one week is not enough', ctx.isMostlyPartial(C(60),T), false);
eq('none', ctx.isMostlyPartial([],T), false);

console.log('completion in a week:');
const mu=ctx.areaById('mu');
const days1=[rec('2026-10-05','mu',true,17,17),rec('2026-10-07','mu',false,3,17),rec('2026-10-12','mu',true,17,17),rec('2026-10-06','kb',true,4,4)];
eq('sets done over sets prescribed, over the days trained', ctx.weekCompletion('mu','2026-10-05',days1), 59);
eq('another week', ctx.weekCompletion('mu','2026-10-12',days1), 100);
eq('a week with no training', ctx.weekCompletion('mu','2026-10-19',days1), null);
eq('other areas are not mixed in', ctx.weekCompletion('kb','2026-10-05',days1), 100);
eq('Sunday belongs to its week', ctx.weekCompletion('mu','2026-10-05',[rec('2026-10-11','mu',true,10,10)]), 100);
eq('Monday of the next does not', ctx.weekCompletion('mu','2026-10-05',[rec('2026-10-12','mu',true,10,10)]), null);

console.log('trained into a light:');
reset(); ctx.checkIns=[ci('2026-10-03',{elbow:4})];
const d2=[rec('2026-10-04','mu'),rec('2026-10-06','mu'),rec('2026-09-20','mu')];
eq('days in the last two weeks with the elbow amber', ctx.daysIntoLights(mu,'2026-10-07',d2), 2);
eq('a day long ago does not count', ctx.daysIntoLights(mu,'2026-10-07',[rec('2026-09-20','mu')]), 0);
eq('a day before the light came on does not', ctx.daysIntoLights(mu,'2026-10-07',[rec('2026-10-02','mu')]), 0);
eq('another area is not touched', ctx.daysIntoLights(ctx.areaById('kb'),'2026-10-07',[rec('2026-10-04','kb')]), 0);
ctx.checkIns=[ci('2026-10-03',{elbow:8})];
eq('red counts too', ctx.daysIntoLights(mu,'2026-10-07',[rec('2026-10-04','mu')]), 1);

console.log('from the app: real areas, finished weeks, the targets they were judged against:');
reset(); ctx.todayISO=()=>'2026-10-26';
const steady=[]; ['2026-09-28','2026-10-05','2026-10-12','2026-10-19'].forEach(s=>{steady.push(rec(ctx.addDays(s,0),'mu'));steady.push(rec(ctx.addDays(s,3),'mu'));});
let fb=ctx.areaFeedback(mu,'2026-10-26',steady);
eq('four weeks at its target of 2: consistent', [fb.verdict,fb.label,fb.why], ['consistent','Consistent','Hit its target in 4 of the last 4 weeks.']);
eq('the four weeks, oldest first', fb.weeks.map(w=>[w.start,w.touched,w.status,w.completion]), [['2026-09-28',2,'hit',100],['2026-10-05',2,'hit',100],['2026-10-12',2,'hit',100],['2026-10-19',2,'hit',100]]);
eq('with the numbers it was judged by', fb.weeks[0], {start:'2026-09-28',touched:2,min:2,target:2,max:3,status:'hit',completion:100});
eq('first and last day trained', [fb.firstTrained,fb.lastTrained], ['2026-09-28','2026-10-22']);
eq('and not mostly partial', fb.mostlyPartial, false);
const thin=steady.filter(r=>r.date!=='2026-10-12'&&r.date!=='2026-10-15');
fb=ctx.areaFeedback(mu,'2026-10-26',thin);
eq('a week with nothing is a miss: missed once in three is not slipping', [fb.weeks[2].status, fb.verdict], ['missed','consistent']);
fb=ctx.areaFeedback(mu,'2026-10-26',steady.filter(r=>['2026-09-28','2026-10-01','2026-10-05','2026-10-19','2026-10-22'].includes(r.date)));
eq('one day in a week of two is a miss too, so two misses of the last three is slipping', [fb.weeks.map(w=>w.status).join(' '), fb.verdict], ['hit missed missed hit','slipping']);
fb=ctx.areaFeedback(mu,'2026-10-26',steady.filter(r=>r.date>='2026-10-12'));
eq('weeks before it first appeared are not misses', [fb.weeks.length, fb.weeks[0].start], [2,'2026-10-12']);
eq('and two clean weeks since are consistent', fb.verdict, 'consistent');
eq('never trained: new, with no weeks', (f=>[f.verdict,f.weeks.length,f.firstTrained])(ctx.areaFeedback(mu,'2026-10-26',[])), ['new',0,null]);
fb=ctx.areaFeedback(mu,'2026-10-26',[rec('2026-10-20','mu')]);
eq('trained for the first time last week: new', fb.verdict, 'new');
fb=ctx.areaFeedback(mu,'2026-11-30',steady);
eq('then nothing for five weeks: dormant', fb.verdict, 'dormant');
const kb=ctx.areaById('kb');
const kbDays=['2026-09-28','2026-10-05','2026-10-12','2026-10-19'].reduce((a,s)=>a.concat([rec(s,'kb'),rec(ctx.addDays(s,2),'kb')]),[]);
eq('kettlebell, as authored: target 3, two days a week is only its minimum', ctx.areaFeedback(kb,'2026-10-26',kbDays).weeks.map(w=>w.status), ['met','met','met','met']);
eq('which is building', ctx.areaFeedback(kb,'2026-10-26',kbDays).verdict, 'building');
ctx.weekFits={}; ['2026-09-28','2026-10-05','2026-10-12','2026-10-19'].forEach(s=>{ctx.weekFits[s]={budget:330,cost:302,minCost:280,startCost:432,verdict:'tight',targets:{kb:2},trimmed:[],ramp:[]};});
eq('but judged against the target it was fitted to, 2, it is hit every week: consistent', [ctx.areaFeedback(kb,'2026-10-26',kbDays).weeks.map(w=>w.status).join(' '), ctx.areaFeedback(kb,'2026-10-26',kbDays).verdict], ['hit hit hit hit','consistent']);
fb=ctx.areaFeedback(mu,'2026-10-26',steady.map(r=>Object.assign({},r,{done:2,total:4,full:false})));
eq('half-done days every week: mostly partial', [fb.mostlyPartial, fb.weeks[3].completion], [true,50]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
