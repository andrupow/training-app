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
const clone=o=>JSON.parse(JSON.stringify(o));
ctx.areaData={rules:read('data/rules.json'),legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};
const pinWeeks=()=>{const t={};ctx.areaList().forEach(a=>{t[a.id]=ctx.stageWeek(a,ctx.currentStage(a)).target;});ctx.weekFits={};
  for(let d='2026-08-31',i=0;i<30;i++,d=ctx.addDays(d,7))ctx.weekFits[d]={budget:999,cost:0,minCost:0,startCost:0,verdict:'fits',targets:Object.assign({},t),trimmed:[],ramp:[]};};
const REAL={0:45,1:45,2:30,3:45,4:45,5:60,6:60};
const reset=(today)=>{pinWeeks();ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.checkIns=[];ctx.schedule={};ctx.settings={weekdayMinutes:Object.assign({},REAL)};ctx.forecastMemo={key:'',value:null};
  ['dayPlans','areaDays','settings','checkIns','frozenDays'].forEach(k=>delete store[k]);ctx.todayISO=()=>today;};
const BODY=['elbow','shoulder','wrist','lowerBack','knee','achilles','hamstring'];
const ci=(date,pain,stiff)=>({date,pain:Object.assign({},...BODY.map(b=>({[b]:0})),pain||{}),stiffness:stiff||'none'});
const MON='2026-10-05', TUE='2026-10-06', WED='2026-10-07', THU='2026-10-08', FRI='2026-10-09', SAT='2026-10-10', SUN='2026-10-11';
const IDS=['mu','hspu','bridge','pistol','nordic','kb','oap','plyo'];
const fc=()=>ctx.weekForecast(ctx.todayISO(),[]);
const stored=()=>JSON.parse(store.settings||'{}').planEdits;
const toggle=(date,id)=>ctx.togglePlanArea(date,id,[]);

console.log('what can be changed:');
reset(MON);
eq('the days after today, as far as the forecast reaches', [MON,TUE,'2026-11-08','2026-11-09','2026-10-04'].map(d=>ctx.planEditable(d,MON)), [false,true,true,false,false]);
eq('with nothing stored a day has no edits', ctx.planEditsFor(WED), {add:[],remove:[]});
ctx.settings.planEdits={[WED]:{add:['oap','ghost','oap',7],remove:['oap','kb',5,null]}};
eq('junk is cleaned: unknown areas, repeats, numbers, and an area cannot be both added and taken off', ctx.planEditsFor(WED), {add:['oap'],remove:['kb']});
ctx.settings.planEdits=[WED]; eq('a list is ignored', ctx.planEditsFor(WED), {add:[],remove:[]});
ctx.settings.planEdits='x'; eq('and a word', ctx.planEditsFor(WED), {add:[],remove:[]});
ctx.settings.planEdits={[WED]:'oap'}; eq('and a day that is not an object', ctx.planEditsFor(WED), {add:[],remove:[]});
ctx.settings.planEdits={[WED]:{add:'oap',remove:{}}}; eq('and lists that are not lists', ctx.planEditsFor(WED), {add:[],remove:[]});

console.log('refusals:');
reset(MON);
eq('today is not changed from here', [toggle(MON,'oap').ok,/Today tab/.test(toggle(MON,'oap').why)], [false,true]);
eq('nor a day that has passed', toggle('2026-10-03','oap').ok, false);
eq('nor one further ahead than the plan goes', [toggle('2026-11-09','oap').ok,/further ahead/.test(toggle('2026-11-09','oap').why)], [false,true]);
eq('an area that is not there', toggle(WED,'ghost'), {ok:false,why:'No such area.'});
ok('and none of that stored anything', stored()===undefined);
reset(MON); ctx.checkIns=[ci(MON,{hamstring:8})];
let r=toggle(WED,'nordic');
eq('an area a red light holds cannot be added', [r.ok,/is held: hamstring red/.test(r.why)], [false,true]);
ok('and nothing was stored', stored()===undefined);

