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

const pinWeeks=()=>{const tg={};ctx.areaList().forEach(a=>{tg[a.id]=ctx.stageWeek(a,ctx.currentStage(a)).target;});ctx.weekFits={};
  for(let d='2026-08-31',i=0;i<30;i++,d=ctx.addDays(d,7))ctx.weekFits[d]={budget:999,cost:0,minCost:0,startCost:0,verdict:'fits',targets:Object.assign({},tg),trimmed:[],ramp:[]};};
const draws=(f)=>{try{f();return true;}catch(e){console.log('   ',String(e.stack).split('\n').slice(0,3).join(' | '));return false;}};
const plan=(date,areas,removed)=>{ctx.dayPlans[date]={sittings:[{minutes:45,areas}],suggested:areas.concat(Object.keys(removed||{})),removed:removed||{},why:{}};};
const states=p=>p.cells.map(d=>d.status);

/* Thu 8 Oct 2026. This week is 5–11 Oct, last week 28 Sep – 4 Oct. */
const TODAY='2026-10-08', THIS='2026-10-05', LAST='2026-09-28';
reset(); pinWeeks(); ctx.todayISO=()=>TODAY;
['mu','nordic','pistol','bridge','hspu','oap','kb','plyo'].forEach(id=>ctx.areaList().some(a=>a.id===id)||(()=>{throw new Error('area '+id+' is not in the real data')})());

console.log('small helpers:');
eq('a range in one month', ctx.fmtRange('2026-10-05','2026-10-11'), '5–11 Oct');
eq('a range across two', ctx.fmtRange('2026-09-28','2026-10-04'), '28 Sep – 4 Oct');
eq('how a finished week ended', ctx.outcomeText({hit:5,over:0,met:2,missed:1}), 'Areas: 5 hit · 2 met minimum · 1 missed');
eq('over the max is said', ctx.outcomeText({hit:3,over:1,met:0,missed:0}), 'Areas: 3 hit · 1 over the max');
eq('nothing to say', ctx.outcomeText({hit:0,over:0,met:0,missed:0}), '');
eq('a day, in words', ctx.dayCountsText({done:2,partial:1,skipped:0,planned:3}), '2 done, 1 partial, 3 planned');
eq('an empty day', ctx.dayCountsText({done:0,partial:0,skipped:0,planned:0}), 'nothing on');

console.log('which week is showing:');
eq('this week, from a Thursday', ctx.shownWeekStart('2026-10-08',0), '2026-10-05');
eq('last week, from a Thursday', ctx.shownWeekStart('2026-10-08',-1), '2026-09-28');
eq('from a Sunday, still the same Monday', ctx.shownWeekStart('2026-10-11',0), '2026-10-05');
eq('from a Monday, last week is the one just ended', ctx.shownWeekStart('2026-10-12',-1), '2026-10-05');
eq('across a year end', ctx.shownWeekStart('2027-01-05',-1), '2026-12-28');

console.log('weeks from before the areas are history, not misses:');
reset();
ok('no menus ever: nothing to compare with', !ctx.weekBeforeAreas(LAST));
ctx.settings.menuSince='2026-10-05';
ok('the week before the first menu is history', ctx.weekBeforeAreas(LAST));
ok('the week the menus began is judged', !ctx.weekBeforeAreas(THIS));
ctx.settings.menuSince='2026-10-08';
ok('mid-week start: that whole week counts', !ctx.weekBeforeAreas(THIS));
ok('and the one before still does not', ctx.weekBeforeAreas(LAST));
ctx.settings.menuSince='2026-10-05';
ok('last week draws, unjudged', (ctx.todayWeek=-1, draws(()=>ctx.weekStripBlock(TODAY,[]))));
ctx.todayWeek=0;
reset();

