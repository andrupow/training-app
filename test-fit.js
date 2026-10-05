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
ctx.areaData={rules:read('data/rules.json'),legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};
const reset=()=>{ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.checkIns=[];ctx.schedule={};ctx.settings={};ctx.weekFits={};delete store.weekFits;};
ctx.todayISO=()=>'2026-10-07';                     // a Wednesday
const mins=n=>{ctx.settings.weekdayMinutes={0:n,1:n,2:n,3:n,4:n,5:n,6:n};};
const rec=(date,area)=>({date,area,done:4,total:4,full:true});
const items=(ramp)=>ctx.areaList().map(a=>{const per=ctx.stageWeek(a,ctx.currentStage(a));return{id:a.id,priority:a.priority,minutes:a.minutes,min:per.min,target:Math.max(per.min,per.nominalTarget||per.target),ramp:!!ramp};});
const TIGHT=ctx.areaData.rules.defaults.tightRatio;
const tg=f=>f.targets;

console.log('what the targets cost, from the area files:');
const nominal=items(false);
eq('nominal targets add up to 432 minutes (plan section 4)', nominal.reduce((n,i)=>n+i.minutes*i.target,0), 432);
eq('minimums add up to 280', nominal.reduce((n,i)=>n+i.minutes*i.min,0), 280);

console.log('fitting targets to the minutes, lowest priority first:');
let f=ctx.fitTargets(nominal,500,TIGHT);
eq('plenty of time: nothing is trimmed', [f.trimmed, f.cost, f.verdict], [[],432,'fits']);
eq('and the targets are the nominal ones', tg(f), {mu:2,hspu:2,bridge:3,pistol:2,nordic:3,kb:5,oap:2,plyo:2});
f=ctx.fitTargets(nominal,420,TIGHT);
eq('60 minutes a day (420): only plyometrics gives a day up', f.trimmed, [{id:'plyo',from:2,to:1}]);
eq('and it costs 412', f.cost, 412);
f=ctx.fitTargets(nominal,330,TIGHT);
eq('your mixed week (330): plyometrics, one-arm and kettlebell give way, in that order', f.trimmed.map(t=>[t.id,t.from,t.to]), [['kb',5,2],['oap',2,1],['plyo',2,1]]);
eq('it stops as soon as it fits: 302 of 330', [f.cost, f.cost<=330], [302,true]);
eq('every other target is untouched', [tg(f).mu,tg(f).hspu,tg(f).bridge,tg(f).pistol,tg(f).nordic], [2,2,3,2,3]);
eq('the same trim at 315 (45 a day), because 332 still does not fit', ctx.fitTargets(nominal,315,TIGHT).trimmed.map(t=>t.id+t.to), ['kb2','oap1','plyo1']);
f=ctx.fitTargets(nominal,290,TIGHT);
eq('290: Nordic then the bridge come down too, and nothing goes below a minimum', [tg(f).nordic,tg(f).bridge,f.cost], [2,2,280]);
f=ctx.fitTargets(nominal,280,TIGHT);
eq('280 is all minimums', [f.cost,f.minCost,f.verdict], [280,280,'tight']);
ok('no target is ever below its minimum', ctx.areaList().every(a=>tg(f)[a.id]>=ctx.stageWeek(a,ctx.currentStage(a)).min));
f=ctx.fitTargets(nominal,250,TIGHT);
eq('250 cannot be met: it says so and stays at the minimums', [f.verdict,f.cost,f.minCost], ['over',280,280]);
eq('zero minutes does not loop or divide by zero', ctx.fitTargets(nominal,0,TIGHT).verdict, 'over');
eq('no areas at all is a fit', ctx.fitTargets([],330,TIGHT), {budget:330,cost:0,minCost:0,startCost:0,verdict:'fits',targets:{},trimmed:[],ramp:[]});

