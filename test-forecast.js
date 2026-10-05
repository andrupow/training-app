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
function ok(l,c){if(c)pass++;else{fail++;console.log(`  FAIL ${l}`);}}
function eq(l,g,w){const same=JSON.stringify(g)===JSON.stringify(w);if(same)pass++;else{fail++;console.log(`  FAIL ${l}\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`);}}

const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const idx=read('data/areas/index.json');
ctx.areaData={rules:read('data/rules.json'),legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};
/* Every week pinned to the targets as authored (no time fit, no ramp-in), as in test-menu.js. */
const pinWeeks=()=>{const t={};ctx.areaList().forEach(a=>{t[a.id]=ctx.stageWeek(a,ctx.currentStage(a)).target;});ctx.weekFits={};
  for(let d='2026-08-31',i=0;i<30;i++,d=ctx.addDays(d,7))ctx.weekFits[d]={budget:999,cost:0,minCost:0,startCost:0,verdict:'fits',targets:Object.assign({},t),trimmed:[],ramp:[]};};
const MINUTES={0:45,1:45,2:30,3:45,4:45,5:60,6:60};
const reset=(today)=>{pinWeeks();ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.checkIns=[];ctx.schedule={};ctx.settings={weekdayMinutes:Object.assign({},MINUTES)};
  delete store.dayPlans;delete store.areaDays;delete store.settings;ctx.todayISO=()=>today;};
const MON='2026-10-05', WED='2026-10-07';
const dates=(from)=>Array.from({length:7-ctx.isoDow(from)},(_,i)=>ctx.addDays(from,i));
const seed=(date,areas,minutes=45)=>{ctx.dayPlans[date]={sittings:[{minutes,areas:ctx.doOrder(areas)}],suggested:areas.slice(),removed:{}};areas.forEach(id=>ctx.freezeAreaDay(date,id));};
const row=(date,area)=>({date,area,done:5,total:5,full:true});
const fc=(today,days)=>ctx.weekForecast(today,days||[]);
const lim=ctx.areaData.rules.defaults;

console.log('which days are forecast:');
reset(MON);
eq('on a Monday, all seven days', Object.keys(fc(MON)), dates(MON));
reset(WED);
eq('on a Wednesday, Wednesday to Sunday only: the days gone are not forecast', Object.keys(fc(WED)), dates(WED));
reset('2026-10-11');
eq('on a Sunday, just Sunday', Object.keys(fc('2026-10-11')), ['2026-10-11']);
reset(MON); const saveAD=ctx.areaData; ctx.areaData=null;
eq('with no areas loaded it is empty, not an error', ctx.weekForecast(MON,[]), {});
ctx.areaData=saveAD;

console.log('what a day with no menu gets:');
reset(MON);
let f=fc(MON);
eq('today, with no menu yet, is exactly what Today would make: the recommender, in the day’s minutes', f[MON].picks, ctx.recommendFor(MON,[45],[]).picked);
eq('it is not marked as a real menu', [f[MON].real,f[MON].minutes], [false,45]);
eq('each day uses that weekday’s own minutes', dates(MON).map(d=>f[d].minutes), [45,45,30,45,45,60,60]);
ok('every pick has its reason', dates(MON).every(d=>f[d].picks.every(id=>typeof f[d].why[id]==='string'&&f[d].why[id].length)));
ok('picks are in the order to do things, like a real menu', dates(MON).every(d=>JSON.stringify(f[d].picks)===JSON.stringify(ctx.doOrder(f[d].picks))));

console.log('a day that already has a menu is left alone:');
reset(MON); seed(MON,['mu','hspu'],40);
f=fc(MON);
eq('today’s menu is shown as it is', [f[MON].real,f[MON].picks,f[MON].minutes], [true,ctx.doOrder(['mu','hspu']),40]);
reset(MON); seed(MON,['mu']); seed('2026-10-08',['bridge','kb'],50);
f=fc(MON);
eq('so is a later day that was planned ahead', [f['2026-10-08'].real,f['2026-10-08'].picks], [true,ctx.doOrder(['bridge','kb'])]);
ok('and the days after it count it as done (nothing re-suggests the bridge the next day)', !f['2026-10-09'].picks.includes('bridge')&&!f['2026-10-09'].picks.includes('kb'));

