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
const reset=()=>{ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.checkIns=[];ctx.schedule={};ctx.settings={};ctx.weekFits={};delete store.weekFits;delete store.dayPlans;};
const rec=(date,area)=>({date,area,done:4,total:4,full:true});
const ci=(date,pain,stiff)=>({date,pain:Object.assign({elbow:0,shoulder:0,achilles:0,hamstring:0},pain),stiffness:stiff||'none'});

/* ---- the pure function, with small hand-made inputs ---- */
const W=ctx.areaData.rules.recommender;
const A=(id,o)=>Object.assign({id,name:id.toUpperCase(),priority:1,minutes:20,load:'medium',per:{min:2,target:2,max:3},gap:2,days:[],held:null,hold:null,excluded:null},o);
const IN=(areas,o)=>Object.assign({date:'2026-10-08',slots:[45],areas,conflicts:[],budgets:[],limits:{maxAreas:4,maxHigh:2},weights:W,already:[]},o);   // a Thursday
const run=(areas,o)=>ctx.recommendDay(IN(areas,o));
const ids=r=>r.picked.slice().sort();

console.log('what is ruled out, and the sentence that says so:');
let r=run([A('a',{held:'elbow red'}),A('b',{excluded:'Already on today’s menu.'}),A('c',{days:['2026-10-05','2026-10-06','2026-10-07'],gap:1,per:{min:1,target:5,max:3}}),
  A('d',{days:['2026-10-07']}),A('e',{days:['2026-10-08'],gap:1}),A('f',{days:['2026-10-05','2026-10-07'],per:{min:1,target:2,max:3},gap:1})]);
eq('nothing is picked from that', r.picked, []);
eq('held by a red body area', [r.lines.a.kind,r.lines.a.why], ['held','Held: elbow red.']);
eq('already on the menu (the adapter’s words pass through)', [r.lines.b.kind,r.lines.b.why], ['excluded','Already on today’s menu.']);
eq('at its weekly max', [r.lines.c.kind,r.lines.c.why], ['max','At its weekly max of 3.']);
eq('too soon, yesterday', [r.lines.d.kind,r.lines.d.why], ['soon','Too soon: trained yesterday, wants 2+ days between.']);
eq('trained today', [r.lines.e.kind,r.lines.e.why], ['soon','Already trained today.']);
eq('target met (and can still be added)', [r.lines.f.kind,r.lines.f.why], ['met','Target met this week (2/2). You can still add it.']);
ok('every area has a line', ['a','b','c','d','e','f'].every(id=>r.lines[id]));
eq('and every one of them is in the skipped list with the same words', r.skipped.map(s=>s.why), ['a','b','c','d','e','f'].map(id=>r.lines[id].why));

console.log('days before this week do not count, and the week is Monday to Sunday:');
r=run([A('a',{days:['2026-10-04','2026-10-03'],gap:1}),A('b',{days:['2026-09-30'],gap:1})]);
eq('last week’s days leave the count at 0 for both', [r.lines.a.picked,r.lines.b.picked], [true,true]);
eq('and they are not too soon either', [r.lines.a.why,r.lines.b.why].map(s=>s.startsWith('Still needs 2')), [true,true]);

console.log('a cap shared by several areas:');
const bud=[{areas:['x','y'],maxPerWeek:3,why:'elbow tendon'}];
r=run([A('x',{days:['2026-10-05','2026-10-06'],gap:1}),A('y',{days:['2026-10-07'],gap:1})],{budgets:bud});
eq('three days used between them: both are out', [r.lines.x.kind,r.lines.y.kind], ['budget','budget']);
eq('with the numbers', r.lines.y.why, 'This week’s elbow tendon cap is used: 3 of 3 days.');
r=run([A('x',{days:['2026-10-05'],gap:1}),A('y',{days:['2026-10-07'],gap:1})],{budgets:bud});
eq('two used: still open', [r.lines.x.picked,r.lines.y.picked], [true,true]);

