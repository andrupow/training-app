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
ctx.areaData={rules:read('data/rules.json'),legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};
const pinWeeks=()=>{const t={};ctx.areaList().forEach(a=>{t[a.id]=ctx.stageWeek(a,ctx.currentStage(a)).target;});ctx.weekFits={};
  for(let d='2026-08-31',i=0;i<30;i++,d=ctx.addDays(d,7))ctx.weekFits[d]={budget:999,cost:0,minCost:0,startCost:0,verdict:'fits',targets:Object.assign({},t),trimmed:[],ramp:[]};};
const MINUTES={0:45,1:45,2:45,3:45,4:45,5:45,6:45};
const reset=(today)=>{pinWeeks();ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.checkIns=[];ctx.schedule={};ctx.settings={weekdayMinutes:Object.assign({},MINUTES)};
  ['dayPlans','areaDays','settings','checkIns'].forEach(k=>delete store[k]);ctx.todayISO=()=>today;};
const BODY=['elbow','shoulder','wrist','lowerBack','knee','achilles','hamstring'];
const ci=(date,pain,stiff)=>({date,pain:Object.assign({},...BODY.map(b=>({[b]:0})),pain||{}),stiffness:stiff||'none'});
const put=(...c)=>{ctx.checkIns=c;ctx.checkIns.sort((a,b)=>a.date<b.date?-1:1);};
const THU='2026-10-02', FRI='2026-10-03', SAT='2026-10-04', MON='2026-10-05', TUE='2026-10-06';
const held=(id,date)=>ctx.heldReason(ctx.areaById(id),date);
const nordic='nordic';

console.log('a red, as it was before any of this:');
reset(MON); put(ci(FRI,{hamstring:8}));
eq('a red hamstring on Friday holds the hamstring until the seventh day', ctx.redHolds(MON), {hamstring:{from:FRI,until:'2026-10-09'}});
eq('redAreasOn still says the same thing as before: body -> last day', ctx.redAreasOn(MON), {hamstring:'2026-10-09'});
eq('Nordic and the kettlebell, which that body area guards, are held', [held(nordic,MON),held('kb',MON)], ['hamstring red','hamstring red']);
eq('what it does not guard is not', held('mu',MON), null);
eq('it is held on the last day and free the day after', [held(nordic,'2026-10-09'),held(nordic,'2026-10-10')], ['hamstring red',null]);
eq('and was not held before the check-in', held(nordic,THU), null);
put();
eq('with no check-ins there is nothing', ctx.redHolds(MON), {});

console.log('lifting it with a tap:');
reset(MON); put(ci(FRI,{hamstring:8}));
const before=JSON.stringify(ctx.checkIns);
eq('lifting the hamstring says it did', ctx.liftRed('hamstring',MON), true);
eq('the hold is gone from today', [ctx.redHolds(MON),held(nordic,MON),held('kb',MON)], [{},null,null]);
eq('and for the days ahead', [held(nordic,TUE),held(nordic,'2026-10-09')], [null,null]);
eq('but not for the days before the lift: history reads as it did', [held(nordic,FRI),held(nordic,SAT)], ['hamstring red','hamstring red']);
eq('the check-ins themselves are not touched', JSON.stringify(ctx.checkIns), before);
eq('what you chose is kept with your settings', JSON.parse(store.settings).redLifted, {hamstring:{date:MON,pain:0,stiff:'none'}});
ok('and so it is in the backup export', !!ctx.exportPayload().settings && ctx.exportPayload().settings.redLifted.hamstring.date===MON);
eq('lifting what nothing holds says no, and changes nothing', [ctx.liftRed('knee',MON),Object.keys(ctx.settings.redLifted)], [false,['hamstring']]);
eq('lifting twice says no the second time (nothing is left to lift)', ctx.liftRed('hamstring',MON), false);

console.log('a worse reading holds again:');
reset(MON); put(ci(FRI,{hamstring:8}));
ctx.liftRed('hamstring',MON);
put(ci(FRI,{hamstring:8}),ci(TUE,{hamstring:7}));
eq('a new red after the lift holds, from its own day', [held(nordic,TUE),ctx.redHolds(TUE).hamstring], ['hamstring red',{from:TUE,until:'2026-10-12'}]);
eq('and the old one stays lifted', ctx.redHolds(MON), {});
reset(MON); put(ci(MON,{hamstring:8}));
eq('a red logged today can be lifted today', [held(nordic,MON),ctx.liftRed('hamstring',MON),held(nordic,MON)], ['hamstring red',true,null]);
put(ci(MON,{hamstring:8}));
eq('the same reading logged again is still lifted', held(nordic,MON), null);
put(ci(MON,{hamstring:9}));
eq('a worse one the same day holds again', held(nordic,MON), 'hamstring red');
put(ci(MON,{hamstring:8},'over60'));
eq('and so does longer stiffness', held(nordic,MON), 'hamstring red');
put(ci(MON,{hamstring:6}));
eq('a better one stays lifted', held(nordic,MON), null);