console.log('adding an area to a day ahead:');
reset(MON); const f0=clone(fc());
const absent=IDS.find(id=>!f0[WED].picks.includes(id)&&!ctx.heldReason(ctx.areaById(id),WED));
ok('there is something to add on Wednesday', !!absent);
r=toggle(WED,absent);
eq('it says it was added', [r.ok,r.change], [true,'added']);
eq('and keeps it as an edit for the day', stored()[WED], {add:[absent],remove:[]});
ok('on the device, so it survives a reload', JSON.parse(store.settings).planEdits[WED].add[0]===absent);
let f1=fc();
ok('the day now has it', f1[WED].picks.includes(absent));
eq('and says it is yours', [f1[WED].manual.added,f1[WED].manual.removed], [[absent],[]]);
ok('with a reason that says so', /^Added by you\./.test(f1[WED].why[absent]));
ok('it is not in the list of what was left out', !f1[WED].left.some(l=>l.id===absent));
ok('the other days say nothing is changed', Object.keys(f1).filter(d=>d!==WED).every(d=>f1[d].manual.added.length===0&&f1[d].manual.removed.length===0));
r=toggle(WED,absent);
eq('a second tap undoes it', [r.ok,r.change], [true,'reverted']);
ok('and leaves nothing behind', stored()===undefined&&!('planEdits' in ctx.settings));
eq('so the forecast is exactly what it was', JSON.stringify(fc()), JSON.stringify(f0));

console.log('taking an area off a day ahead:');
reset(MON);
const dayOff=THU, gone=f0[dayOff].picks[0];
r=toggle(dayOff,gone);
eq('it says it was taken out', [r.ok,r.change], [true,'removed']);
eq('and keeps it as an edit', stored()[dayOff], {add:[],remove:[gone]});
f1=fc();
ok('the day no longer has it', !f1[dayOff].picks.includes(gone));
eq('and says you took it out', [f1[dayOff].manual.removed,f1[dayOff].manual.added], [[gone],[]]);
eq('it is listed under what was left out, as yours', f1[dayOff].left.filter(l=>l.id===gone), [{id:gone,kind:'removed',why:'Taken out by you.'}]);
ok('the rest of the day is still planned', f1[dayOff].picks.length>=f0[dayOff].picks.length-1);
r=toggle(dayOff,gone);
eq('a second tap puts it back', [r.ok,r.change], [true,'restored']);
eq('and the forecast is what it was', JSON.stringify(fc()), JSON.stringify(f0));
ok('nothing is left stored', stored()===undefined);

console.log('taking things off and adding them, everywhere in the week:');
reset(MON); const base=clone(fc());
let badOff=[], badOn=[], badBack=[], n=0;
[TUE,WED,THU,FRI,SAT,SUN].forEach(d=>{
  base[d].picks.forEach(id=>{
    n++; reset(MON); toggle(d,id); const f=fc();
    if(f[d].picks.includes(id)||!f[d].manual.removed.includes(id)||!f[d].left.some(l=>l.id===id&&l.kind==='removed')) badOff.push(d+' '+id);
    if(Object.keys(f).some(x=>x!==d&&(f[x].manual.removed.length||f[x].manual.added.length))) badOff.push('other day marked after '+d+' '+id);
    toggle(d,id); if(JSON.stringify(fc())!==JSON.stringify(base)) badBack.push(d+' '+id);
  });
});
ok('we went through '+n+' suggestions: each can be taken off', n>=10);
eq('every take-off leaves the area off that day and marked as yours, whatever it moves on the other days', badOff, []);
[WED,FRI,SUN].forEach(d=>{
  IDS.filter(id=>!base[d].picks.includes(id)&&!ctx.heldReason(ctx.areaById(id),d)).forEach(id=>{
    reset(MON); toggle(d,id); const f=fc();
    if(!f[d].picks.includes(id)||!f[d].manual.added.includes(id)) badOn.push(d+' '+id);
    toggle(d,id); if(JSON.stringify(fc())!==JSON.stringify(base)) badBack.push(d+' '+id+' (added)');
  });
});
eq('every add puts the area on that day, marked as yours', badOn, []);
eq('and every tap, then the same tap again, leaves the forecast exactly as it was', badBack, []);

