const fs=require('fs'), vm=require('vm');
const store={}; const noop=()=>{};
const fakeNode=new Proxy({},{get(t,k){if(['appendChild','addEventListener','remove','focus','setAttribute','removeAttribute','scrollIntoView','click'].includes(k))return noop;if(k==='querySelector'||k==='querySelectorAll')return()=>fakeNode;if(k==='childNodes'||k==='classList')return[];if(k==='style')return{};return'';},set(){return true;}});
/* Each element keeps its own click handlers, so a test can press a button. */
const mkNode=()=>{const h={};return new Proxy({},{get(t,k){if(k==='_h')return h;if(k==='addEventListener')return(e,f)=>{h[e]=f;};if(['appendChild','remove','focus','setAttribute','removeAttribute','scrollIntoView','click'].includes(k))return noop;if(k==='querySelector'||k==='querySelectorAll')return()=>fakeNode;if(k==='childNodes'||k==='classList')return[];if(k==='style')return{};return'';},set(){return true;}});};
const sandbox={console,setTimeout,clearTimeout,Blob:class{},URL:{createObjectURL:()=>'blob:x',revokeObjectURL:noop},
 localStorage:{getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
 fetch:()=>Promise.reject(new Error('x')),navigator:{},location:{hash:'',protocol:'http:',replace:noop},
 document:{createElement:()=>mkNode(),createTextNode:()=>fakeNode,getElementById:()=>fakeNode,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop,removeEventListener:noop,body:fakeNode},
 window:{addEventListener:noop,scrollTo:noop,scrollY:0}};
sandbox.globalThis=sandbox; vm.createContext(sandbox);
sandbox.setInterval=()=>0; sandbox.clearInterval=noop;
sandbox.document.createElementNS=()=>fakeNode;
sandbox.document.body=new Proxy({},{get(t,k){return k==='classList'?{add:noop,remove:noop}:fakeNode[k];},set(){return true;}});

vm.runInContext(fs.readFileSync('app.js','utf8'),sandbox);
const ctx=sandbox;
ctx.plan=JSON.parse(fs.readFileSync('data/plan.json','utf8'));

let pass=0,fail=0;
function ok(l,c){if(c)pass++;else{fail++;console.log(`  FAIL ${l}`);}}
function eq(l,g,w){const same=JSON.stringify(g)===JSON.stringify(w);if(same)pass++;else{fail++;console.log(`  FAIL ${l}\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`);}}

const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const idx=read('data/areas/index.json');
const rules=read('data/rules.json');
const clone=o=>JSON.parse(JSON.stringify(o));
const loadAreas=()=>{ctx.areaData={rules:clone(rules),legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};};
loadAreas();
const pinWeeks=()=>{const t={};ctx.areaList().forEach(a=>{t[a.id]=ctx.stageWeek(a,ctx.currentStage(a)).target;});ctx.weekFits={};
  for(let d='2026-08-31',i=0;i<30;i++,d=ctx.addDays(d,7))ctx.weekFits[d]={budget:999,cost:0,minCost:0,startCost:0,verdict:'fits',targets:Object.assign({},t),trimmed:[],ramp:[]};};
const REAL={0:45,1:45,2:30,3:45,4:45,5:60,6:60};
const reset=(today,mins)=>{pinWeeks();ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.checkIns=[];ctx.schedule={};ctx.settings={weekdayMinutes:Object.assign({},mins||REAL)};ctx.forecastMemo={key:'',value:null};
  ['dayPlans','areaDays','settings','checkIns'].forEach(k=>delete store[k]);ctx.todayISO=()=>today;};
const BODY=['elbow','shoulder','wrist','lowerBack','knee','achilles','hamstring'];
const ci=(date,pain,stiff)=>({date,pain:Object.assign({},...BODY.map(b=>({[b]:0})),pain||{}),stiffness:stiff||'none'});
const MON='2026-10-05', FRI='2026-10-03';
const IDS=['mu','hspu','bridge','pistol','nordic','kb','oap','plyo'];
const minOf=id=>{const a=ctx.areaById(id);return ctx.stageWeek(a,ctx.currentStage(a)).min;};
const gapOf=id=>{const a=ctx.areaById(id);return ctx.stageGap(a,ctx.currentStage(a));};
const weekDates=(s)=>Array.from({length:7},(_,i)=>ctx.addDays(s,i));
const countIn=(f,id,s)=>weekDates(s).filter(d=>f[d]&&f[d].picks.includes(id)).length;
const allDates=f=>Object.keys(f).sort();

console.log('Bridge needs a day between sessions:');
eq('its gap is two days', ctx.areaById('bridge').minGapDays, 2);
reset(MON); let f=ctx.weekForecast(MON,[]);
const bridgeDays=allDates(f).filter(d=>f[d].picks.includes('bridge'));
ok('it has sessions in the forecast', bridgeDays.length>=8);
ok('and never on two days running, in any of the five weeks', bridgeDays.every((d,i)=>i===0||ctx.daysBetween(bridgeDays[i-1],d)>=2));
ok('and still reaches its three a week', [0,1,2,3,4].every(w=>countIn(f,'bridge',ctx.addDays(MON,7*w))>=3));

console.log('five weeks ahead, in the weekday minutes you gave:');
reset(MON); f=ctx.weekForecast(MON,[]);
eq('35 days, Monday to the Sunday five weeks on', [allDates(f).length,allDates(f)[0],allDates(f)[34]], [35,MON,'2026-11-08']);
ok('every area reaches its weekly minimum in every one of the five weeks', [0,1,2,3,4].every(w=>IDS.every(id=>countIn(f,id,ctx.addDays(MON,7*w))>=minOf(id))));
ok('and the week\u2019s minutes are well used (85% or more of them filled, week after week)', [0,1,2,3,4].every(w=>{const ds=weekDates(ctx.addDays(MON,7*w)).filter(d=>f[d]);const used=ds.reduce((n,d)=>n+f[d].picks.reduce((m,id)=>m+ctx.areaById(id).minutes,0),0),have=ds.reduce((n,d)=>n+f[d].minutes,0);return used>=0.85*have;}));
const breakCount=(f)=>{let n=0;const ds=allDates(f);
  IDS.forEach(id=>{const on=ds.filter(d=>f[d].picks.includes(id));on.forEach((d,i)=>{if(i&&ctx.daysBetween(on[i-1],d)<gapOf(id))n++;});});
  ds.forEach(d=>{const p=f[d].picks;rules.conflicts.filter(c=>!c.soft).forEach(c=>{if(p.includes(c.areas[0])&&p.includes(c.areas[1]))n++;});
    if(p.length>rules.defaults.maxAreas)n++; if(p.filter(id=>ctx.areaById(id).load==='high').length>rules.defaults.maxHigh)n++;
    if(!f[d].real&&p.reduce((m,id)=>m+ctx.areaById(id).minutes,0)>f[d].minutes)n++;});
  return n;};
eq('with no rule broken: spacing (across week boundaries too), hard conflicts, limits, minutes', breakCount(f), 0);

console.log('the lookahead: a day is picked so the week’s minimums can still fit:');
const SETUPS={'your week (45 45 30 45 45 60 60)':REAL,'flat 60':{0:60,1:60,2:60,3:60,4:60,5:60,6:60},'flat 50':{0:50,1:50,2:50,3:50,4:50,5:50,6:50},
  'long weekends':{0:30,1:45,2:30,3:45,4:30,5:90,6:90},'short weekdays':{0:30,1:30,2:30,3:30,4:30,5:90,6:90},'big mid-week':{0:30,1:60,2:90,3:60,4:30,5:45,6:45}};
Object.keys(SETUPS).forEach(name=>{
  reset(MON,SETUPS[name]); const g=ctx.weekForecast(MON,[]);
  const total=Object.values(SETUPS[name]).reduce((a,b)=>a+b,0);
  const missed=[];[1,2,3,4].forEach(w=>IDS.forEach(id=>{if(countIn(g,id,ctx.addDays(MON,7*w))<minOf(id))missed.push(id+'@'+w);}));
  eq(name+' ('+total+' min a week): no weekly minimum missed from week two on'+(missed.length?' - missed '+missed.join(' '):''), missed, []);
  eq(name+': no rule broken', breakCount(g), 0);
});

console.log('the same plan with the lookahead switched off misses minimums (so the test above means something):');
reset(MON); ctx.areaData.rules.recommender.lookaheadFloor=1; ctx.forecastMemo={key:'',value:null};
const off=ctx.weekForecast(MON,[]);
const missedOff=[];[0,1,2,3,4].forEach(w=>IDS.forEach(id=>{if(countIn(off,id,ctx.addDays(MON,7*w))<minOf(id))missedOff.push(id+'@'+w);}));
ok('with the floor at 1 (only exact ties may be re-ordered) something is missed', missedOff.length>0);
loadAreas(); ctx.forecastMemo={key:'',value:null};

console.log('weekShortfall: what the rest of the week would cost, as plain numbers:');
const area=(id,o)=>Object.assign({id,name:id,priority:1,minutes:20,load:'low',per:{min:1,target:1,max:3},gap:1,days:[],held:null,hold:null,excluded:null,heldOn:{}},o||{});
const mk=(areas,future,o)=>Object.assign({date:'2026-10-07',slots:[45],already:[],future:future,areas:areas,conflicts:[],budgets:[],limits:{maxAreas:4,maxHigh:2},weights:{}},o||{});
const fut=(n,m)=>Array.from({length:n},(_,i)=>({date:ctx.addDays('2026-10-07',i+1),minutes:m}));
eq('on the last day of the week there is nothing to plan around', ctx.weekShortfall(mk([area('a')],[]),[]), 0);
eq('an area that can still be done later costs nothing', ctx.weekShortfall(mk([area('a')],fut(3,45)),[]), 0);
eq('one that has no room left costs its priority weight (here 1 session x (1+1-1) = 1)', ctx.weekShortfall(mk([area('a',{minutes:50})],fut(3,45)),[]), 1);
eq('doing it today removes the cost', ctx.weekShortfall(mk([area('a',{minutes:50})],fut(3,45)),['a']), 0);
eq('an area already done today needs no more', ctx.weekShortfall(mk([area('a',{days:['2026-10-07']})],fut(2,45)),[]), 0);
eq('spacing counts: needing 2 sessions 3 days apart with 3 days left cannot fit, but doing one today can', [ctx.weekShortfall(mk([area('a',{per:{min:2,target:2,max:3},gap:3})],fut(3,45)),[])>0,ctx.weekShortfall(mk([area('a',{per:{min:2,target:2,max:3},gap:3})],fut(3,45)),['a'])],[true,0]);
eq('a day an area is held is not available to it', ctx.weekShortfall(mk([area('a',{heldOn:{[ctx.addDays('2026-10-07',1)]:true,[ctx.addDays('2026-10-07',2)]:true,[ctx.addDays('2026-10-07',3)]:true}})],fut(3,45)),[])>0, true);
eq('held on the middle day of three: needing two sessions, only the first and last are left, so it must be done today', (()=>{const D3=[ctx.addDays('2026-10-07',1),ctx.addDays('2026-10-07',2)];
  const held=area('a',{per:{min:2,target:2,max:3},gap:1,heldOn:{[D3[0]]:true}}), free=area('a',{per:{min:2,target:2,max:3},gap:1});
  return [ctx.weekShortfall(mk([held],fut(2,45)),[])>0, ctx.weekShortfall(mk([held],fut(2,45)),['a']), ctx.weekShortfall(mk([free],fut(2,45)),[])];})(), [true,0,0]);
eq('the minutes of each day count: two 30-minute areas into 40-minute days fit one a day', ctx.weekShortfall(mk([area('a',{minutes:30,priority:1}),area('b',{minutes:30,priority:2})],fut(2,40)),[]), 0);
eq('but not two a day: three 30-minute areas into two 40-minute days leaves one over', ctx.weekShortfall(mk([area('a',{minutes:30}),area('b',{minutes:30}),area('c',{minutes:30})],fut(2,40)),[])>0, true);
eq('a hard conflict keeps two areas off the same day (and a soft one does not)', [
  ctx.weekShortfall(mk([area('a',{minutes:10}),area('b',{minutes:10})],fut(1,45),{conflicts:[{areas:['a','b'],why:'x'}]}),[])>0,
  ctx.weekShortfall(mk([area('a',{minutes:10}),area('b',{minutes:10})],fut(1,45),{conflicts:[{areas:['a','b'],soft:true,why:'x'}]}),[])],[true,0]);
eq('a higher priority missed costs more than a lower one', ctx.weekShortfall(mk([area('hi',{minutes:50,priority:1}),area('lo',{minutes:50,priority:5})],fut(3,45)),[])>0&&ctx.weekShortfall(mk([area('hi',{minutes:50,priority:1}),area('lo',{minutes:50,priority:5})],fut(3,45)),['hi'])<ctx.weekShortfall(mk([area('hi',{minutes:50,priority:1}),area('lo',{minutes:50,priority:5})],fut(3,45)),['lo']), true);
eq('a missed target costs a quarter of a missed minimum', [ctx.weekShortfall(mk([area('a',{minutes:50,per:{min:1,target:1,max:3}})],fut(3,45)),[]),ctx.weekShortfall(mk([area('a',{minutes:50,per:{min:0,target:1,max:3}})],fut(3,45)),[])], [1,0.25]);

console.log('the red light this week, as on your screen:');
reset(MON); ctx.checkIns=[ci(FRI,{hamstring:8})]; ctx.dayPlans[MON]={sittings:[{minutes:45,areas:['hspu','pistol']}],suggested:['hspu','pistol'],removed:{},why:{}};
['hspu','pistol'].forEach(id=>ctx.freezeAreaDay(MON,id));
f=ctx.weekForecast(MON,[]);
eq('Nordic and the kettlebell first appear the day the hold ends', ['nordic','kb'].map(id=>allDates(f).find(d=>f[d].picks.includes(id))), ['2026-10-10','2026-10-10']);
eq('Nordic cannot reach its minimum of two this week (only Saturday and Sunday are left, and it needs two days between)', countIn(f,'nordic',MON), 1);
eq('everything else does', IDS.filter(id=>id!=='nordic'&&countIn(f,id,MON)<minOf(id)), []);
ctx.liftAllReds(MON); ctx.forecastMemo={key:'',value:null};
f=ctx.weekForecast(MON,[]);
eq('lifted: Nordic and the kettlebell both reach their minimum this week', ['nordic','kb'].map(id=>countIn(f,id,MON)>=minOf(id)), [true,true]);
eq('and no area is short', IDS.filter(id=>countIn(f,id,MON)<minOf(id)), []);

console.log('the recommender hands the lookahead the days a red light holds:');
reset(MON); ctx.checkIns=[ci(MON,{hamstring:8})];
const inp=ctx.recommendInput(MON,[45],[]);
const nord=inp.areas.find(a=>a.id==='nordic');
eq('Nordic is held for the six days after today (seven in all, from the check-in), and not after', [Object.keys(nord.heldOn).length,nord.heldOn[ctx.addDays(MON,6)],nord.heldOn[ctx.addDays(MON,7)]], [6,true,undefined]);
eq('an area no red light guards is never held', Object.keys(inp.areas.find(a=>a.id==='mu').heldOn), []);
eq('the days still to come are handed over, with each day\u2019s minutes', [inp.future.length,inp.future[0],inp.future[5]], [6,{date:ctx.addDays(MON,1),minutes:45},{date:ctx.addDays(MON,6),minutes:60}]);
eq('on a Sunday there are none', ctx.recommendInput('2026-10-11',[60],[]).future, []);
reset(MON); ctx.dayPlans['2026-10-08']={sittings:[{minutes:70,areas:['mu']}],suggested:['mu'],removed:{},why:{}};
eq('a day that already has a menu is planned around at the minutes of that menu', ctx.recommendInput(MON,[45],[]).future[2], {date:'2026-10-08',minutes:70});

console.log('the forecast is remembered until something changes:');
reset(MON); ctx.checkIns=[ci(FRI,{hamstring:8})];
const a1=ctx.weekForecast(MON,[]), a2=ctx.weekForecast(MON,[]);
ok('asking twice with nothing changed gives the same answer, without working it out again', a1===a2);
ctx.liftRed('hamstring',MON);
const a3=ctx.weekForecast(MON,[]);
ok('lifting a red changes it', a3!==a1&&allDates(a3).find(d=>a3[d].picks.includes('nordic'))<'2026-10-10');
const dayRows=[{date:MON,area:'mu',done:5,total:5,full:true}];
ok('a day logged changes it', ctx.weekForecast(MON,dayRows)!==a3);
ctx.checkIns=[ci(FRI,{hamstring:8}),ci(MON,{hamstring:0})];
const a4=ctx.weekForecast(MON,[]);
ok('a new check-in changes it', a4!==a3);
ctx.settings.weekdayMinutes={0:90,1:90,2:90,3:90,4:90,5:90,6:90};
const a5=ctx.weekForecast(MON,[]);
ok('different minutes change it', a5!==a4&&a5[MON].minutes===90);
ctx.dayPlans['2026-10-08']={sittings:[{minutes:45,areas:['mu']}],suggested:['mu'],removed:{},why:{}};
ok('a menu made for a day changes it', ctx.weekForecast(MON,[])!==a5);
ctx.todayISO=()=>'2026-10-06';
ok('and so does the date', ctx.weekForecast('2026-10-06',[])!==a5&&allDates(ctx.weekForecast('2026-10-06',[]))[0]==='2026-10-06');
eq('it never writes anything: forecasting 35 days changes no stored data', (()=>{reset(MON);ctx.ensureWeekFit(MON,[]);const s0=JSON.stringify([ctx.dayPlans,ctx.frozenDays,ctx.weekFits,ctx.settings,store]);ctx.weekForecast(MON,[]);return JSON.stringify([ctx.dayPlans,ctx.frozenDays,ctx.weekFits,ctx.settings,store])===s0;})(), true);
reset(MON); const t0=Date.now(); ctx.weekForecast(MON,[]); const cold=Date.now()-t0; const t1=Date.now(); for(let i=0;i<50;i++) ctx.weekForecast(MON,[]); const warm=(Date.now()-t1)/50;
ok('worked out cold in '+cold+' ms, and repeated taps cost '+warm.toFixed(2)+' ms each', cold<2000&&warm<20);

console.log('the screens:');
const made=[]; const origEl=ctx.el, origSvg=ctx.svgEl;
ctx.el=function(tag,attrs,kids){const n=origEl(tag,attrs,kids);made.push({tag,attrs:attrs||{},kids,n});return n;};
ctx.svgEl=function(tag,attrs,kids){return origSvg(tag,attrs,kids);};
ctx.toast=()=>{};
const texts=()=>made.map(m=>m.attrs.text).filter(Boolean);
const btn=(label,i)=>made.filter(m=>m.tag==='button'&&(m.attrs.text===label||m.attrs['aria-label']===label))[i||0];
const clear=()=>{made.length=0;};
const cellLabels=()=>made.filter(m=>m.attrs.class&&/wk-cell/.test(m.attrs.class)).map(m=>m.attrs['aria-label']);

reset(MON); ctx.areasView={week:null,day:null}; clear(); ctx.renderAreas();
ok('this week’s card has a next-week button, and it is enabled', !!btn('Next week')&&!btn('Next week').attrs.disabled);
ok('it says This week', texts().includes('This week'));
const nextWeek=ctx.addDays(MON,7);
ctx.areasView={week:nextWeek,day:null}; clear(); ctx.renderAreas();
ok('next week says so', texts().includes('Next week'));
ok('and has a previous-week button and a next one', !!btn('Previous week')&&!!btn('Next week'));
ok('its days are the week after', texts().includes('12 Oct – 18 Oct')||texts().some(x=>/12 Oct/.test(x)));
const sug=cellLabels().filter(l=>/suggested$/.test(l));
ok('it shows suggestions for the days (more than a dozen area-days)', sug.length>=12);
ok('and none of its days is a past or done one', cellLabels().every(l=>!/done$|skipped$/.test(l)));
ok('the label under each area counts what is suggested, not "0/2"', texts().some(x=>/ suggested$/.test(x))&&!texts().some(x=>/ · 0\/\d/.test(x)));
ok('the week says how many area-days are suggested instead of the done and skipped counts', texts().some(x=>/^\d+ area-days suggested$/.test(x))&&!texts().some(x=>/^Done \d+ · Partial/.test(x)));
ok('and no fit block for a week that has not started', !texts().some(x=>/Your minimums need/.test(x)));
const lastStart=ctx.addDays(MON,7*ctx.FORECAST_WEEKS);
ctx.areasView={week:lastStart,day:null}; clear(); ctx.renderAreas();
ok('the last week ahead has a disabled next button', !!btn('Next week')&&!!btn('Next week').attrs.disabled);
ok('and says Week of its Monday', texts().includes('Week of '+ctx.fmtDateShort(lastStart)));
ctx.areasView={week:ctx.addDays(lastStart,21),day:null}; clear();
ok('asking for a week further than that lands on the last one', (()=>{ctx.renderAreas();return ctx.areasView.week===lastStart;})());
ctx.areasView={week:ctx.addDays(MON,-7),day:null}; clear();
ok('last week has no forecast (no suggested rings)', (()=>{ctx.renderAreas();return cellLabels().every(l=>!/suggested$/.test(l));})());

console.log('a tap on a day in a later week:');
reset(MON); ctx.areasView={week:nextWeek,day:ctx.addDays(nextWeek,2)}; clear(); ctx.renderAreas();
ok('shows what is suggested for it, with reasons, and what is left out', texts().some(x=>/^Suggested · \d+ min$/.test(x))&&texts().includes('Left out'));

console.log('a week that cannot reach an area’s minimum says so:');
reset(MON); ctx.checkIns=[ci(FRI,{hamstring:8})]; ctx.dayPlans[MON]={sittings:[{minutes:45,areas:['hspu','pistol']}],suggested:['hspu','pistol'],removed:{},why:{}};
['hspu','pistol'].forEach(id=>ctx.freezeAreaDay(MON,id));
ctx.areasView={week:null,day:null}; clear(); ctx.renderAreas();
const shorts=texts().filter(x=>/^Short · /.test(x));
eq('Nordic is the only one short this week: one day suggested, two needed', shorts, ['Short · 1 of 2 days']);
ctx.liftAllReds(MON); clear(); ctx.renderAreas();
ok('lifted, nothing is short', !texts().some(x=>/^Short · /.test(x)));
reset(MON); ctx.areasView={week:null,day:null}; clear(); ctx.renderAreas();
ok('with no red light nothing is short either', !texts().some(x=>/^Short · /.test(x)));

console.log('a real menu that a red light now holds does not count as reachable:');
const WED='2026-10-07', WEDMENU={sittings:[{minutes:45,areas:['oap']}],suggested:['oap'],removed:{},why:{}};
const withWed=()=>{reset(MON); ctx.dayPlans[WED]=JSON.parse(JSON.stringify(WEDMENU)); ctx.freezeAreaDay(WED,'oap');};
const oapArea=ctx.areaById('oap');
const reach=()=>ctx.forecastReach(ctx.weekForecast(MON,[]),oapArea,MON,[]);
withWed();
const free=reach();
ok('no red light: Wednesday’s menu counts, so the one-arm pull-up is reachable', free>=1&&ctx.weekForecast(MON,[])[WED].picks.includes('oap'));
ctx.areasView={week:null,day:null}; clear(); ctx.renderAreas();
ok('and it is not short', !texts().some(x=>/^Short · 0 of 1 days$/.test(x)));
withWed(); ctx.checkIns=[ci(MON,{elbow:8})];
eq('a red elbow today holds it all week, Wednesday included', [ctx.heldReason(oapArea,WED),ctx.heldReason(oapArea,ctx.addDays(MON,6))], ['medial elbow red','medial elbow red']);
const heldFc=ctx.weekForecast(MON,[]);
ok('the menu still lists it: it is yours, the forecast does not rewrite it', heldFc[WED].real&&heldFc[WED].picks.includes('oap'));
eq('but a held pick is not a day it can be trained', ctx.forecastReach(heldFc,oapArea,MON,[]), 0);
ctx.areasView={week:null,day:null}; clear(); ctx.renderAreas();
ok('so the row says Short · 0 of 1 days', texts().some(x=>/^Short · 0 of 1 days$/.test(x)));
ctx.liftAllReds(MON); clear(); ctx.renderAreas();
eq('lifted, the same menu counts again, as before', reach(), free);
ok('and the row is no longer short', !texts().some(x=>/^Short · 0 of 1 days$/.test(x)));
withWed(); ctx.checkIns=[ci(MON,{elbow:8})]; ctx.dayPlans[MON]={sittings:[{minutes:45,areas:['hspu']}],suggested:['hspu'],removed:{},why:{}};
ok('a held pick on a real day is the only kind skipped: one that is not held still counts', ctx.forecastReach(ctx.weekForecast(MON,[]),ctx.areaById('hspu'),MON,[])>=1);

console.log('the red light comes first when it is delaying things:');
reset(MON); ctx.checkIns=[ci(FRI,{hamstring:8})]; ctx.areasView={week:null,day:null}; clear(); ctx.renderAreas();
const iRed=texts().indexOf('Red lights'), iWeek=texts().indexOf('This week');
ok('the Red lights card is above the week', iRed>=0&&iWeek>=0&&iRed<iWeek);
reset(MON); ctx.areasView={week:null,day:null}; clear(); ctx.renderAreas();
ok('and there is no card when nothing is held', !texts().includes('Red lights'));

console.log('everything still draws:');
ctx.el=origEl; ctx.svgEl=origSvg;
const draws=fn=>{try{fn();return true;}catch(e){console.log('   ',e.message);return false;}};
reset(MON); ctx.checkIns=[ci(FRI,{hamstring:8})];
ok('Today, Areas, Progress and the check-in, with a red light and the forecast', draws(()=>{ctx.areasView={week:null,day:null};ctx.renderToday();ctx.renderAreas();ctx.renderProgress();ctx.renderCheckIn();}));
ok('and each week ahead', [1,2,3,4].every(w=>draws(()=>{ctx.areasView={week:ctx.addDays(MON,7*w),day:null};ctx.renderAreas();})));

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