console.log('every red at once:');
reset(MON); put(ci(FRI,{hamstring:8,knee:7,elbow:4}));
eq('two reds hold; the amber elbow is not one of them', Object.keys(ctx.redHolds(MON)).sort(), ['hamstring','knee']);
eq('Clear all reds lifts both and says which', ctx.liftAllReds(MON).sort(), ['hamstring','knee']);
eq('nothing is held now', [ctx.redHolds(MON),held(nordic,MON),held('pistol',MON)], [{},null,null]);
eq('the amber is not touched: an area it guards still keeps its load where it is', ctx.holdReason(ctx.areaById('mu'),MON), 'medial elbow amber');
eq('clearing again does nothing', ctx.liftAllReds(MON), []);

console.log('putting it back:');
reset(MON); put(ci(FRI,{hamstring:8}));
ctx.liftRed('hamstring',MON);
eq('a lift that is holding something open is listed, with what the hold would have been', ctx.liftedReds(MON), [{body:'hamstring',from:FRI,until:'2026-10-09'}]);
ctx.putRedBack('hamstring');
eq('putting it back holds again', [held(nordic,MON),ctx.liftedReds(MON)], ['hamstring red',[]]);
ctx.liftRed('hamstring',MON);
eq('a lift whose hold has run out anyway is not offered', ctx.liftedReds('2026-10-12'), []);
reset(MON); put(ci(FRI,{hamstring:8})); ctx.putRedBack('knee');
eq('putting back what was never lifted is harmless', held(nordic,MON), 'hamstring red');

console.log('what is stored is cleaned before it is believed:');
reset(MON); put(ci(FRI,{hamstring:8}));
ctx.settings.redLifted={hamstring:{date:'tomorrow'},bogus:{date:MON,pain:0,stiff:'none'},knee:'yes',elbow:null};
eq('junk is ignored', [ctx.redLifts(),held(nordic,MON)], [{},'hamstring red']);
ctx.settings.redLifted=['hamstring']; eq('a list is ignored', ctx.redLifts(), {});
ctx.settings.redLifted='all'; eq('and a word', ctx.redLifts(), {});
ctx.settings.redLifted={hamstring:{date:MON,pain:'lots',stiff:'forever'}};
eq('a bad reading falls back to the safe baseline, the lift still works', ctx.redLifts().hamstring, {date:MON,pain:0,stiff:'none'});
reset(MON); put(ci(FRI,{hamstring:8}));
eq('nothing stored at all is fine', ctx.redLifts(), {});

console.log('a clear check-in lifts a red by itself:');
reset(MON); put(ci(FRI,{hamstring:8}),ci(MON,{hamstring:1}));
eq('red on Friday, green today: free from today', [ctx.redHolds(MON),held(nordic,MON)], [{},null]);
eq('but Friday and Saturday still read as held, as they did', [held(nordic,FRI),held(nordic,SAT)], ['hamstring red','hamstring red']);
eq('and the check-ins are not touched', ctx.checkIns.length, 2);
reset(MON); put(ci(FRI,{hamstring:8}),ci(MON,{hamstring:4}));
eq('an amber one does not lift it', held(nordic,MON), 'hamstring red');
reset(MON); put(ci(FRI,{hamstring:8}),ci(MON,{hamstring:1},'30to60'));
eq('nor does a low pain with a long stiffness (that is amber)', held(nordic,MON), 'hamstring red');
reset(MON); put(ci(FRI,{hamstring:8}),ci(MON,{hamstring:3},'under30'));
eq('three out of ten with short stiffness is green: it lifts', held(nordic,MON), null);
reset(MON); put(ci(THU,{hamstring:0}),ci(FRI,{hamstring:8}));
eq('a clear check-in from before the red does not lift it', held(nordic,MON), 'hamstring red');
reset(MON); put(ci(FRI,{hamstring:8}),ci(MON,{hamstring:1}));
ctx.settings.redAuto=false;
eq('with the setting off, a clear check-in does nothing', held(nordic,MON), 'hamstring red');
eq('the setting reads as a plain on or off, and on when it was never set', [ctx.redAutoOn(),(ctx.settings.redAuto=true,ctx.redAutoOn()),(delete ctx.settings.redAuto,ctx.redAutoOn())], [false,true,true]);
reset(MON); put(ci(FRI,{hamstring:8}),ci(SAT,{hamstring:0}),ci(TUE,{hamstring:9}));
eq('a clear one, then a new red: the new one holds, from its own day', [held(nordic,MON),held(nordic,TUE),ctx.redHolds(TUE).hamstring.from], [null,'hamstring red',TUE]);
reset(MON); put(ci(FRI,{hamstring:8,knee:8}),ci(MON,{hamstring:0,knee:6}));
eq('it is per body area: the hamstring lifts while the knee, still red, holds', Object.keys(ctx.redHolds(MON)), ['knee']);
reset(MON); put(ci(FRI,{hamstring:8}),ci(MON,{hamstring:0}));
eq('nothing is lifted by hand when it was already clear', [ctx.liftRed('hamstring',MON),ctx.settings.redLifted], [false,undefined]);