console.log('a take-off stays one when moving the area’s sessions makes the day too soon for it anyway:');
reset(MON); const sunBase=clone(fc());
ok('this setup has Muscle-up on Sunday, and not on Saturday', sunBase[SUN].picks.includes('mu')&&!sunBase[SAT].picks.includes('mu'));
toggle(SUN,'mu'); f1=fc();
eq('taking Muscle-up off Sunday: it is off, and marked as taken out', [f1[SUN].picks.includes('mu'),f1[SUN].manual.removed.includes('mu')], [false,true]);
ok('its session moved to Saturday, inside its spacing of Sunday: Sunday would be "too soon" for it without the take-off', f1[SAT].picks.includes('mu'));
ok('and Sunday still says it was taken out by you, not "too soon"', f1[SUN].left.some(l=>l.id==='mu'&&l.kind==='removed'&&l.why==='Taken out by you.'));
eq('only that day is marked', Object.keys(f1).filter(d=>f1[d].manual.removed.length||f1[d].manual.added.length), [SUN]);
toggle(SUN,'mu');
eq('putting it back restores the forecast, Saturday included', JSON.stringify(fc()), JSON.stringify(sunBase));

console.log('a take-off that no longer changes anything:');
reset(MON);
const idle=IDS.find(id=>!f0[THU].picks.includes(id)&&!ctx.heldReason(ctx.areaById(id),THU));
ctx.settings.planEdits={[THU]:{add:[],remove:[idle]}};
f1=fc();
eq('the day would not have had it, so nothing is marked', f1[THU].manual.removed, []);
ok('and its reason is the real one, not "taken out by you"', f1[THU].left.filter(l=>l.id===idle).every(l=>l.kind!=='removed'&&!/Taken out/.test(l.why)));
ok('the forecast is unchanged by it', JSON.stringify(f1[THU].picks)===JSON.stringify(f0[THU].picks));
r=toggle(THU,idle);
eq('a tap on it adds it, rather than "restoring" nothing', [r.ok,r.change], [true,'added']);
ok('and it is on the day', fc()[THU].picks.includes(idle));
ok('and the stale take-off is gone', stored()[THU].remove.length===0&&stored()[THU].add[0]===idle);

console.log('a red light still holds what you added:');
reset(MON);
r=toggle(SAT,'nordic');
eq('added on a free day', [r.ok,r.change], [true,'added']);
ctx.checkIns=[ci(MON,{hamstring:8})];
f1=fc();
ok('a red check-in later holds it: it is not on the day', !f1[SAT].picks.includes('nordic'));
eq('and is not counted as yours', f1[SAT].manual.added.includes('nordic'), false);
ok('the day says it is held', f1[SAT].left.some(l=>l.id==='nordic'&&l.kind==='held'));
eq('it cannot be tapped back on', toggle(SAT,'nordic').ok, false);
ctx.liftAllReds(MON);
ok('lift the red and what you added is there again', fc()[SAT].picks.includes('nordic'));

console.log('the rest of the plan works around it:');
reset(MON);
const spaced=(f,id,fixed,gap)=>Object.keys(f).every(d=>d===fixed||!f[d].picks.includes(id)||Math.abs(ctx.daysBetween(fixed,d))>=gap);
const oapGap=ctx.stageGap(ctx.areaById('oap'),ctx.currentStage(ctx.areaById('oap')));
ok('one-arm pull-up wants days between sessions', oapGap>=2);
toggle(SAT,'oap');
f1=fc();
ok('added on Saturday, it is not suggested inside its spacing on the days before or after', spaced(f1,'oap',SAT,oapGap));
reset(MON); toggle(THU,'oap'); f1=fc();
ok('the same on Thursday', spaced(f1,'oap',THU,oapGap));
reset(MON);
ctx.dayPlans[THU]={sittings:[{minutes:45,areas:['oap']}],suggested:['oap'],removed:{},why:{}}; ctx.freezeAreaDay(THU,'oap');
f1=fc();
ok('a real menu on Thursday with it does the same, which it did not before', spaced(f1,'oap',THU,oapGap));
reset(MON); toggle(THU,'oap');
eq('the recommender is told: an area too close to a settled day is excluded, with the reason', ctx.recommendInput(TUE,[45],[]).areas.filter(a=>a.id==='oap').map(a=>/^Too close to its session on /.test(a.excluded||'')), [true]);
eq('and Monday is far enough from Thursday only if the spacing allows it', ctx.recommendInput(MON,[45],[]).areas.filter(a=>a.id==='oap').map(a=>!!a.excluded), [oapGap>3]);

