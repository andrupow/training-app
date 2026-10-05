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
sandbox.document.createElementNS=()=>fakeNode;
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
/* These tests are about status and menu logic, so every week is pinned to the targets
   as authored: no time fit, no ramp-in. test-fit.js covers those. */
const pinWeeks=()=>{const t={};ctx.areaList().forEach(a=>{t[a.id]=ctx.stageWeek(a,ctx.currentStage(a)).target;});ctx.weekFits={};
  for(let d='2026-08-31',i=0;i<30;i++,d=ctx.addDays(d,7))ctx.weekFits[d]={budget:999,cost:0,minCost:0,startCost:0,verdict:'fits',targets:Object.assign({},t),trimmed:[],ramp:[]};};
const reset=()=>{pinWeeks();ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.checkIns=[];ctx.schedule={};ctx.settings={};store.dayPlans=undefined;delete store.dayPlans;delete store.areaDays;};
const logAllSets=(sid)=>{ctx.sessionById(sid).exercises.forEach(e=>{for(let i=0;i<e.sets;i++)ctx.writeLog(sid,e.id,i,{done:true});});};


/* helpers: train an area on a date, fully or partly, the way the app logs it */
const train=(date,area,full=true)=>{ ctx.freezeAreaDay(date,area); const s=ctx.sessionById(date+':'+area);
  s.exercises.forEach((e,xi)=>{ for(let i=0;i<e.sets;i++){ if(full||(xi===0&&i===0)) ctx.writeLog(s.id,e.id,i,{done:true}); } }); };
const D='2026-10-08';           // a Thursday; its week starts Mon 5 Oct
const days=()=>ctx.areaDays();
const names=a=>a.map(r=>r.area.id);
/* a day's menu as the app would have left it, without asking the recommender */
const seed=(date,areas,minutes=45)=>{ ctx.dayPlans[date]={sittings:[{minutes,areas:ctx.doOrder(areas)}],suggested:areas.slice(),removed:{}};
  areas.forEach(id=>ctx.freezeAreaDay(date,id)); if(!ctx.settings.menuSince) ctx.settings.menuSince=date; };

console.log('what the day starts with (the recommender; its own rules are in test-recommend.js):');
reset();
eq('on a Thursday with nothing done, one-arm and Nordic need today for their spacing, and the bridge fills the 45', ctx.suggestAreas(D,45,[]), ['nordic','oap','bridge']);
eq('at 20 minutes only Nordic and one short thing fit', ctx.suggestAreas(D,20,[]), ['nordic']);
ctx.checkIns=[ci('2026-10-06',{hamstring:8})];
eq('a red hamstring takes Nordic out and something else steps in', ctx.suggestAreas(D,45,[]).includes('nordic'), false);
ctx.checkIns=[];

console.log('the menu is made once, the first time the day is shown:');
reset();
const sug=ctx.suggestAreas(D,45,[]);
const plan=ctx.ensureDayPlan(D,[]);
eq('one sitting with the default minutes', plan.sittings.map(s=>s.minutes), [45]);
eq('the suggestion is on it and remembered', [plan.sittings[0].areas, plan.suggested], [sug, sug]);
eq('what it suggested is frozen: Nordic at its first stage', ctx.frozenDays[D+':nordic'].stage, 'N1');
eq('menus begin today', ctx.settings.menuSince, D);
ok('and it is saved', !!JSON.parse(store.dayPlans)[D]);
const again=ctx.ensureDayPlan(D,[]);
ok('asking again returns the same plan', again===plan);
ctx.ensureDayPlan('2026-10-09',[]);
eq('menuSince does not move', ctx.settings.menuSince, D);
ok('this week\u2019s fit was saved with it', !!ctx.weekFits['2026-10-05']);

console.log('the list:');
reset(); seed(D,['mu']);
let rows=ctx.menuRows(D,0,[]);
eq('selected first, then what the recommender would add to the 15 minutes left, then most urgent, then priority', names(rows), ['mu','nordic','hspu','pistol','oap','plyo','bridge','kb']);
eq('the reason says why (the status tag says Due)', rows[0].reason, '0/2 this week, not trained yet');
eq('and for one not due', rows.find(r=>r.area.id==='bridge').reason, '0/3 this week, not trained yet');
ctx.checkIns=[ci('2026-10-03',{hamstring:8})];
rows=ctx.menuRows(D,0,[]);
eq('Nordic and kettlebell are held', rows.filter(r=>r.held).map(r=>r.area.id).sort(), ['kb','nordic']);
eq('and say why', rows.find(r=>r.area.id==='nordic').held, 'hamstring red');
eq('the others are not', rows.find(r=>r.area.id==='mu').held, null);
ctx.checkIns=[];