console.log('picking what fits the minutes:');
r=run([A('a',{priority:1,minutes:30}),A('b',{priority:2}),A('c',{priority:3})],{slots:[45]});
eq('b and c (40 min) beat a alone (30): a greedy pick by priority would have starved both', ids(r), ['b','c']);
eq('a says why it was left', [r.lines.a.kind,r.lines.a.why], ['time','Needs about 30 min; 5 left today.']);
r=run([A('a',{minutes:30}),A('b',{priority:2,minutes:30})],{slots:[20]});
eq('nothing fits 20 minutes', [r.picked,r.lines.a.why], [[],'Needs about 30 min; 20 left today.']);
eq('no time at all', run([A('a')],{slots:[0]}).lines.a.why, 'Needs about 20 min; today has no room.');
r=run([A('a',{priority:1}),A('b',{priority:2})],{slots:[20]});
eq('when only one fits and they are alike, the higher priority wins', r.picked, ['a']);
r=run([A('a',{priority:1,days:['2026-10-06'],gap:1,per:{min:1,target:2,max:3}}),A('b',{priority:2,per:{min:2,target:2,max:3},gap:2})],{date:'2026-10-11',slots:[20]});
eq('on Sunday, the one whose minimum is about to be missed beats the one that only wants its target', r.picked, ['b']);
eq('and says so', r.lines.b.why, 'Needs today to keep its minimum for the week.');

console.log('what is "needs today":');
r=run([A('a',{per:{min:1,target:2,max:3},gap:1,days:['2026-10-05']})],{date:'2026-10-11'});
eq('Sunday, one more for the target: needs today for its target', [r.lines.a.kind,r.lines.a.why], ['target','Needs today to reach its target for the week.']);
r=run([A('a',{per:{min:1,target:2,max:3},gap:1,days:['2026-10-05']})],{date:'2026-10-06'});
eq('Tuesday, plenty of days left: just still needs one', [r.lines.a.kind,r.lines.a.why], ['fit','Still needs 1 more this week.']);
r=run([A('a',{per:{min:2,target:3,max:3},gap:3})],{date:'2026-10-07'});
eq('Wednesday: two sessions three days apart still fit before Sunday, three do not, so it is the target that needs today', r.lines.a.kind, 'target');
r=run([A('a',{per:{min:2,target:3,max:3},gap:3})],{date:'2026-10-08'});
eq('Thursday: now even the second one only just fits, so it is the minimum', r.lines.a.kind, 'minimum');

console.log('pairs that do not go together:');
const hard=[{areas:['a','b'],why:'both load the elbow tendons'}];
r=run([A('a',{priority:1}),A('b',{priority:2})],{conflicts:hard});
eq('the higher value goes, the other says why', [r.picked,r.lines.b.kind,r.lines.b.why], [['a'],'conflict','Not with A: both load the elbow tendons.']);
const soft=[{areas:['a','b'],soft:true,why:'both load the hamstrings'}];
r=run([A('a',{priority:1}),A('b',{priority:2})],{conflicts:soft});
eq('a soft pair is kept apart on an ordinary day', r.picked.length, 1);
r=run([A('a',{priority:1,per:{min:1,target:1,max:3},gap:1}),A('b',{priority:2,per:{min:1,target:1,max:3},gap:1})],{conflicts:soft,date:'2026-10-11'});
eq('on Sunday, when each would otherwise miss its week, they may share the day', ids(r), ['a','b']);
ok('and the line says who it shares with', r.lines.a.why.includes('Shares the day with B (both load the hamstrings).'));
r=run([A('a',{per:{min:1,target:1,max:3},gap:1}),A('b',{priority:2,per:{min:1,target:1,max:3},gap:1})],{conflicts:hard,date:'2026-10-11'});
eq('a hard pair never shares, however urgent', r.picked.length, 1);