console.log('did the week happen:');
reset();
ok('nothing in it', !ctx.weekHappened(LAST,[]));
ok('a day trained', ctx.weekHappened(LAST,[rec('2026-10-04','mu')]));
ok('a menu made and never opened', (plan('2026-09-30',['mu']), ctx.weekHappened(LAST,[])));
reset();
ok('the day before the week does not count', !ctx.weekHappened(LAST,[rec('2026-09-27','mu')]));
ok('nor the day after', !ctx.weekHappened(LAST,[rec('2026-10-05','mu')]));
ok('its first day does', ctx.weekHappened(LAST,[rec('2026-09-28','mu')]));

console.log('this week, day by day:');
reset(); pinWeeks();
plan('2026-10-05',['pistol','bridge']);                          // Mon: both done
plan('2026-10-07',['hspu','pistol','oap']);                      // Wed: two done, one part-way
plan('2026-10-08',['mu','nordic']);                              // Thu (today): one done, one to go
const days=[rec('2026-10-05','pistol'),rec('2026-10-05','bridge'),
            rec('2026-10-07','hspu'),rec('2026-10-07','pistol'),rec('2026-10-07','oap',false,1,4),
            rec('2026-10-08','mu')];
let p=ctx.weekPicture(THIS,TODAY,days,null);
eq('seven days, Monday first', p.cells.map(d=>d.date), ['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11']);
eq('done, nothing, part-way, today, then nothing yet', states(p), ['done','rest','partial','today','rest','rest','rest']);
eq('the numbers', p.totals, {done:5,partial:1,skipped:0,planned:1});
eq('the whole agenda', p.agenda, 7);
eq('a done day is full', [p.cells[0].done,p.cells[0].agenda,p.cells[0].fill], [2,2,100]);
eq('a part-done area counts as its share of sets: (1+1+¼) of 3', p.cells[2].fill, 75);
eq('today, one done of two', [p.cells[3].done,p.cells[3].planned,p.cells[3].fill], [1,1,50]);
eq('a day with nothing on has an empty agenda', [p.cells[1].agenda,p.cells[1].fill], [0,0]);

console.log('finishing today turns it done:');
const all=days.concat([rec('2026-10-08','nordic')]);
eq('today, everything on the menu done', ctx.weekPicture(THIS,TODAY,all,null).cells[3].status, 'done');
eq('and the week is one more done', ctx.weekPicture(THIS,TODAY,all,null).totals, {done:6,partial:1,skipped:0,planned:0});

console.log('a day gone by:');
reset(); pinWeeks();
plan('2026-10-06',['kb'],{plyo:'tired'});                         // on the menu or taken off it, and nothing logged
p=ctx.weekPicture(THIS,TODAY,[],null);
eq('menu and a removal, nothing done: skipped', [p.cells[1].status,p.cells[1].skipped,p.cells[1].done], ['skipped',2,0]);
eq('and it is in the week’s numbers', p.totals.skipped, 2);
p=ctx.weekPicture(THIS,TODAY,[rec('2026-10-06','kb')],null);
eq('one done, one skipped: part-way', [p.cells[1].status,p.cells[1].fill], ['partial',50]);
eq('a day with no menu and no log is not a skip', ctx.weekPicture(THIS,TODAY,[],null).cells[0].status, 'rest');

console.log('days ahead come from the forecast:');
reset(); pinWeeks();
const fc={'2026-10-09':{real:false,minutes:30,picks:['mu'],why:{},left:[]},
          '2026-10-10':{real:true,minutes:45,picks:['kb','plyo'],why:{},left:[]},
          '2026-10-06':{real:false,minutes:30,picks:['bridge'],why:{},left:[]}};   // a day gone: never shown