console.log('warnings (they never block):');
reset(); seed(D,['mu']);
const w=(id,dys=[])=>ctx.menuWarnings(ctx.areaById(id),D,ctx.dayPlans[D],dys);
eq('HSPU alongside muscle-up', w('hspu'), ['Not usually with Muscle-up: both load shoulders and triceps.']);
eq('one-arm pull-up alongside muscle-up', w('oap'), ['Not usually with Muscle-up: both load the elbow tendons.']);
eq('pistol has nothing to say', w('pistol'), []);
reset(); seed(D,['mu']); train('2026-10-07','mu');
eq('muscle-up trained yesterday', w('mu',days()), ['Trained yesterday. It usually wants 2+ days between.']);
reset(); train('2026-10-05','mu'); train('2026-10-06','mu'); train('2026-10-07','mu'); seed(D,[]);
ok('three this week is its max', w('mu',days()).some(x=>x==='Already at its weekly max of 3.'));
reset(); train('2026-10-05','mu'); train('2026-10-07','mu'); train('2026-10-06','oap'); train('2026-10-02','oap'); seed('2026-10-10',[]);
eq('muscle-up 2 and one-arm 1 this week is 3 of 4: not yet capped', ctx.menuWarnings(ctx.areaById('oap'),'2026-10-10',ctx.dayPlans['2026-10-10'],days()).filter(x=>/cap/.test(x)), []);
train('2026-10-09','oap');
ok('one more makes 4 of 4: the shared cap is used', ctx.menuWarnings(ctx.areaById('mu'),'2026-10-10',ctx.dayPlans['2026-10-10'],days()).some(x=>x==="This week's elbow tendon cap is used: 4 of 4 days."));
reset(); train(D,'bridge'); seed(D,[]);
eq('already done today', w('bridge',days()), ['Already trained today. This adds to the same day.']);
reset(); seed(D,['mu']); ctx.addAreaToDay(D,0,'nordic');
eq('Nordic and kettlebell: a soft one', w('kb'), ['Best not the same day as Nordic curl: both load the hamstrings.']);

console.log('adding and removing:');
reset(); seed(D,['mu']);
eq('plyometrics goes first (power), then muscle-up (skill)', (ctx.addAreaToDay(D,0,'plyo'), ctx.dayPlans[D].sittings[0].areas), ['plyo','mu']);
ctx.addAreaToDay(D,0,'bridge'); ctx.addAreaToDay(D,0,'kb');
eq('then mobility, then kettlebell', ctx.dayPlans[D].sittings[0].areas, ['plyo','mu','bridge','kb']);
eq('adding twice does not duplicate', (ctx.addAreaToDay(D,0,'bridge'), ctx.dayPlans[D].sittings[0].areas.length), 4);
ok('what you add is frozen', !!ctx.frozenDays[D+':bridge']);
eq('an unknown sitting is refused', ctx.addAreaToDay(D,5,'pistol').ok, false);
ctx.checkIns=[ci('2026-10-03',{hamstring:8})];
let r=ctx.addAreaToDay(D,0,'nordic');
eq('a held area cannot be added', [r.ok, r.why], [false,'Nordic curl is held: hamstring red.']);
ok('and is not on the day', ctx.dayPlans[D].sittings[0].areas.indexOf('nordic')<0);
ctx.checkIns=[];

reset(); seed(D,['mu']); ctx.addAreaToDay(D,0,'pistol');
ctx.removeAreaFromDay(D,0,'mu','no time');
eq('taking off what the app suggested is a skip, with the reason', ctx.dayPlans[D].removed, {mu:'no time'});
ok('and it forgets what it would have held', !ctx.frozenDays[D+':mu']);
ctx.removeAreaFromDay(D,0,'pistol');
eq('taking off what you added yourself is not', ctx.dayPlans[D].removed, {mu:'no time'});
ctx.addAreaToDay(D,0,'mu');
eq('putting it back clears the skip', ctx.dayPlans[D].removed, {});
train(D,'mu',false);
r=ctx.removeAreaFromDay(D,0,'mu');
eq('once started it cannot come off', [r.ok, r.why], [false,'Already started, so it stays on the day.']);
ok('and it is still there', ctx.dayPlans[D].sittings[0].areas.indexOf('mu')>=0);