console.log('the old plan reads the same holds:');
reset(MON); put(ci(FRI,{hamstring:8}));
ok('its red gate sees the hold', ctx.redAreasOn(MON).hamstring==='2026-10-09');
ctx.liftRed('hamstring',MON);
eq('and it goes when you lift it', ctx.redAreasOn(MON), {});

console.log('the week ahead follows:');
reset(MON); put(ci(FRI,{hamstring:8}));
let fc=ctx.weekForecast(MON,[]);
const first=id=>Object.keys(fc).find(d=>fc[d].picks.includes(id))||null;
eq('held: Nordic first appears the day the hold ends', first(nordic), '2026-10-10');
ctx.liftRed('hamstring',MON);
fc=ctx.weekForecast(MON,[]);
ok('lifted: Nordic is on the menu earlier', first(nordic)!==null && first(nordic)<'2026-10-10');
reset(MON); put(ci(FRI,{hamstring:8}),ci(MON,{hamstring:0}));
fc=ctx.weekForecast(MON,[]);
ok('a clear check-in today does the same, with no tap', first(nordic)!==null && first(nordic)<'2026-10-10');

console.log('the reason and the tap, on screen:');
const made=[]; const origEl=ctx.el;
ctx.el=function(tag,attrs,kids){const n=origEl(tag,attrs,kids);made.push({tag,attrs:attrs||{},kids,n});return n;};
const toasts=[]; ctx.toast=m=>{toasts.push(m);};
let repaints=0; const after=()=>{repaints++;};
const texts=()=>made.map(m=>m.attrs.text).filter(Boolean);
const btn=(label,i)=>made.filter(m=>m.tag==='button'&&m.attrs.text===label)[i||0];
const clear=()=>{made.length=0;toasts.length=0;repaints=0;};

reset(MON); put(ci(FRI,{hamstring:8}));
clear(); let card=ctx.holdsCard(MON,after);
ok('the Areas tab has a card for a red that is holding something', card!==null);
ok('it names the body area', texts().includes('Hamstring · red'));
const said=texts().find(x=>/^Pausing /.test(x))||'';
ok('what it is pausing, and which areas', /Nordic curl/.test(said)&&/Kettlebell/.test(said));
ok('when it is back, and from which check-in', /Back on 10 Oct, seven days after your check-in on 3 Oct\./.test(said));
ok('and that it lifts by itself on a clear check-in', texts().includes('A red also lifts by itself when a later check-in shows that area green.'));
ok('one red has one button, not a clear-all as well', !!btn('Lift hold')&&!btn('Clear all reds'));
btn('Lift hold').n._h.click();
eq('tapping it lifts the hold, says so, and redraws', [held(nordic,MON),toasts[0],repaints], [null,'Hamstring hold lifted. Your check-ins are unchanged.',1]);
clear(); card=ctx.holdsCard(MON,after);
ok('afterwards the card shows what you lifted, and offers to put it back', card!==null&&texts().includes('Hamstring · lifted by you')&&!!btn('Put it back'));
ok('with what the hold would have been', texts().some(x=>/It would have held until 9 Oct\./.test(x)));
btn('Put it back').n._h.click();
eq('putting it back holds again and redraws', [held(nordic,MON),repaints], ['hamstring red',1]);
reset(MON); put(ci(FRI,{hamstring:8}));
ctx.settings.redAuto=false; clear(); ctx.holdsCard(MON,after);
ok('with lifting by itself off, the card says so', texts().some(x=>/switched off/.test(x)));
reset(MON); put(ci(FRI,{hamstring:8,knee:7}));
clear(); ctx.holdsCard(MON,after);
eq('two reds: a lift for each, and one to clear them all', [made.filter(m=>m.tag==='button'&&m.attrs.text==='Lift hold').length,!!btn('Clear all reds')], [2,true]);
btn('Clear all reds').n._h.click();
eq('Clear all reds lifts every one, names them, and redraws', [ctx.redHolds(MON),toasts[0],repaints], [{},'Cleared: knee, hamstring. Your check-ins are unchanged.',1]);
reset(MON); put(ci(FRI,{elbow:2}));
eq('nothing held and nothing lifted: no card at all', ctx.holdsCard(MON,after), null);