console.log('the lookahead plans around what is settled:');
const area=(id,o)=>Object.assign({id,name:id,priority:1,minutes:20,load:'low',per:{min:1,target:1,max:3},gap:1,days:[],held:null,hold:null,excluded:null,heldOn:{}},o||{});
const mk=(areas,future,o)=>Object.assign({date:'2026-10-07',slots:[45],already:[],future:future,areas:areas,conflicts:[],budgets:[],limits:{maxAreas:4,maxHigh:2},weights:{}},o||{});
const fut=(n,m,x)=>Array.from({length:n},(_,i)=>Object.assign({date:ctx.addDays('2026-10-07',i+1),minutes:m},x&&x[i]||{}));
eq('an area that needs a session and has a day to take it costs nothing', ctx.weekShortfall(mk([area('a')],fut(2,45)),[]), 0);
ok('but not if every day left says you took it off', ctx.weekShortfall(mk([area('a')],fut(2,45,[{remove:['a']},{remove:['a']}])),[])>0);
eq('taking it off one of two days leaves the other', ctx.weekShortfall(mk([area('a')],fut(2,45,[{remove:['a']}])),[]), 0);
eq('a day you put it on counts as its session', ctx.weekShortfall(mk([area('a',{minutes:50})],fut(2,60,[{add:['a']}])),[]), 0);
ok('and takes the room: a second area that needs 30 minutes does not fit the same 40-minute day', ctx.weekShortfall(mk([area('a',{minutes:30}),area('b',{minutes:30})],fut(1,40,[{add:['a']}])),[])>0);
eq('a day that has a menu holds what is on it', ctx.weekShortfall(mk([area('a',{minutes:50})],fut(1,60,[{fixed:true,add:['a']}])),[]), 0);
ok('and nothing else: an empty settled day cannot take the session', ctx.weekShortfall(mk([area('a')],fut(1,45,[{fixed:true,add:[]}])),[])>0);
ok('a held area on a settled day is not trained there', ctx.weekShortfall(mk([area('a',{heldOn:{[ctx.addDays('2026-10-07',1)]:true}})],fut(1,45,[{fixed:true,add:['a']}])),[])>0);
eq('the recommender hands the lookahead the edits for the days ahead', (()=>{reset(MON);const base=clone(fc());const a=IDS.find(id=>!base[WED].picks.includes(id)&&!ctx.heldReason(ctx.areaById(id),WED));toggle(WED,a);const b=fc()[THU].picks.find(id=>id!==a);toggle(THU,b);
  const fut=ctx.recommendInput(MON,[45],[]).future;
  return [fut[1].add[0]===a,fut[1].remove===undefined,fut[2].remove[0]===b,fut[2].add===undefined];})(), [true,true,true,true]);