console.log('sittings:');
reset(); seed(D,['mu']);
eq('a second', ctx.addSitting(D,30), 1);
eq('a third', ctx.addSitting(D,30), 2);
eq('no fourth', ctx.addSitting(D,30), -1);
eq('three in all', ctx.dayPlans[D].sittings.map(s=>s.minutes), [45,30,30]);
ctx.setSittingMinutes(D,1,60);
eq('minutes change', ctx.dayPlans[D].sittings[1].minutes, 60);
eq('the second sitting does not set the weekday default', ctx.defaultMinutes('2026-10-15'), 45);
ctx.setSittingMinutes(D,0,30);
eq('the first one does', ctx.defaultMinutes('2026-10-15'), 30);
ctx.setSittingMinutes(D,0,-5);
eq('nonsense minutes are ignored', ctx.dayPlans[D].sittings[0].minutes, 30);
eq('an empty sitting can go', ctx.removeSitting(D,2), true);
ctx.addAreaToDay(D,1,'bridge');
eq('one with something in it cannot', ctx.removeSitting(D,1), false);
eq('nor the only one', (ctx.removeSitting(D,1), ctx.removeAreaFromDay(D,1,'bridge'), ctx.removeSitting(D,1), ctx.removeSitting(D,0)), false);
console.log('the same area in two sittings:');
reset(); seed(D,['mu']);
ctx.addSitting(D,30); ctx.addAreaToDay(D,1,'mu');
eq('it is on both', ctx.dayPlans[D].sittings.map(s=>s.areas), [['mu'],['mu']]);
ctx.removeAreaFromDay(D,1,'mu');
eq('taking it off the second does not skip it', [ctx.dayPlans[D].removed, ctx.dayPlans[D].sittings[0].areas], [{}, ['mu']]);
ctx.addAreaToDay(D,1,'mu'); ctx.removeAreaFromDay(D,0,'mu','tired');
eq('nor off the first while the second has it', [ctx.dayPlans[D].removed, !!ctx.frozenDays[D+':mu']], [{}, true]);

console.log('minutes against the sitting:');
eq('muscle-up and pistol in a 45', ctx.sittingLoad({minutes:45,areas:['mu','pistol']}), {planned:48,over:3});
eq('and in a 60', ctx.sittingLoad({minutes:60,areas:['mu','pistol']}), {planned:48,over:0});
eq('empty', ctx.sittingLoad({minutes:30,areas:[]}), {planned:0,over:0});

console.log('what each cell of the week says:');
reset();
const today='2026-10-08';
const cs=(date,area,rec)=>ctx.dayCellState(date,area,today,rec||null);
eq('done', cs('2026-10-06','mu',{full:true}), 'full');
eq('partial', cs('2026-10-06','mu',{full:false}), 'partial');
eq('the future', cs('2026-10-09','mu'), 'future');
eq('no menus yet at all: nothing', cs('2026-10-06','mu'), 'none');
ctx.settings.menuSince='2026-10-06';
eq('a day since menus began that was never opened', cs('2026-10-07','mu'), 'noplan');
eq('but a day before they began is just nothing', cs('2026-10-05','mu'), 'none');
eq('and today is not "no plan", it simply has none yet', cs(today,'mu'), 'none');
ctx.dayPlans['2026-10-07']={sittings:[{minutes:45,areas:['mu','bridge']}],suggested:['mu'],removed:{pistol:'no time'}};
eq('planned in the past and not done: skipped', cs('2026-10-07','mu'), 'skipped');
eq('taken off by you: skipped', cs('2026-10-07','pistol'), 'skipped');
eq('on a planned day, an area that was never on it: nothing', cs('2026-10-07','kb'), 'none');
eq('done beats everything', cs('2026-10-07','mu',{full:true}), 'full');
ctx.dayPlans[today]={sittings:[{minutes:45,areas:['hspu']}],suggested:['hspu'],removed:{plyo:'tired'}};
eq('planned today and not yet done', cs(today,'hspu'), 'planned');
eq('taken off today is skipped now, it is a decision', cs(today,'plyo'), 'skipped');