console.log('how tight "tight" is:');
eq('330 minutes: 280 of 330 is tight, as in the plan', ctx.fitTargets(nominal,330,TIGHT).verdict, 'tight');
eq('420: room to spare', ctx.fitTargets(nominal,420,TIGHT).verdict, 'fits');
eq('the plan\'s own sentence', ctx.feasibilityLine(ctx.fitTargets(nominal,330,TIGHT)), 'Your minimums need 280 min a week; you have 330. Tight.');
eq('when it does not fit', ctx.feasibilityLine(ctx.fitTargets(nominal,250,TIGHT)), 'Your minimums need 280 min a week; you have 250. That does not fit.');
eq('and when it does', ctx.feasibilityLine(ctx.fitTargets(nominal,420,TIGHT)), 'Your minimums need 280 min a week; you have 420. Room to spare.');

console.log('the first weeks of an area run at its minimum:');
f=ctx.fitTargets(items(true),999,TIGHT);
eq('everything in ramp-in: all minimums, and all listed', [tg(f), f.ramp.length, f.trimmed], [{mu:2,hspu:2,bridge:2,pistol:2,nordic:2,kb:2,oap:1,plyo:1},8,[]]);
eq('ramp-in is not reported as a trim', ctx.trimmedLine(f), '');
ok('it says who is starting out and for how long', ctx.rampLine(f).startsWith('Starting out, minimum only for 2 weeks: Muscle-up,'));
const mix=items(false); mix[0].ramp=true; mix[5].ramp=true;
f=ctx.fitTargets(mix,999,TIGHT);
eq('a mix: muscle-up and kettlebell at their minimum, the rest at nominal', [tg(f).mu,tg(f).kb,tg(f).bridge,tg(f).nordic], [2,2,3,3]);

console.log('who is in ramp-in, from the history:');
reset();
eq('an area never trained is in its first week', ctx.inRamp('bridge','2026-10-05',[]), true);
const hist=[rec('2026-09-21','mu'),rec('2026-09-28','pistol'),rec('2026-10-06','nordic')];
eq('first trained two weeks ago: out of ramp-in', ctx.inRamp('mu','2026-10-05',hist), false);
eq('first trained last week: still in its second week', ctx.inRamp('pistol','2026-10-05',hist), true);
eq('first trained this week: in its first', ctx.inRamp('nordic','2026-10-05',hist), true);
eq('and the week after that it is in its second', ctx.inRamp('nordic','2026-10-12',hist), true);
eq('and two weeks on, out', ctx.inRamp('nordic','2026-10-19',hist), false);
ctx.areaData.rules.defaults.rampWeeks=0;
eq('ramp-in of 0 weeks switches it off', ctx.inRamp('bridge','2026-10-05',[]), false);
ctx.areaData.rules.defaults.rampWeeks=2;

console.log('the minutes you have in a week:');
reset();
eq('with nothing said it is 45 a day', ctx.weekMinutes('2026-10-05'), 315);
ctx.settings.weekdayMinutes={0:45,1:45,2:30,3:45,4:45,5:60,6:60};
eq('with your usual week (45 45 30 45 45 60 60)', ctx.weekMinutes('2026-10-05'), 330);

console.log('the whole thing, from your logs and your week:');
reset(); ctx.settings.weekdayMinutes={0:45,1:45,2:30,3:45,4:45,5:60,6:60};
const old=['mu','hspu','bridge','pistol','nordic','kb','oap','plyo'].map(id=>rec('2026-09-14',id));
f=ctx.computeWeekFit('2026-10-05',old);
eq('with history, past ramp-in: the 330-minute trim', f.trimmed.map(t=>t.id+t.to), ['kb2','oap1','plyo1']);
eq('and the feasibility sentence for it', ctx.feasibilityLine(f), 'Your minimums need 280 min a week; you have 330. Tight.');
eq('what it trimmed, in words', ctx.trimmedLine(f), 'Fitted to your time: Kettlebell (Simple & Sinister) 5→2, One-arm pull-up 2→1, Plyometrics 2→1.');
f=ctx.computeWeekFit('2026-10-05',[]);
eq('with no history everything is in ramp-in, so only minimums count', [f.ramp.length,f.cost,f.trimmed], [8,280,[]]);