console.log('the recommender, asked about a day with edits:');
reset(MON);
let inp=ctx.recommendInput(WED,[45],[],{add:['oap']});
eq('what you add is on the menu, so it takes its room and is not offered again', [inp.already.includes('oap'),inp.areas.find(a=>a.id==='oap').excluded], [true,'Already on today’s menu.']);
inp=ctx.recommendInput(WED,[45],[],{remove:['kb']});
eq('what you took off is excluded, with that reason', inp.areas.find(a=>a.id==='kb').excluded, 'Taken out by you.');
ctx.checkIns=[ci(MON,{hamstring:8})];
ok('a held area you add takes up no room', !ctx.recommendInput(WED,[45],[],{add:['nordic']}).already.includes('nordic'));
reset(MON);
let w=ctx.recommendWithEdits(WED,30,[],{add:[],remove:[]});
eq('with no edits it is the plain recommendation', [w.added,w.removed,w.picks], [[],[],ctx.recommendFor(WED,[30],[]).picked]);
w=ctx.recommendWithEdits(WED,30,[],{add:['oap'],remove:[]});
ok('with an add, it is first among the picks and the rest are worked out around it', w.picks.includes('oap')&&w.added[0]==='oap'&&!w.rec.picked.includes('oap'));
const first=ctx.recommendFor(WED,[30],[]).picked[0];
w=ctx.recommendWithEdits(WED,30,[],{add:[],remove:[first]});
eq('a take-off of what would have been picked takes effect, and that time goes to something else', [w.removed,w.picks.includes(first)], [[first],false]);
w=ctx.recommendWithEdits(WED,30,[],{add:[],remove:[IDS.find(id=>!ctx.recommendFor(WED,[30],[]).picked.includes(id))]});
eq('a take-off of what would not have been picked is not one', w.removed, []);

console.log('a day that already has a menu is changed in the menu:');
reset(MON);
ctx.dayPlans[THU]={sittings:[{minutes:45,areas:['hspu','nordic']}],suggested:['hspu','nordic'],removed:{},why:{}};
['hspu','nordic'].forEach(id=>ctx.freezeAreaDay(THU,id));
r=toggle(THU,'oap');
eq('an area is added to the menu', [r.ok,r.change,ctx.dayPlans[THU].sittings[0].areas.includes('oap')], [true,'added',true]);
ok('and is not part of what was suggested, so it reads as yours', !ctx.dayPlans[THU].suggested.includes('oap'));
ok('nothing is stored as an edit', stored()===undefined);
f1=fc();
eq('the forecast marks it as added', [f1[THU].real,f1[THU].manual.added], [true,['oap']]);
r=toggle(THU,'hspu');
eq('a suggested one is taken off', [r.ok,r.change,ctx.dayPlans[THU].sittings[0].areas.includes('hspu'),ctx.dayPlans[THU].removed.hspu], [true,'removed',false,'']);
eq('the forecast marks it as taken out', fc()[THU].manual.removed, ['hspu']);
r=toggle(THU,'hspu');
eq('and putting it back is a restore', [r.ok,r.change,ctx.dayPlans[THU].sittings[0].areas.includes('hspu'),'hspu' in ctx.dayPlans[THU].removed], [true,'restored',true,false]);
r=toggle(THU,'oap');
eq('taking off what you added just undoes it', [r.ok,r.change,ctx.dayPlans[THU].sittings[0].areas.includes('oap'),'oap' in ctx.dayPlans[THU].removed], [true,'reverted',false,false]);
ctx.checkIns=[ci(MON,{hamstring:8})]; ctx.dayPlans[THU].sittings[0].areas=['hspu'];
eq('a held area is refused on a menu too', toggle(THU,'kb').ok, false);

console.log('the menu is made from your edits:');
reset(MON);
toggle(TUE,'oap'); const f2=clone(fc()); const dropped=f2[TUE].picks.find(id=>id!=='oap'); toggle(TUE,dropped);
const monDone=f2[MON].picks.map(id=>({date:MON,area:id,done:1,total:1,full:true}));      /* Monday happened as the forecast assumed */
ctx.todayISO=()=>TUE; ctx.forecastMemo={key:'',value:null};
const plan=ctx.ensureDayPlan(TUE,monDone);
ok('the new menu has what you added', plan.sittings[0].areas.includes('oap'));
ok('and not what you took off', !plan.sittings[0].areas.includes(dropped));
ok('what you added is not "suggested", so it still reads as yours', !plan.suggested.includes('oap'));
eq('what you took off is a take-off on the menu, like any other', [dropped in plan.removed,plan.suggested.includes(dropped)], [true,true]);
ok('every area on it is frozen as an area-day, as a menu does', plan.sittings[0].areas.every(id=>ctx.freezeAreaDay(TUE,id)));
ok('the edits are used up: they live in the menu now', stored()===undefined||!(TUE in stored()));
f1=ctx.weekForecast(TUE,monDone);
eq('and the forecast, from the menu, still marks them', [f1[TUE].manual.added,f1[TUE].manual.removed], [['oap'],[dropped]]);
reset(MON); ctx.todayISO=()=>TUE;
const expected=ctx.recommendFor(TUE,[45],[]).picked;
eq('with no edits the menu is the same as ever', [ctx.ensureDayPlan(TUE,[]).sittings[0].areas,ctx.dayPlans[TUE].suggested,ctx.dayPlans[TUE].removed], [expected,expected,{}]);
reset(MON); toggle(TUE,'oap'); ctx.checkIns=[ci(MON,{elbow:8})]; ctx.todayISO=()=>TUE;
ok('an area a red light has since held is left off the new menu', !ctx.ensureDayPlan(TUE,[]).sittings[0].areas.includes('oap'));