console.log('the week in numbers:');
reset(); ctx.settings.menuSince='2026-10-05';
train('2026-10-05','mu'); train('2026-10-05','bridge',false); train('2026-10-06','hspu');   // Tuesday has no plan: logged afterwards
ctx.dayPlans['2026-10-05']={sittings:[{minutes:45,areas:['mu','bridge']}],suggested:['mu'],removed:{}};
ctx.dayPlans['2026-10-07']={sittings:[{minutes:45,areas:['pistol']}],suggested:['pistol','oap'],removed:{oap:'no time'}};   // oap taken off by hand
ctx.dayPlans['2026-10-08']={sittings:[{minutes:45,areas:['plyo']}],suggested:['plyo'],removed:{}};
const sm=ctx.weekSummary('2026-10-05','2026-10-08',days());
eq('done: muscle-up and HSPU', sm.done, 2);
eq('partial: the bridge', sm.partial, 1);
eq('skipped: pistol and one-arm on Wednesday', sm.skipped, 2);
eq('planned: plyometrics today', sm.planned, 1);
eq('who was skipped, and why', sm.skippedItems.map(i=>[i.area.id,i.date,i.reason]).sort(), [['oap','2026-10-07','no time'],['pistol','2026-10-07','']]);
const cells=ctx.areaWeek(ctx.areaById('bridge'),'2026-10-05','2026-10-08',days()).cells.map(c=>c.state);
eq('and a row of the grid', cells, ['partial','noplan','none','none','future','future','future']);
eq('Tuesday (no plan) shows a hatch for areas not trained', ctx.areaWeek(ctx.areaById('pistol'),'2026-10-05','2026-10-08',days()).cells[1].state, 'noplan');

console.log('one day in detail:');
let dd=ctx.dayDetailItems('2026-10-05','2026-10-08',days());
eq('planned: two items in one sitting', dd.sittings.map(s=>s.items.map(i=>[i.area.id,i.state])), [[['mu','full'],['bridge','partial']]]);
eq('with its minutes', dd.sittings[0].minutes, 45);
eq('no extras and a plan', [dd.extras.length, dd.noPlan], [0,false]);
dd=ctx.dayDetailItems('2026-10-06','2026-10-08',days());
eq('a day with no plan says so and lists what was logged', [dd.noPlan, dd.extras.map(e=>[e.area.id,e.state])], [true,[['hspu','full']]]);
dd=ctx.dayDetailItems('2026-10-07','2026-10-08',days());
eq('a skipped day lists what was planned', dd.sittings[0].items.map(i=>[i.area.id,i.state]), [['pistol','skipped']]);
eq('and what you took off, with your reason', dd.extras.map(e=>[e.area.id,e.state,e.reason]), [['oap','skipped','no time']]);

console.log('the week card on screen (the fake DOM cannot be read, so these are smoke tests and helpers):');
eq('a stored reason reads as its label', ['no time','tired','pain','other',''].map(ctx.reasonText), ['No time','Tired','Pain','Other','']);
eq('a reason from somewhere else is shown as it is', ctx.reasonText('car broke down'), 'car broke down');
eq('this week has a no-plan day (Tuesday)', ctx.weekHasNoPlan('2026-10-05','2026-10-08',days()), true);
eq('a week before menus began has none', ctx.weekHasNoPlan('2026-09-28','2026-10-08',days()), false);
ok('every state draws a glyph without throwing', ['full','partial','planned','skipped','noplan','none','future'].every(s=>{try{ctx.stateGlyph(s);return true;}catch(e){return false;}}));
ok('the legend draws for a busy week and an empty one', [[sm,true],[{planned:0,skipped:0},false]].every(p=>{try{ctx.weekLegend(p[0],p[1]);return true;}catch(e){return false;}}));
ok('the skipped list is empty when nothing was skipped', ctx.skippedList({skippedItems:[]})===null);
ok('and draws when something was', (()=>{try{return ctx.skippedList(sm)!==null;}catch(e){return false;}})());
ok('the card and each kind of day detail draw', ['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-09-30'].every(d=>{try{ctx.dayDetail(d,'2026-10-08',days());return true;}catch(e){return false;}})
  && (()=>{try{ctx.weekCard('2026-10-05','2026-10-08',days());return true;}catch(e){return false;}})());