console.log('limits on a day:');
const H=(id,p)=>A(id,{priority:p,load:'high',minutes:10});
r=run([H('a',1),H('b',2),H('c',3)]);
eq('two high-load areas at most', [ids(r), r.lines.c.kind, r.lines.c.why], [['a','b'],'limit','Already 2 high-load areas today.']);
r=run([A('a',{priority:1,minutes:5}),A('b',{priority:2,minutes:5}),A('c',{priority:3,minutes:5})],{limits:{maxAreas:2,maxHigh:2}});
eq('and at most so many areas', [ids(r), r.lines.c.why], [['a','b'],'Already 2 areas today.']);

console.log('earlier sittings the same day:');
r=run([A('a',{load:'high',minutes:10}),H('b',2),H('c',3)],{already:['a'],slots:[30]});
eq('an area already planned counts toward the high-load limit', [ids(r),r.lines.c.kind], [['b'],'limit']);
r=run([A('a'),A('b',{priority:2})],{already:['a'],conflicts:hard,slots:[45]});
eq('and a conflict with it rules the other out', [r.picked,r.lines.b.kind], [[],'conflict']);
r=run([A('a'),A('b',{priority:2}),A('c',{priority:3}),A('d',{priority:4})],{already:['a','b','c'],slots:[45]});
eq('three already of four: only one more', r.picked.length, 1);

console.log('two sittings:');
r=run([A('a',{minutes:30}),A('b',{priority:2,minutes:30})],{slots:[30,30]});
eq('both fit, one in each', [ids(r),r.sittings.map(s=>s.length)], [['a','b'],[1,1]]);
r=run([A('a',{minutes:30}),A('b',{priority:2,minutes:30})],{slots:[45]});
eq('in one 45 only one fits', r.picked.length, 1);
r=run([A('a'),A('b',{priority:2}),A('c',{priority:3})],{slots:[30,30]});
eq('three 20s in two 30s: 60 minutes in total but they cannot be packed, so two', [r.picked.length, r.sittings.map(s=>s.length)], [2,[1,1]]);
r=run([A('a',{minutes:25}),A('b',{priority:2,minutes:15}),A('c',{priority:3,minutes:20})],{slots:[30,30]});
ok('25, 15 and 20 minutes in two 30s: whatever is picked fits sitting by sitting', r.sittings.every(s=>s.reduce((n,id)=>n+({a:25,b:15,c:20})[id],0)<=30));
eq('one sitting is a list of one', run([A('a')]).sittings, [['a']]);

console.log('a few facts about it:');
r=run([A('a',{hold:'elbow amber'}),A('b',{priority:2,minutes:5})]);
eq('amber is carried to the line, it does not stop anything', [r.lines.a.hold,r.lines.a.picked], ['elbow amber',true]);
const many=[]; for(let k=1;k<=14;k++) many.push(A('x'+k,{priority:k,minutes:5}));
const t0=Date.now(); r=run(many,{limits:{maxAreas:20,maxHigh:20},slots:[200]});
ok('fourteen areas are fine: the pool is capped, so it is quick', Date.now()-t0<2000 && r.picked.length>0);
eq('the same input gives the same answer', JSON.stringify(run([A('a'),A('b',{priority:2})])), JSON.stringify(run([A('a'),A('b',{priority:2})])));
eq('and the input is not changed', (()=>{const inp=IN([A('a'),A('b',{priority:2})]);const s=JSON.stringify(inp);ctx.recommendDay(inp);return JSON.stringify(inp)===s;})(), true);