console.log('housekeeping:');
reset(MON);
ctx.settings.planEdits={'2026-09-01':{add:['mu'],remove:[]},[FRI]:{add:['oap'],remove:[]}};
ctx.savePlanEdits(WED,{add:['kb'],remove:[]});
eq('days that have gone by are dropped when anything is saved', Object.keys(stored()).sort(), [WED,FRI]);
ctx.savePlanEdits(WED,{add:[],remove:[]}); ctx.savePlanEdits(FRI,{add:[],remove:[]});
ok('and when nothing is left the setting goes', !('planEdits' in ctx.settings));
reset(MON); toggle(THU,'oap');
eq('the edits are in the backup', ctx.exportPayload().settings.planEdits[THU], {add:['oap'],remove:[]});
eq('resetting a day says how many changes it forgot', [ctx.resetPlanEdits(THU),ctx.resetPlanEdits(THU),stored()], [1,0,undefined]);

console.log('the screens:');
const made=[], toasts=[]; const origEl=ctx.el, origSvg=ctx.svgEl;
ctx.el=function(tag,attrs,kids){const n=origEl(tag,attrs,kids);made.push({tag,attrs:attrs||{},kids,n});return n;};
ctx.toast=m=>toasts.push(m);
let repaints=0; ctx.repaintAreas=()=>{repaints++;};
const texts=()=>made.map(m=>m.attrs.text).filter(Boolean);
const labels=()=>made.reduce((a,m)=>a.concat((m.kids||[]).filter(k=>typeof k==='string')),[]);     /* the legend's words are plain text nodes */
const clear=()=>{made.length=0;toasts.length=0;repaints=0;};
const cellLabels=()=>made.filter(m=>/wk-cell/.test(m.attrs.class||'')).map(m=>m.attrs['aria-label']);
const cellFor=(area,date)=>made.find(m=>/wk-cell/.test(m.attrs.class||'')&&String(m.attrs['aria-label']).startsWith(area+', '+ctx.fmtDateShort(date)+':'));
const buttons=l=>made.filter(m=>m.tag==='button'&&(m.attrs.text===l));
const draw=(week,day)=>{ctx.areasView={week:week||null,day:day||null};clear();ctx.renderAreas();};

reset(MON); draw();
ok('with nothing changed there is no legend entry for it and no count of it', !labels().includes('Added by you')&&!labels().includes('Taken out')&&!texts().some(t=>/you added|took out/.test(t)));
const offer=cellFor('One-arm pull-up',THU);
ok('a day ahead’s cell says what a tap will do', /^Tap to (add|take)/.test(offer.attrs.title||''));
ok('today’s cell does not offer to change anything', !cellFor('One-arm pull-up',MON).attrs.title);
cellFor('One-arm pull-up',MON).n._h.click();
eq('a tap on today’s cell opens the day and changes nothing', [ctx.areasView.day,stored()], [MON,undefined]);
const wasOn=ctx.weekForecast(MON,[])[THU].picks.includes('oap');
toasts.length=0; repaints=0;
cellFor('One-arm pull-up',THU).n._h.click();
eq('a tap on a day ahead changes the plan', [wasOn?stored()[THU].remove:stored()[THU].add], [['oap']]);
eq('opens that day so the change can be read', ctx.areasView.day, THU);
ok('says what it did, in words', toasts.length===1&&/One-arm pull-up/.test(toasts[0])&&/8 Oct/.test(toasts[0]));
eq('and draws again', repaints, 1);