console.log('why each area is on the menu:');
reset();
const p1=ctx.ensureDayPlan(D,[]);
eq('every suggestion keeps the reason it was made for', Object.keys(p1.why).sort(), p1.suggested.slice().sort());
eq('in words', p1.why.nordic, 'Needs today to reach its target for the week.');
ctx.loadDayPlans();
eq('and it survives a reload', ctx.dayPlans[D].why, p1.why);

console.log('a new sitting is a new question:');
reset(); seed(D,['mu']); ctx.addSitting(D,30);
let filled=ctx.fillSitting(D,1,[]);
eq('with muscle-up already on the menu it fills with what is still worth doing: not muscle-up, not HSPU or one-arm', filled, ['pistol','nordic']);
eq('they go into that sitting, in order', ctx.dayPlans[D].sittings.map(s=>s.areas), [['mu'],['pistol','nordic']]);
eq('they count as suggested, so taking one off is a skip', ctx.dayPlans[D].suggested, ['mu','pistol','nordic']);
eq('with the reasons', ctx.dayPlans[D].why, {pistol:'Still needs 2 more this week.',nordic:'Needs today to reach its target for the week.'});
ok('and are frozen', !!ctx.frozenDays[D+':pistol']&&!!ctx.frozenDays[D+':nordic']);
eq('a sitting that already has something is left alone', ctx.fillSitting(D,1,[]), []);
eq('so is one that does not exist', ctx.fillSitting(D,7,[]), []);
reset(); seed(D,['mu']); ctx.addSitting(D,30); ctx.removeAreaFromDay(D,0,'mu','tired');
ctx.dayPlans[D].sittings[0].areas=[];
eq('something you took off is not suggested again', ctx.fillSitting(D,1,[]).includes('mu'), false);
reset(); seed(D,[]); ctx.addSitting(D,30);
eq('what was done today counts: pistol trained this morning is not suggested again', (train(D,'pistol'), ctx.fillSitting(D,1,days()).includes('pistol')), false);

console.log('a different time on an untouched day is a new question too:');
reset(); ctx.ensureDayPlan(D,[]);
eq('45 minutes', ctx.dayPlans[D].sittings[0].areas, ['nordic','oap','bridge']);
ctx.setSittingMinutes(D,0,60);
eq('it can change', ctx.resuggest(D,[]), true);
eq('60 minutes fits one more', ctx.dayPlans[D].sittings[0].areas, ['pistol','nordic','oap','bridge']);
eq('suggested and reasons follow', [ctx.dayPlans[D].suggested, Object.keys(ctx.dayPlans[D].why).sort()], [['pistol','nordic','oap','bridge'], ['bridge','nordic','oap','pistol']]);
ok('the new one is frozen', !!ctx.frozenDays[D+':pistol']);
ctx.setSittingMinutes(D,0,30);
ctx.resuggest(D,[]);
ok('and 30 drops some, and forgets what they would have held', ctx.dayPlans[D].sittings[0].areas.length<4&&!ctx.frozenDays[D+':bridge']);
reset(); ctx.ensureDayPlan(D,[]); ctx.addAreaToDay(D,0,'kb'); ctx.setSittingMinutes(D,0,60);
eq('once you have added something it is yours: left alone', [ctx.resuggest(D,[]), ctx.dayPlans[D].sittings[0].areas.includes('kb')], [false,true]);
reset(); ctx.ensureDayPlan(D,[]); ctx.removeAreaFromDay(D,0,'nordic','tired'); ctx.setSittingMinutes(D,0,60);
eq('or taken off', ctx.resuggest(D,[]), false);
reset(); ctx.ensureDayPlan(D,[]); ctx.writeLog(D+':nordic','nordic',0,{done:true}); ctx.setSittingMinutes(D,0,60);
eq('or started', ctx.resuggest(D,[]), false);
reset(); ctx.ensureDayPlan(D,[]); ctx.addSitting(D,30); ctx.setSittingMinutes(D,0,60);
eq('or with two sittings', ctx.resuggest(D,[]), false);
eq('no menu, nothing to do', (reset(), ctx.resuggest(D,[])), false);