console.log('judging a week by its fit:');
reset(); ctx.settings.weekdayMinutes={0:45,1:45,2:30,3:45,4:45,5:60,6:60};
let w=ctx.areaWeek(ctx.areaById('kb'),'2026-10-05','2026-10-07',old);
eq('the current week uses the fit: kettlebell 2, nominal 5', [w.target,w.nominal,w.fitted,w.ramp], [2,5,true,false]);
eq('minimum and maximum are the stage\'s own', [w.min,w.max], [2,6]);
w=ctx.areaWeek(ctx.areaById('mu'),'2026-10-05','2026-10-07',[]);
eq('an area in ramp-in has its minimum as the target', [w.target,w.ramp], [2,true]);
w=ctx.areaWeek(ctx.areaById('bridge'),'2026-10-05','2026-10-07',[]);
eq('the bridge: minimum 2, not its 3', [w.min,w.target], [2,2]);
w=ctx.areaWeek(ctx.areaById('kb'),'2026-09-28','2026-10-07',old);
eq('a finished week nobody looked at is judged as authored: 3', [w.target,w.fitted], [3,false]);
w=ctx.areaWeek(ctx.areaById('kb'),'2026-10-12','2026-10-07',old);
eq('next week is worked out fresh', [w.target,w.fitted], [2,true]);

console.log('saved the first time the week is looked at:');
reset(); ctx.settings.weekdayMinutes={0:45,1:45,2:30,3:45,4:45,5:60,6:60};
ok('nothing is saved just by asking', ctx.weekFitFor('2026-10-05',old,'2026-10-07')!==null && !('weekFits' in store));
const saved=ctx.ensureWeekFit('2026-10-05',old);
eq('the current week is saved', [!!saved, Object.keys(ctx.weekFits)], [true,['2026-10-05']]);
ok('and written to storage', JSON.parse(store.weekFits)['2026-10-05'].targets.kb===2);
ctx.settings.weekdayMinutes={0:90,1:90,2:90,3:90,4:90,5:90,6:90};
eq('saying you have more time later does not move this week', ctx.areaWeek(ctx.areaById('kb'),'2026-10-05','2026-10-07',old).target, 2);
eq('but next week sees it', ctx.areaWeek(ctx.areaById('kb'),'2026-10-12','2026-10-07',old).target, 5);
eq('a week that has already ended is never saved', ctx.ensureWeekFit('2026-09-28',old), null);
eq('nor one that has not started', ctx.ensureWeekFit('2026-10-12',old), null);
ctx.weekFits={}; ctx.loadWeekFits();
eq('it comes back from storage', ctx.weekFits['2026-10-05'].targets.kb, 2);

console.log('storage can hold anything:');
const bad=ctx.cleanWeekFit;
eq('not an object', [bad(null),bad('x'),bad([])], [null,null,null]);
eq('no budget', bad({cost:1,minCost:1,targets:{}}), null);
eq('no targets', bad({budget:300,cost:1,minCost:1}), null);
let c=bad({budget:300,cost:280,minCost:200,targets:{mu:2,kb:'3',oap:-1,x:'abc'},trimmed:[{id:'kb',from:5,to:3},{id:7},null],ramp:['mu',5,'mu'],verdict:'wild'});
eq('a half-good record keeps what is usable', [c.targets,c.trimmed,c.ramp,c.verdict,c.startCost], [{mu:2,kb:3},[{id:'kb',from:5,to:3}],['mu'],'fits',280]);
store.weekFits=JSON.stringify({'2026-10-05':{budget:300,cost:280,minCost:200,targets:{mu:2}},'junk':{budget:1},'2026-10-12':'x'});
ctx.loadWeekFits();
eq('bad weeks and bad dates are dropped on load', Object.keys(ctx.weekFits), ['2026-10-05']);
{const w=console.warn; console.warn=()=>{}; store.weekFits='not json'; ctx.loadWeekFits(); console.warn=w;}
eq('unreadable storage is an empty set', ctx.weekFits, {});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