/* ---- through the app: real areas, real rules, your week ---- */
console.log('the real rules over ten weeks (the plan’s simulation, run on the app’s own code):');
const IDS=['mu','hspu','bridge','pistol','nordic','kb','oap','plyo'];
const GAP={mu:2,hspu:2,bridge:1,pistol:2,nordic:2,kb:1,oap:3,plyo:2};
const HARD=[['mu','oap'],['hspu','mu'],['plyo','nordic']];
const HIGH=['mu','hspu','nordic','oap','plyo'];
function sim(weeks,minutesFn,o){
  o=o||{}; reset();
  const wm={}; for(let d=0;d<7;d++){const v=[].concat(minutesFn(d)); wm[d]=v[0];} ctx.settings.weekdayMinutes=wm;
  if(o.checkIns) ctx.checkIns=o.checkIns;
  const start='2026-10-05', days=[], log=[];
  for(let i=0;i<weeks*7;i++){
    const d=ctx.addDays(start,i); ctx.todayISO=()=>d;
    const res=ctx.recommendFor(d,[].concat(minutesFn(ctx.isoDow(d))),days);
    res.picked.forEach(id=>days.push(rec(d,id)));
    log.push({d,picked:res.picked,mins:res.minutes,sittings:res.sittings,slots:[].concat(minutesFn(ctx.isoDow(d)))});
  }
  const avg={}; IDS.forEach(id=>{let tot=0,n=0;for(let w=3;w<weeks;w++){const s=ctx.addDays(start,w*7),e=ctx.addDays(s,6);tot+=days.filter(x=>x.area===id&&x.date>=s&&x.date<=e).length;n++;}avg[id]=tot/n;});
  return {avg,days,log,mins:Math.round(log.reduce((n,l)=>n+l.mins,0)/log.length)};
}
function breaks(s){   // rule breaks over the whole run
  let n=0;
  IDS.forEach(id=>{const ds=s.days.filter(x=>x.area===id).map(x=>x.date).sort();for(let k=1;k<ds.length;k++) if(ctx.daysBetween(ds[k-1],ds[k])<GAP[id]) n++;});
  s.log.forEach(l=>{HARD.forEach(p=>{if(l.picked.includes(p[0])&&l.picked.includes(p[1])) n++;});
    if(l.picked.filter(id=>HIGH.includes(id)).length>2) n++; if(l.picked.length>4) n++;
    l.sittings.forEach((st,k)=>{if(st.reduce((m,id)=>m+ctx.areaById(id).minutes,0)>l.slots[k]) n++;});});
  return n;
}
const MIXED=d=>[45,45,30,45,45,60,60][d];
let s=sim(10,MIXED);
eq('your mixed week (45 45 30 45 45 60 60 = 330 min): every fitted target is met', s.avg, {mu:2,hspu:2,bridge:3,pistol:2,nordic:3,kb:2,oap:1,plyo:1});
eq('at 43 minutes a day, as the plan’s simulation said', s.mins, 43);
eq('and no spacing, conflict, limit or time rule is broken', breaks(s), 0);
s=sim(10,()=>60);
eq('60 minutes every day: kettlebell 4 of its nominal 5, one-arm 2, everything else at target', s.avg, {mu:2,hspu:2,bridge:3,pistol:2,nordic:3,kb:4,oap:2,plyo:1});
eq('and no rule is broken', breaks(s), 0);
s=sim(10,()=>45);
ok('a flat 45 does not fit, as the plan said: kettlebell falls below its minimum of 2', s.avg.kb<2);
eq('the rest of the minimums hold', IDS.filter(id=>id!=='kb'&&s.avg[id]<ctx.stageWeek(ctx.areaById(id),ctx.currentStage(ctx.areaById(id))).min), []);
eq('and no rule is broken', breaks(s), 0);
s=sim(10,()=>30);
ok('a flat 30 is worse: muscle-up and Nordic fit, plyometrics does not', s.avg.plyo<1&&s.avg.mu>=2);
eq('still no rule broken', breaks(s), 0);
s=sim(10,d=>d>=5?[45,30]:45);
ok('two sittings on the weekend: every sitting holds what was put in it', breaks(s)===0);
ok('and the weekend days really use two', s.log.filter(l=>l.slots.length===2).every(l=>l.sittings.length===2));