console.log('on Today, where the delay is felt:');
reset(MON); put(ci(FRI,{hamstring:8}));
let todayRepaints=0; const saveRepaint=ctx.repaintToday; ctx.repaintToday=()=>{todayRepaints++;};
clear(); const callouts=ctx.heldCallouts(MON);
eq('the red callout is there, as it always was', callouts.length, 1);
ok('and now has the tap', !!btn('Lift hold'));
btn('Lift hold').n._h.click();
eq('tapping it lifts the hold and redraws Today', [held(nordic,MON),todayRepaints], [null,1]);
reset(MON); put(ci(FRI,{hamstring:8}));
ctx.dayPlans[MON]={sittings:[{minutes:45,areas:['nordic']}],suggested:['nordic'],removed:{},why:{}};
ctx.freezeAreaDay(MON,'nordic');
clear(); todayRepaints=0; ctx.areaDayCard(MON,0,'nordic',ctx.dayPlans[MON],true);
ok('a held area on the menu says why, and has the tap', texts().some(x=>/^Held: hamstring red\./.test(x))&&!!btn('Lift hold'));
btn('Lift hold').n._h.click();
eq('tapping it frees the area', [held(nordic,MON),todayRepaints], [null,1]);
ctx.repaintToday=saveRepaint;

console.log('in the week ahead, why not:');
reset(MON); put(ci(FRI,{hamstring:8}));
fc=ctx.weekForecast(MON,[]);
const nord=(d)=>fc[d].left.find(l=>l.id===nordic);
ok('every forecast day keeps what it left out, with the recommender’s reason', ['2026-10-06','2026-10-09','2026-10-11'].every(d=>Array.isArray(fc[d].left)&&fc[d].left.length>0&&fc[d].left.every(l=>typeof l.why==='string'&&l.why.length)));
eq('and the picks and the left-out together are every area, once', ['2026-10-06','2026-10-08'].every(d=>fc[d].picks.concat(fc[d].left.map(l=>l.id)).sort().join()===ctx.areaList().map(a=>a.id).sort().join()), true);
eq('Nordic is left out while held, with the reason', [nord('2026-10-06').kind,nord('2026-10-06').why], ['held','Held: hamstring red.']);
eq('and on the day it is back it is picked, not left out', [fc['2026-10-10'].picks.includes(nordic),!!nord('2026-10-10')], [true,false]);
eq('a day that already has a menu has nothing left out', (()=>{reset(MON);put(ci(FRI,{hamstring:8}));ctx.dayPlans[MON]={sittings:[{minutes:45,areas:['mu']}],suggested:['mu'],removed:{},why:{}};return ctx.weekForecast(MON,[])[MON].left;})(), []);
reset(MON); put(ci(FRI,{hamstring:8})); fc=ctx.weekForecast(MON,[]);
clear(); ctx.dayDetail('2026-10-06',MON,[],fc);
ok('tapping a day ahead shows why each area is there', fc['2026-10-06'].picks.every(id=>texts().includes(fc['2026-10-06'].why[id])));
ok('and a Left out list', texts().includes('Left out'));
const nrow=texts().find(x=>/^Held: hamstring red\./.test(x))||'';
ok('with Nordic held, and when it is back', /Back on 10 Oct\./.test(nrow));
ok('and a tap to lift it', !!btn('Lift hold'));
const sRepaintAreas=ctx.repaintAreas; let areaRepaints=0; ctx.repaintAreas=()=>{areaRepaints++;};
clear(); ctx.dayDetail('2026-10-06',MON,[],fc);
btn('Lift hold').n._h.click();
ok('tapping it lifts the hold', held(nordic,MON)===null);
const fc2=ctx.weekForecast(MON,[]);
ok('and the week fills in Nordic sooner', Object.keys(fc2).some(d=>d<'2026-10-10'&&fc2[d].picks.includes(nordic)));
ctx.repaintAreas=sRepaintAreas;
reset(MON); put(ci(FRI,{hamstring:8})); fc=ctx.weekForecast(MON,[]);
clear(); ctx.dayDetail('2026-10-06',MON,[],{'2026-10-06':Object.assign({},fc['2026-10-06'],{left:[{id:'mu',kind:'soon',why:'Too soon: trained yesterday, wants 2+ days between.'}]})});
ok('a reason that is not a hold has no lift button', texts().includes('Too soon: trained yesterday, wants 2+ days between.')&&!btn('Lift hold'));