console.log('each row on the list, as the recommender sees it:');
reset(); seed(D,['mu']);
rows=ctx.menuRows(D,0,[]);
const row=id=>rows.find(r=>r.area.id===id);
eq('Nordic is what it would add to the 15 minutes left', [row('nordic').recommended, row('nordic').advice.why], [true,'Needs today to reach its target for the week.']);
eq('HSPU is ruled out by muscle-up', [row('hspu').recommended,row('hspu').advice.kind], [false,'conflict']);
eq('the bridge would fit 15 minutes on its own, but Nordic is the better use of it', [row('bridge').advice.kind,row('bridge').advice.why], ['time','Needs about 12 min; 5 left today.']);
eq('what is on the menu says so', [row('mu').recommended,row('mu').advice.kind], [false,'excluded']);
eq('a full sitting has no room for anything', (ctx.dayPlans[D].sittings[0].minutes=30, ctx.menuRows(D,0,[]).find(r=>r.area.id==='bridge').advice.why), 'Needs about 12 min; today has no room.');
ctx.dayPlans[D].sittings[0].minutes=45;
ctx.checkIns=[ci('2026-10-07',{elbow:4})];
rows=ctx.menuRows(D,0,[]);
eq('an amber elbow holds muscle-up and one-arm, and holds nothing else', rows.filter(r=>r.hold).map(r=>r.area.id).sort(), ['mu','oap']);
eq('and says why', row('mu').hold, 'medial elbow amber');
ctx.checkIns=[];

console.log('the time chip and the new screens draw:');
reset(); ctx.ensureDayPlan(D,[]);
eq('the chip changes the minutes and asks again', [ctx.changeSittingMinutes(D,0,60,[]), ctx.dayPlans[D].sittings[0].areas], [true,['pistol','nordic','oap','bridge']]);
eq('on a second sitting it only changes the minutes', [ctx.addSitting(D,30), ctx.changeSittingMinutes(D,1,45,[]), ctx.dayPlans[D].sittings[1].minutes], [1,false,45]);
const draws=(f)=>{try{f();return true;}catch(e){console.log('   ',String(e.stack).split('\n').slice(0,3).join(' | '));return false;}};
ok('the fit block, for this week, last week and next', ['2026-10-05','2026-09-28','2026-10-12'].every(s=>draws(()=>ctx.fitBlock(s,D,[]))));
ctx.weekFits={};   // the pinned weeks the other tests use would answer
eq('a finished week nobody looked at has none', ctx.fitBlock('2026-09-28',D,[]), null);
reset(); ctx.weekFits={}; ctx.settings.weekdayMinutes={0:20,1:20,2:20,3:20,4:20,5:20,6:20};
ok('the over-booked callout appears when the minimums do not fit (140 min against 280)', ctx.overBooked(D,[])!==null);
reset(); ctx.weekFits={}; ctx.settings.weekdayMinutes={0:60,1:60,2:60,3:60,4:60,5:60,6:60};
eq('and not when they do', ctx.overBooked(D,[]), null);
reset(); seed(D,['mu']);
ok('an add row for a recommended area, a refused one and a held one', (()=>{
  const rs=ctx.menuRows(D,0,[]);
  ctx.checkIns=[ci('2026-10-07',{hamstring:8,elbow:4})];
  const rs2=ctx.menuRows(D,0,[]);
  ctx.checkIns=[];
  return rs.concat(rs2).filter(r=>!r.selected).every(r=>draws(()=>ctx.addRow(r,D,0)));
})());
ok('the area card, with reasons, a hold and a held area', (()=>{
  ctx.checkIns=[ci('2026-10-07',{elbow:4})]; ctx.todaySessions=[];
  const a=draws(()=>ctx.areaDayCard(D,0,'mu',ctx.dayPlans[D],true));
  ctx.checkIns=[ci('2026-10-07',{elbow:8})];
  const b=draws(()=>ctx.areaDayCard(D,0,'mu',ctx.dayPlans[D],true));
  ctx.checkIns=[];
  return a&&b;
})());
ok('Today and the Areas tab as a whole', draws(()=>{ ctx.todayISO=()=>D; ctx.renderToday(); ctx.renderAreas(); ctx.renderAreaDetail('kb'); }));

console.log('an area page opened directly saves the week’s fit:');
reset(); ctx.weekFits={}; ctx.todayISO=()=>D;
ctx.renderAreaDetail('kb');
ok('the target it shows is the one the week is judged by', !!ctx.weekFits['2026-10-05']);
ctx.todayISO=()=>new Date().toISOString().slice(0,10);