console.log('the forecast follows the same rules as a real day:');
reset(MON); f=fc(MON);
ok('never more areas than the day allows', dates(MON).every(d=>f[d].picks.length<=lim.maxAreas));
ok('never more high-load areas than allowed', dates(MON).every(d=>f[d].picks.filter(id=>ctx.areaById(id).load==='high').length<=lim.maxHigh));
ok('and they fit the day’s minutes', dates(MON).every(d=>f[d].picks.reduce((n,id)=>n+ctx.areaById(id).minutes,0)<=f[d].minutes));
ok('every day of a normal week has something on it', dates(MON).every(d=>f[d].picks.length>0));
const gapOf=id=>{const a=ctx.areaById(id);return ctx.stageGap(a,ctx.currentStage(a));};
const spread=ctx.areaList().every(a=>{const ds=dates(MON).filter(d=>f[d].picks.includes(a.id));return ds.every((d,i)=>i===0||ctx.daysBetween(ds[i-1],d)>=gapOf(a.id));});
ok('an area is never put twice inside its own gap', spread);
ok('and never more often than its weekly maximum', ctx.areaList().every(a=>dates(MON).filter(d=>f[d].picks.includes(a.id)).length<=ctx.stageWeek(a,ctx.currentStage(a)).max));
ok('the week asks for something of most areas, not just the first few', new Set([].concat.apply([],dates(MON).map(d=>f[d].picks))).size>=5);

console.log('each day is worked out as if the days before it were done (this is what spreads the week out):');
reset(MON); f=fc(MON);
const spaced=f[MON].picks.filter(id=>gapOf(id)>=2);
ok('there is something today with a gap of 2 or more days to test with', spaced.length>0);
const naive=ctx.recommendFor(ctx.addDays(MON,1),[45],[]).picked;
ok('asked as if today were not done, tomorrow would offer it again', spaced.some(id=>naive.includes(id)));
ok('but the forecast does not', spaced.every(id=>!f[ctx.addDays(MON,1)].picks.includes(id)));
reset(WED);
const doneRows=[row('2026-10-06','nordic'),row('2026-10-07','mu')];
f=fc(WED,doneRows);
ok('what really was done counts the same way: Nordic done on Tuesday is not offered on Wednesday or on Thursday', !f[WED].picks.includes('nordic')&&!f['2026-10-08'].picks.includes('nordic'));
reset('2026-10-06');
ctx.checkIns=[{date:'2026-09-30',pain:{elbow:0,shoulder:0,achilles:0,hamstring:9},stiffness:'none'}];
const nordic=ctx.areaById('nordic');
eq('Nordic is held through Tuesday and free from Wednesday (a red light lasts seven days)', ['2026-10-06','2026-10-07'].map(d=>ctx.heldReason(nordic,d)!==null), [true,false]);
seed('2026-10-06',['nordic','mu']);
f=fc('2026-10-06',[]);
eq('Tuesday’s menu still lists it', f['2026-10-06'].picks.includes('nordic'), true);
ok('but a held area was not really trained, so it is not counted as done: Wednesday offers it, as it is due and free', f['2026-10-07'].picks.includes('nordic'));

console.log('a red light holds an area back all week:');
reset(MON); ctx.checkIns=[{date:MON,pain:{elbow:0,shoulder:0,achilles:0,hamstring:9},stiffness:'none'}];
f=fc(MON);
ok('Nordic and the kettlebell are held by a red hamstring, so neither is suggested on any day', dates(MON).every(d=>!f[d].picks.includes('nordic')&&!f[d].picks.includes('kb')));

console.log('it only looks, it never writes:');
reset(MON);
ctx.ensureWeekFit(MON,[]);
const snap=()=>JSON.stringify([ctx.dayPlans,ctx.frozenDays,ctx.weekFits,ctx.settings,ctx.setLogs,ctx.progress,ctx.decisions,ctx.checkIns,store]);
const before=snap(); const input=[row('2026-10-05','mu')]; const inputBefore=JSON.stringify(input);
fc(MON,input);
eq('menus, frozen days, week fits, settings, logs and storage are all as they were', snap()===before, true);
eq('and the days it was given are not changed', JSON.stringify(input), inputBefore);
reset(MON); ctx.weekFits={};
fc(MON,[]);
ok('if this week had no fit yet it is made from what really happened, before any forecasting', !!ctx.weekFits[MON]);
reset(MON);
const t0=Date.now(); for(let i=0;i<20;i++) fc(MON,[]); const per=(Date.now()-t0)/20;
ok('a whole week takes well under a tenth of a second ('+per.toFixed(1)+' ms here)', per<100);