p=ctx.weekPicture(THIS,TODAY,[],fc);
eq('a suggestion and a real menu both read as planned', [p.cells[4].status,p.cells[4].planned,p.cells[5].status,p.cells[5].planned], ['planned',1,'planned',2]);
eq('planned days have nothing done', [p.cells[4].fill,p.cells[5].fill], [0,0]);
eq('a forecast does not rewrite a day already gone', p.cells[1].status, 'rest');
eq('planned adds to the week', p.totals.planned, 3);
eq('without a forecast, days ahead are empty', ctx.weekPicture(THIS,TODAY,[],null).cells[4].status, 'rest');
ctx.dayPlans['2026-10-08']={sittings:[{minutes:45,areas:['mu']}],suggested:['mu'],removed:{},why:{}};
eq('today’s own menu is planned without a forecast', ctx.weekPicture(THIS,TODAY,[],null).cells[3].planned, 1);
eq('and a forecast for today does not double it', ctx.weekPicture(THIS,TODAY,[],{'2026-10-08':{real:true,minutes:45,picks:['mu'],why:{},left:[]}}).cells[3].planned, 1);

console.log('last week, finished:');
reset(); pinWeeks();
const n=ctx.areaList().length;
p=ctx.weekPicture(LAST,TODAY,[],null);
eq('nothing trained: every area missed', p.outcome, {hit:0,over:0,met:0,missed:n});
eq('no day is planned or part-way', states(p), Array(7).fill('rest'));
const hitAll=[];ctx.areaList().forEach(a=>{const t=ctx.areaWeek(a,LAST,TODAY,[]).target;for(let i=0;i<t;i++)hitAll.push(rec(ctx.addDays(LAST,i),a.id));});
p=ctx.weekPicture(LAST,TODAY,hitAll,null);
eq('every area trained exactly its target: all hit', p.outcome, {hit:n,over:0,met:0,missed:0});
eq('the outcome always accounts for every area', Object.values(p.outcome).reduce((a,b)=>a+b,0), n);
const minOnly=[];ctx.areaList().forEach(a=>{const w=ctx.areaWeek(a,LAST,TODAY,[]);if(w.min<w.target)for(let i=0;i<w.min;i++)minOnly.push(rec(ctx.addDays(LAST,i),a.id));});
if(minOnly.length)ok('trained only its minimum where that is lower than the target: met, not hit', ctx.weekPicture(LAST,TODAY,minOnly,null).outcome.met>0);
eq('a finished week has nothing planned', ctx.weekPicture(LAST,TODAY,hitAll,null).totals.planned, 0);

console.log('the weeks either side:');
reset(); pinWeeks();
eq('a week long past', ctx.weekPicture('2026-08-03',TODAY,[],null).agenda, 0);
eq('a week far ahead with no forecast', ctx.weekPicture('2026-11-02',TODAY,[],null).agenda, 0);

console.log('the card draws:');
reset(); pinWeeks();
plan('2026-10-05',['pistol','bridge']); plan('2026-10-08',['mu','nordic']); plan('2026-10-02',['kb'],{plyo:'tired'});
const some=[rec('2026-10-05','pistol'),rec('2026-10-05','bridge'),rec('2026-10-08','mu'),rec('2026-10-02','kb')];
ctx.todayWeek=0;
ok('this week', draws(()=>ctx.weekStripBlock(TODAY,some)));
ctx.todayWeek=-1;
ok('last week, with a skip to list', draws(()=>ctx.weekStripBlock(TODAY,some)));
ctx.todayWeek=0;
ok('a week with nothing in it', draws(()=>ctx.weekStripBlock(TODAY,[])));
ctx.dayPlans={};
ok('with no menus at all', draws(()=>ctx.weekStripBlock(TODAY,[])));
ctx.todayWeek=-1;
ok('last week, nothing in it', draws(()=>ctx.weekStripBlock(TODAY,[])));
ctx.todayWeek=0;
ok('repainting in place', draws(()=>ctx.paintTodayWeek()));
ok('every day status makes a cell', ['done','today','planned','partial','skipped','rest'].every(st=>draws(()=>ctx.weekDayCell({date:TODAY,done:1,partial:0,skipped:0,planned:1,agenda:2,fill:50,status:st},TODAY))));
ctx.todaySessions=[];
ok('a tick with nothing on screen is quiet', draws(()=>ctx.paintCount()));
ctx.areaDays=()=>some;
ok('the whole Today page still draws', draws(()=>ctx.renderToday()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