draw();
const mark=wasOn?'taken out by you':'added by you';
eq('the cell now says so, in its label', cellLabels().filter(l=>new RegExp(mark+'$').test(l)).length, 1);
ok('with a class of its own', made.some(m=>/ is-(added|removed)/.test(m.attrs.class||'')&&/wk-cell/.test(m.attrs.class)));
ok('and the legend explains it', labels().includes(wasOn?'Taken out':'Added by you'));
ok('and the week says how many', texts().some(t=>/ · you (added 1|took out 1)$/.test(t)));
ok('and nothing else on the grid is marked', cellLabels().filter(l=>/by you$/.test(l)).length===1);

draw(null,THU);
ok('the day below lists it', wasOn?texts().includes('Taken out by you'):texts().includes('Added by you'));
ok('and does not say "Added by you" twice', texts().filter(t=>/^Added by you\.?$/.test(t)).length<=1);
ok('with a button to undo this day', texts().includes('Undo my changes to this day'));
const undo=buttons('Undo my changes to this day')[0];
undo.n._h.click();
eq('which forgets the change', [stored(),toasts.length,repaints], [undefined,1,1]);

console.log('the day, with buttons:');
reset(MON); draw(null,THU);
const shown=ctx.weekForecast(MON,[])[THU];
eq('every suggestion has a Take out button', buttons('Take out').length, shown.picks.length);
ok('with a label that names the area and the day', buttons('Take out').every(b=>/ on /.test(b.attrs['aria-label'])&&/8 Oct/.test(b.attrs['aria-label'])));
const addable=shown.left.filter(l=>l.kind!=='held');
eq('every area left out, bar the held ones, has an Add button', buttons('Add').length, addable.length);
const addBtn=buttons('Add')[0]; const addId=addable[0].id;
addBtn.n._h.click();
eq('pressing it adds that area to the day', [stored()[THU].add,ctx.areasView.day], [[addId],THU]);
draw(null,THU);
ok('the day now lists it with Undo instead of Take out', buttons('Undo').length===1&&buttons('Take out').length===shown.picks.length);
const takeBtn=buttons('Take out')[0];
takeBtn.n._h.click();
ok('pressing Take out takes that one off', stored()[THU].remove.length===1);
draw(null,THU);
ok('it moves to "Taken out by you", with a Put back button', texts().includes('Taken out by you')&&buttons('Put back').length===1);
buttons('Put back')[0].n._h.click();
ok('which puts it back', stored()[THU].remove.length===0);
reset(MON); draw(null,MON);
ok('today’s detail has no buttons: today is the Today tab’s', buttons('Take out').length===0&&buttons('Add').length===0);
reset(MON); ctx.checkIns=[ci(MON,{hamstring:8})]; draw(null,THU);
ok('a held area offers the lift button, not Add', buttons('Add').every(b=>!/Nordic/.test(b.attrs['aria-label']))&&buttons('Lift hold').length>=1);

console.log('everything still draws:');
ctx.el=origEl; ctx.svgEl=origSvg;
const draws=fn=>{try{fn();return true;}catch(e){console.log('   ',e.message);return false;}};
reset(MON); toggle(WED,'oap'); toggle(THU,ctx.weekForecast(MON,[])[THU].picks[0]);
ok('the Areas tab, each week ahead, with edits', [0,1,2,3,4].every(k=>draws(()=>{ctx.areasView={week:ctx.addDays(MON,7*k),day:null};ctx.renderAreas();})));
ok('and each day of this week opened', [0,1,2,3,4,5,6].every(k=>draws(()=>{ctx.areasView={week:null,day:ctx.addDays(MON,k)};ctx.renderAreas();})));
ok('and Today, with a menu made from edits', draws(()=>{ctx.todayISO=()=>WED;ctx.renderToday();}));

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