reset(MON); put(ci(FRI,{hamstring:8}));
const bare={'2026-10-06':{real:false,minutes:45,picks:[],why:{},left:[{id:nordic,kind:'held',why:'Held: hamstring red.'},{id:'mu',kind:'met',why:'Target met this week (2/2). You can still add it.'}]}};
clear(); ctx.dayDetail('2026-10-06',MON,[],bare);
ok('a day with nothing suggested still says so', texts().includes('Nothing suggested for this day.'));
ok('and still explains every area that was left out, which is where it matters most', texts().includes('Left out')&&texts().includes('Nordic curl')&&texts().includes('Muscle-up')&&texts().some(x=>/^Target met this week/.test(x)));
ok('with the tap to lift a held one, and the note that it can change', !!btn('Lift hold')&&texts().some(x=>/real menu is made when you open the day/.test(x)));
clear(); ctx.dayDetail('2026-10-06',MON,[],{'2026-10-06':{real:false,minutes:45,picks:[],why:{}}});
ok('with nothing suggested and nothing left out (an older forecast) it is just the one line', texts().includes('Nothing suggested for this day.')&&!texts().includes('Left out'));

console.log('the check-in says when it lifted something:');
reset(MON); put(ci(FRI,{hamstring:8}));
clear(); ctx.renderCheckIn();
btn('Save check-in').n._h.click();
ok('a clear check-in lifts the red and says so', toasts.some(x=>/Hamstring hold lifted: this check-in is clear\./.test(x)));
eq('and it did', held(nordic,MON), null);
reset(MON); put(ci(FRI,{hamstring:8}));
clear(); ctx.renderCheckIn();
ctx.settings.redAuto=false;
btn('Save check-in').n._h.click();
eq('with lifting by itself off it just saves', [toasts[toasts.length-1],held(nordic,MON)], ['Check-in saved.','hamstring red']);
reset(MON); put(ci(FRI,{elbow:1}));
clear(); ctx.renderCheckIn(); btn('Save check-in').n._h.click();
eq('with nothing held it just saves', toasts[toasts.length-1], 'Check-in saved.');

console.log('the switch:');
reset(MON); clear(); ctx.redSection();
ok('it draws, with On and Off', !!btn('On')&&!!btn('Off'));
ctx.repaintProgressInPlace=()=>{};
btn('Off').n._h.click();
eq('Off is saved', [ctx.settings.redAuto,ctx.redAutoOn(),JSON.parse(store.settings).redAuto], [false,false,false]);
clear(); ctx.redSection(); btn('On').n._h.click();
eq('and On', [ctx.settings.redAuto,ctx.redAutoOn()], [true,true]);
ok('the Progress tab draws with it, and so do the Areas and Today tabs with holds in play', (()=>{try{reset(MON);put(ci(FRI,{hamstring:8}));ctx.renderProgress();ctx.renderAreas();ctx.renderToday();ctx.renderCheckIn();return true;}catch(e){console.log('   ',e.message);return false;}})());
reset(MON); put(ci(FRI,{hamstring:8})); ctx.areasView={week:null,day:null}; clear(); ctx.renderAreas();
ok('the Areas tab itself shows the red lights card when something is held', texts().includes('Red lights')&&texts().includes('Hamstring · red')&&!!btn('Lift hold'));
reset(MON); put(ci(FRI,{elbow:1})); ctx.areasView={week:null,day:null}; clear(); ctx.renderAreas();
ok('and no card when nothing is', !texts().includes('Red lights'));
ctx.el=origEl;
ok('the backup still reads with a lift in it', (()=>{reset(MON);put(ci(FRI,{hamstring:8}));ctx.liftRed('hamstring',MON);return !ctx.inspectBackup(JSON.stringify(ctx.exportPayload())).error;})());

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