console.log('the grid:');
const made=[]; const origEl=ctx.el, origSvg=ctx.svgEl;
ctx.el=function(tag,attrs,kids){made.push({tag,attrs:attrs||{},kids});return origEl(tag,attrs,kids);};
ctx.svgEl=function(tag,attrs,kids){made.push({tag:'svg:'+tag,attrs:attrs||{}});return origSvg(tag,attrs,kids);};
const cellLabels=()=>made.filter(m=>m.attrs.class&&/wk-cell/.test(m.attrs.class)).map(m=>m.attrs['aria-label']);
const suggestedLabels=()=>cellLabels().filter(l=>/: suggested$/.test(l));
reset(MON); f=fc(MON);
made.length=0; ctx.weekGrid(MON,MON,[],{forecast:f});
const expected=dates(MON).reduce((n,d)=>n+f[d].picks.length,0);
eq('a dotted ring on every area-day the forecast names (today too, as it has no menu yet)', suggestedLabels().length, expected);
const onTue=cellLabels().filter(l=>/6 Oct/.test(l)&&/suggested$/.test(l));
eq('on the right days: Tuesday’s suggested cells are exactly Tuesday’s picks', onTue.map(l=>l.split(', ')[0]).sort(), f['2026-10-06'].picks.map(id=>ctx.areaById(id).name).sort());
ok('and Tuesday has some, so that is not an empty match', onTue.length>0);
ok('and the glyph drawn is the dotted ring', made.some(m=>m.tag==='svg:circle'&&m.attrs.class==='g-sug'));
made.length=0; ctx.weekGrid(MON,MON,[],{});
eq('without a forecast the grid is as it was: nothing suggested', suggestedLabels().length, 0);
made.length=0; ctx.weekGrid(MON,MON,[]);
eq('and with no options at all', suggestedLabels().length, 0);
reset(MON); seed(MON,['mu','hspu']); f=fc(MON);
made.length=0; ctx.weekGrid(MON,MON,[],{forecast:f});
const todays=cellLabels().filter(l=>/5 Oct/.test(l));
eq('a day with its own menu keeps its planned rings, not suggested ones', [todays.filter(l=>/planned$/.test(l)).length,todays.filter(l=>/suggested$/.test(l)).length], [2,0]);
reset(MON); seed(MON,['mu']); seed('2026-10-08',['bridge','kb'],50); f=fc(MON);
made.length=0; ctx.weekGrid(MON,MON,[],{forecast:f});
const thu=cellLabels().filter(l=>/8 Oct/.test(l));
eq('a day ahead that already has a menu shows it as planned, not as a suggestion', [thu.filter(l=>/planned$/.test(l)).map(l=>l.split(', ')[0]).sort(), thu.filter(l=>/suggested$/.test(l)).length], [['bridge','kb'].map(id=>ctx.areaById(id).name).sort(),0]);
reset(WED); f=fc(WED,[row('2026-10-06','mu')]);
made.length=0; ctx.weekGrid(MON,WED,[row('2026-10-06','mu')],{forecast:f});
const gone=cellLabels().filter(l=>/(5|6) Oct/.test(l));
eq('days already gone are never suggested, and what was done stays done', [gone.filter(l=>/suggested$/.test(l)).length, gone.filter(l=>/Muscle-up, 6 Oct.*done$/.test(l)).length], [0,1]);
made.length=0; ctx.weekGrid(MON,WED,[row('2026-10-06','mu')],{forecast:f,static:true});
ok('a static grid (last week’s card) draws without tapping and without error', cellLabels().length>0);
reset(MON); f=fc(MON);
const sum=ctx.weekSummary(MON,MON,[]);
eq('the week’s numbers do not count suggestions (planned is only ever a real menu)', [sum.planned,sum.skipped,sum.done], [0,0,0]);

console.log('what a cell may become (a day that has happened is never overwritten):');
const fcst={'2026-10-07':{real:false,minutes:45,picks:['mu'],why:{}},'2026-10-08':{real:true,minutes:45,picks:['mu'],why:{}}};
const cellOf=(date,state)=>({date,state});
eq('a day ahead with the area picked: suggested', ctx.forecastState(fcst,cellOf('2026-10-07','future'),'2026-10-05','mu'), 'suggested');
eq('a day ahead with its own menu: planned', ctx.forecastState(fcst,cellOf('2026-10-08','future'),'2026-10-05','mu'), 'planned');
eq('an area that was not picked: nothing to say', ctx.forecastState(fcst,cellOf('2026-10-07','future'),'2026-10-05','bridge'), null);
eq('a day the forecast does not cover: nothing to say', ctx.forecastState(fcst,cellOf('2026-10-09','future'),'2026-10-05','mu'), null);
eq('no forecast at all: nothing to say', [ctx.forecastState(null,cellOf('2026-10-07','future'),'2026-10-05','mu'),ctx.forecastState(undefined,cellOf('2026-10-07','future'),'2026-10-05','mu')], [null,null]);
eq('today, before its menu exists, reads as suggested', ctx.forecastState({'2026-10-07':fcst['2026-10-07']},cellOf('2026-10-07','none'),'2026-10-07','mu'), 'suggested');
eq('a day that is not today and says nothing trained is not touched', ctx.forecastState(fcst,cellOf('2026-10-07','none'),'2026-10-05','mu'), null);
['full','partial','skipped','planned','noplan'].forEach(s=>{
  eq('a cell that is '+s+' stays as it is, even if the forecast names it', [ctx.forecastState(fcst,cellOf('2026-10-07',s),'2026-10-07','mu'),ctx.forecastState(fcst,cellOf('2026-10-07',s),'2026-10-05','mu')], [null,null]);
});