console.log('logging something done elsewhere:');
reset();
let lr=ctx.logAreaBlock('2026-10-06','pistol');
eq('every set of the block is done', [lr.ok, ctx.doneSets(ctx.sessionById('2026-10-06:pistol')), ctx.totalSets(ctx.sessionById('2026-10-06:pistol'))], [true,11,11]);
eq('and it counts as a full day', days().find(r=>r.date==='2026-10-06'&&r.area==='pistol').full, true);
ctx.writeLog('2026-10-07:mu','par-dips',0,{done:true});
ctx.freezeAreaDay('2026-10-07','mu');
lr=ctx.logAreaBlock('2026-10-07','mu');
eq('topping up something half done fills the rest', ctx.doneSets(ctx.sessionById('2026-10-07:mu')), 17);
eq('without disturbing the sets already logged', ctx.getLog('2026-10-07:mu','par-dips',0).done, true);
ctx.checkIns=[ci('2026-10-03',{hamstring:8})];
lr=ctx.logAreaBlock('2026-10-05','nordic');
eq('a held area is refused', [lr.ok, lr.why], [false,'Nordic curl is held: hamstring red.']);
ctx.checkIns=[];
eq('an unknown area is refused', ctx.logAreaBlock('2026-10-05','rowing').ok, false);

console.log('where to start, and what comes next:');
reset(); seed(D,['mu']); ctx.addAreaToDay(D,0,'pistol'); ctx.addAreaToDay(D,0,'bridge');
const m0=ctx.sessionById(D+':mu');
eq('the first exercise when nothing is done', ctx.firstOpenExercise(m0), 0);
ctx.writeLog(m0.id,'par-dips',0,{done:true});
eq('still the first, it has sets left', ctx.firstOpenExercise(m0), 0);
for(let i=0;i<4;i++) ctx.writeLog(m0.id,'par-dips',i,{done:true});
eq('then the next exercise', ctx.firstOpenExercise(m0), 1);
logAllSets(m0.id);
eq('all done: back to the start', ctx.firstOpenExercise(m0), 0);
eq('the sitting order is skill, then strength, then mobility', ctx.dayPlans[D].sittings[0].areas, ['mu','pistol','bridge']);
eq('after muscle-up comes pistol', ctx.nextAreaDay(m0).areaId, 'pistol');
logAllSets(D+':pistol');
eq('then bridge', ctx.nextAreaDay(ctx.sessionById(D+':pistol')).areaId, 'bridge');
logAllSets(D+':bridge');
eq('and then nothing', ctx.nextAreaDay(ctx.sessionById(D+':bridge')), null);
eq('anything that is not an area-day has no next', ctx.nextAreaDay(ctx.sessionById('W2-Mon')), null);
reset(); seed(D,['mu']); ctx.addAreaToDay(D,0,'pistol');
ctx.checkIns=[ci('2026-10-03',{achilles:8})]; ctx.addAreaToDay(D,0,'bridge');
ctx.checkIns=[];
logAllSets(D+':mu');
eq('an area that is done is skipped over', ctx.nextAreaDay(ctx.sessionById(D+':mu')).areaId, 'pistol');
logAllSets(D+':pistol');
eq('so the chain stops when everything is done', ctx.nextAreaDay(ctx.sessionById(D+':pistol')).areaId, 'bridge');

console.log('which screens wait for the area data:');
eq('an empty hash is Today', ctx.routeNeedsAreas(''), true);
eq('Today', ctx.routeNeedsAreas('#/today'), true);
eq('Areas', ctx.routeNeedsAreas('#/areas'), true);
eq('one area', ctx.routeNeedsAreas('#/areas/mu'), true);
eq('the runner', ctx.routeNeedsAreas('#/run/2026-10-05:mu/0'), true);
eq('Plan does not', ctx.routeNeedsAreas('#/plan/W4'), false);
eq('a plan session does not', ctx.routeNeedsAreas('#/session/W4-Mon'), false);
eq('Check-in does too: it asks about seven body areas once they are in', ctx.routeNeedsAreas('#/checkin'), true);
eq('Progress does too: the equipment card needs them', ctx.routeNeedsAreas('#/progress'), true);
eq('undefined is Today', ctx.routeNeedsAreas(undefined), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