console.log('a red hamstring for a week (the red protocol is seven days):');
s=sim(10,()=>60,{checkIns:[ci('2026-10-05',{hamstring:8})]});
eq('Nordic and kettlebell are not recommended during it', s.days.filter(x=>(x.area==='nordic'||x.area==='kb')&&x.date<='2026-10-11').length, 0);
eq('afterwards they are back at target, with no make-up', [s.avg.nordic,s.avg.kb], [3,4]);
ok('nothing else was stopped', s.avg.mu>=2&&s.avg.bridge>=3);
eq('and no rule broken', breaks(s), 0);

console.log('through the app’s state:');
reset(); ctx.todayISO=()=>'2026-10-08'; ctx.settings.weekdayMinutes={0:45,1:45,2:30,3:45,4:45,5:60,6:60};
const old=IDS.map(id=>rec('2026-09-14',id));
let inp=ctx.recommendInput('2026-10-08',[45],old);
eq('the shape', [Object.keys(inp).sort(), inp.areas.length, inp.limits], [['already','areas','conflicts','date','limits','slots','weights','budgets'].sort(), 8, {maxAreas:4,maxHigh:2}]);
eq('the week’s fit is used: kettlebell’s target is 2', inp.areas.find(a=>a.id==='kb').per, {min:2,target:2,max:6});
ok('looking at the week saved its fit', !!ctx.weekFits['2026-10-05']);
eq('suggestAreas is the same recommendation', ctx.suggestAreas('2026-10-08',45,old), ctx.recommendFor('2026-10-08',[45],old).picked);
eq('and comes back in the order to do things: skill before strength before mobility', ctx.recommendFor('2026-10-08',[60],old).picked, ['hspu','pistol','nordic','bridge']);
ctx.dayPlans['2026-10-08']={sittings:[{minutes:45,areas:['hspu','nordic']}],suggested:['hspu','nordic'],removed:{bridge:'tired'}};
inp=ctx.recommendInput('2026-10-08',[30],old.concat([rec('2026-10-08','pistol')]));
eq('what is on the menu or was done today counts as already', inp.already.sort(), ['hspu','nordic','pistol']);
eq('the menu is explained in the exclusion', inp.areas.find(a=>a.id==='hspu').excluded, 'Already on today’s menu.');
eq('a removed area says so, with your reason', inp.areas.find(a=>a.id==='bridge').excluded, 'Taken off today’s menu (tired).');
r=ctx.recommendFor('2026-10-08',[30],old.concat([rec('2026-10-08','pistol')]));
eq('a new sitting does not repeat any of that', r.picked.filter(id=>['hspu','nordic','pistol','bridge'].includes(id)), []);

console.log('the lights:');
reset(); ctx.todayISO=()=>'2026-10-08';
const mu=ctx.areaById('mu');
ctx.checkIns=[ci('2026-10-07',{elbow:4})];
eq('amber elbow holds muscle-up', ctx.holdReason(mu,'2026-10-08'), 'medial elbow amber');
eq('and one-arm pull-up with it, as the plan says', ctx.holdReason(ctx.areaById('oap'),'2026-10-08'), 'medial elbow amber');
eq('but not the kettlebell', ctx.holdReason(ctx.areaById('kb'),'2026-10-08'), null);
eq('amber is not a stop: it is not held', ctx.heldReason(mu,'2026-10-08'), null);
ctx.checkIns=[ci('2026-09-28',{elbow:4})];
eq('an amber week-and-a-bit ago has lifted', ctx.holdReason(mu,'2026-10-08'), null);
ctx.checkIns=[ci('2026-10-07',{elbow:7})];
eq('red is a stop', ctx.heldReason(mu,'2026-10-08'), 'medial elbow red');
ctx.checkIns=[ci('2026-10-07',{elbow:4})];
r=ctx.recommendFor('2026-10-08',[45],[]);
eq('the hold shows on the recommended line, and the area is still recommended', [r.lines.mu.hold, r.lines.mu.picked||r.lines.hspu.picked], ['medial elbow amber', true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