console.log('the legend and the note:');
made.length=0; ctx.weekLegend({planned:0,skipped:0},false,true);
ok('the legend explains the dotted ring when there is one, in a word', made.some(m=>Array.isArray(m.kids)&&m.kids.indexOf('Suggested')>=0));
eq('and draws it', made.filter(m=>m.tag==='svg:circle'&&m.attrs.class==='g-sug').length, 1);
made.length=0; ctx.weekLegend({planned:0,skipped:0},false,false);
eq('but not when none is on screen', [made.filter(m=>m.tag==='svg:circle'&&m.attrs.class==='g-sug').length, made.some(m=>Array.isArray(m.kids)&&m.kids.indexOf('Suggested')>=0)], [0,false]);
reset(MON); f=fc(MON);
ok('forecastShows is true when a day ahead has suggestions', ctx.forecastShows(f)===true);
eq('false with no forecast', [ctx.forecastShows(null),ctx.forecastShows({})], [false,false]);
eq('and false when the only days are real menus', ctx.forecastShows({[MON]:{real:true,minutes:45,picks:['mu'],why:{}}}), false);

console.log('tapping a day ahead:');
const texts=()=>made.map(m=>m.attrs.text).filter(Boolean);
reset(MON); f=fc(MON);
const TUE='2026-10-06';
made.length=0; ctx.dayDetail(TUE,MON,[],f);
ok('a day ahead lists its suggestions, with the minutes', texts().includes('Suggested · 45 min'));
ok('by area name', f[TUE].picks.every(id=>texts().includes(ctx.areaById(id).name)));
eq('each marked as suggested', texts().filter(t=>t==='Suggested').length, f[TUE].picks.length);
ok('and says it can change', texts().some(t=>/real menu is made when you open the day/.test(t)));
made.length=0; ctx.dayDetail(TUE,MON,[]);
ok('asked without a forecast it still says what it always did', texts().includes('Nothing yet.'));
made.length=0; ctx.dayDetail(TUE,MON,[],{[TUE]:{real:false,minutes:45,picks:[],why:{}}});
ok('a day with nothing suggested says so', texts().includes('Nothing suggested for this day.'));
reset(MON); seed(MON,['mu'],40); f=fc(MON);
made.length=0; ctx.dayDetail(MON,MON,[],f);
ok('a day with a real menu shows that, and no suggestion', texts().includes('Sitting 1 · 40 min')&&!texts().includes('Suggested'));
reset(WED); ctx.settings.menuSince='2026-10-05'; f=fc(WED,[]);
made.length=0; ctx.dayDetail('2026-10-06',WED,[],f);
ok('a day gone with no menu still reads as it did', texts().includes('No plan recorded for this day.')&&!texts().includes('Suggested'));
reset(MON); f=fc(MON);
made.length=0; ctx.dayDetail(MON,MON,[row(MON,'bridge')],f);
ok('and so does a day with something logged and no menu: what was logged, not a forecast', !texts().includes('Suggested · 45 min'));
ctx.el=origEl; ctx.svgEl=origSvg;

console.log('the screen:');
const draws=fn=>{try{fn();return true;}catch(e){console.log('   ',e.message);return false;}};
reset(MON); ctx.areasView={week:null,day:null};
ok('the Areas tab draws with a forecast', draws(()=>ctx.renderAreas()));
ctx.areasView.day='2026-10-08';
ok('and with a day ahead selected', draws(()=>ctx.renderAreas()));
ctx.areasView.week=ctx.addDays(MON,-7);
ok('and on last week, which has no forecast', draws(()=>ctx.renderAreas()));
reset(MON); seed(MON,['mu','hspu']); ctx.areasView={week:null,day:null};
ok('and with today’s menu made', draws(()=>ctx.renderAreas()));
ok('the Today tab is unaffected', draws(()=>ctx.renderToday()));
ctx.todayISO=()=>new Date().toISOString().slice(0,10);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
