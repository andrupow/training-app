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
const ci=(date,pain)=>({date,pain:Object.assign({elbow:0,shoulder:0,achilles:0,hamstring:0},pain),stiffness:'none'});

/* a small made-up area, so the engine is tested on numbers that are easy to follow:
   a stage asks after 6 full days, a week is 2 days, so the easy block starts at day 4 */
const ex=(id,sets)=>({id,name:id.toUpperCase(),sets,reps:'5',restSec:60,load:{type:'bodyweight'},cue:'c'});
const X={id:'x',name:'Xercise',short:'X',priority:1,goal:'g',perWeek:{min:2,target:2,max:3},minGapDays:1,minutes:20,load:'low',order:'strength',guardedBy:['elbow'],sessionTypes:[],tests:[],stages:[
  {id:'X1',name:'One',askAfter:6,work:'w',ready:['the first standard is met'],exercises:[ex('a',5),ex('b',3),ex('c',2),ex('d',1)],equipment:['bar','rings'],draft:true},
  {id:'X2',name:'Two',askAfter:6,work:'w',ready:['the second standard is met'],exercises:[ex('a',5),ex('e',3)],equipment:['bar'],requires:[{area:'y',stage:'Y2'}]},
  {id:'X3',name:'Three',askAfter:6,work:'w',ready:['the third standard is met']}]};
const Y={id:'y',name:'Why',short:'Y',priority:2,goal:'g',perWeek:{min:1,target:2,max:3},minGapDays:1,minutes:20,load:'low',order:'strength',guardedBy:[],sessionTypes:[],tests:[],stages:[
  {id:'Y1',name:'One',askAfter:4,work:'w',ready:['the first standard is met'],exercises:[ex('a',3)],equipment:[]},
  {id:'Y2',name:'Two',work:'w',ready:['the last standard is met'],exercises:[ex('a',4)],equipment:[]}]};
const synth={rules,legacy:{toArea:{}},list:[X,Y]};
const reset=()=>{ctx.areaData=synth;ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.progress={};ctx.decisions=[];ctx.checkIns=[];ctx.schedule={};ctx.settings={};ctx.weekFits={};
  ['progress','decisions','areaDays','dayPlans','settings','weekFits','checkIns'].forEach(k=>delete store[k]);};
const D=n=>ctx.addDays('2026-10-05',n);
const sessionOf=(date,area='x')=>ctx.sessionById(date+':'+area);
const fullDay=(date,area='x')=>{ctx.freezeAreaDay(date,area);const s=sessionOf(date,area);s.exercises.forEach(e=>{for(let i=0;i<e.sets;i++)ctx.writeLog(s.id,e.id,i,{done:true});});};
const partDay=(date,area='x')=>{ctx.freezeAreaDay(date,area);const s=sessionOf(date,area);ctx.writeLog(s.id,s.exercises[0].id,0,{done:true});};
const X0=()=>ctx.areaById('x');
const sp=()=>ctx.stageProgress(X0(),ctx.areaDays());

console.log('where a stage is, from plain numbers:');
const st={askAfter:6};
eq('the first days are the full prescription', [0,1,2,3].map(n=>ctx.stagePhase(st,n,2,null)), ['build','build','build','build']);
eq('the last week’s worth is the easy block', [4,5].map(n=>ctx.stagePhase(st,n,2,null)), ['deload','deload']);
eq('then it asks', [6,9].map(n=>ctx.stagePhase(st,n,2,null)), ['ask','ask']);
eq('a stage that is only a few days long keeps half of it at full strength', [0,1,2,3].map(n=>ctx.stagePhase({askAfter:4},n,4,null)), ['build','build','deload','deload']);
eq('a stage with nothing above it never asks', [0,50].map(n=>ctx.stagePhase({},n,2,null)), ['top','top']);
eq('after "not yet" there is no easy block: the top prescription until the new day', [4,5,9].map(n=>ctx.stagePhase(st,n,2,10)), ['build','build','build']);
eq('and it asks again at that day', [10,11].map(n=>ctx.stagePhase(st,n,2,10)), ['ask','ask']);
eq('an easy block is about 60 per cent of the sets, never fewer than one', [5,3,2,1,10].map(ctx.deloadSets), [3,2,1,1,6]);

console.log('counting full days in a stage:');
reset();
eq('nothing yet', sp().full, 0);
eq('the stage is the first one, with no entry in progress', [sp().stage.id, sp().index, sp().top], ['X1',0,false]);
[0,1,2].forEach(n=>fullDay(D(n)));
eq('three full days: still the full prescription', [sp().full,sp().phase,sp().due], [3,'build',false]);
ok('so the next day is not an easy one', (ctx.freezeAreaDay(D(3),'x'),!ctx.frozenDays[D(3)+':x'].deload));
fullDay(D(3));
eq('the fourth full day begins the easy block, for the days after it', [sp().full,sp().phase], [4,'deload']);
ok('the day after is frozen as easy', (ctx.freezeAreaDay(D(4),'x'),ctx.frozenDays[D(4)+':x'].deload===true));
eq('an easy day has about 60 per cent of the sets: 5 3 2 1 become 3 2 1 1', sessionOf(D(4)).exercises.map(e=>e.sets), [3,2,1,1]);
ok('and says so', sessionOf(D(4)).deload===true&&/deload/.test(sessionOf(D(4)).name));
eq('the day before it was done at full strength and stays that way', sessionOf(D(3)).exercises.map(e=>e.sets), [5,3,2,1]);
ctx.dayPlans={};
fullDay(D(4));
eq('finishing an easy day, every set of it, is a full day', [sp().full, ctx.areaDays().find(r=>r.date===D(4)).total], [5,7]);
partDay(D(5));
eq('a part-done day does not count', sp().full, 5);
fullDay(D(6));
eq('the sixth full day: ready for a review', [sp().full,sp().phase,sp().due], [6,'ask',true]);
ok('and that day was easy too', ctx.frozenDays[D(6)+':x'].deload===true);

console.log('what a stage change does to the count:');
reset(); [0,1,2,3].forEach(n=>fullDay(D(n)));
ctx.checkIns=[];
let r=ctx.moveUp('x',ctx.areaDays(),D(4));
eq('moving up', [r.ok, ctx.currentStage(X0()).id], [true,'X2']);
eq('the count starts again from the day you moved', [sp().full,sp().stage.id,ctx.progress.x], [0,'X2',{stage:'X2',since:D(4),nextAsk:null}]);
fullDay(D(4));
eq('a day that same day at the new stage counts', sp().full, 1);
eq('the days at the old stage stay at the old stage', [ctx.stageOfDay(X0(),D(0)), ctx.stageOfDay(X0(),D(4))], ['X1','X2']);
eq('the decision is written down, with the days it took', ctx.decisions, [{date:D(4),area:'x',from:'X1',to:'X2',action:'up',full:4}]);
ctx.stepBack('x',ctx.areaDays(),D(5));
eq('stepping back restarts the count at the old stage too: earlier days at X1 do not come back', [ctx.currentStage(X0()).id, sp().full], ['X1',0]);
eq('and that is written down', ctx.decisions[1], {date:D(5),area:'x',from:'X2',to:'X1',action:'back',full:1});
eq('there is nothing below the first stage', ctx.stepBack('x',ctx.areaDays(),D(5)), {ok:false,why:'This is the first stage.'});

console.log('"not yet":');
reset(); [0,1,2,3,4,5].forEach(n=>fullDay(D(n)));
eq('ready', sp().phase, 'ask');
r=ctx.notYet('x',ctx.areaDays(),D(6));
eq('it asks again after four more full days', [r.ok,r.nextAsk,ctx.progress.x], [true,10,{stage:'X1',since:null,nextAsk:10}]);
eq('and it is on the record', ctx.decisions, [{date:D(6),area:'x',from:'X1',to:'X1',action:'stay',full:6}]);
eq('meanwhile the full prescription, no easy block', [sp().phase, ctx.areaDayPhase(X0(),D(7),ctx.areaDays())], ['build','build']);
[6,7,8].forEach(n=>fullDay(D(n)));
eq('three more days: not yet', sp().phase, 'build');
ctx.freezeAreaDay(D(9),'x');
ok('and none of them was an easy day', [6,7,8,9].every(n=>!ctx.frozenDays[D(n)+':x'].deload));
fullDay(D(9));
eq('the fourth: it asks again', [sp().full,sp().phase], [10,'ask']);
eq('moving up clears the wait', (ctx.moveUp('x',ctx.areaDays(),D(10)), ctx.progress.x.nextAsk), null);

console.log('moving up has to wait for the body, not for the clock:');
reset(); [0,1,2,3,4,5].forEach(n=>fullDay(D(n)));
ctx.checkIns=[ci(D(5),{elbow:4})];
eq('amber elbow', ctx.moveUp('x',ctx.areaDays(),D(6)), {ok:false,why:'Waiting: medial elbow amber.'});
ctx.checkIns=[ci(D(5),{elbow:8})];
eq('red elbow', ctx.moveUp('x',ctx.areaDays(),D(6)), {ok:false,why:'Waiting: medial elbow red.'});
eq('nothing moved', [ctx.currentStage(X0()).id, ctx.decisions], ['X1',[]]);
eq('"not yet" and stepping back never wait', [ctx.notYet('x',ctx.areaDays(),D(6)).ok, ctx.stepBack('x',ctx.areaDays(),D(6)).ok], [true,false]);
ctx.checkIns=[ci(D(5),{elbow:4})];
eq('a week later it has lifted', ctx.levelUpBlock(X0(),D(12)), null);
eq('a body area that does not guard it does not matter', (ctx.checkIns=[ci(D(5),{shoulder:8})], ctx.levelUpBlock(X0(),D(6))), null);

console.log('where it cannot go:');
reset();
eq('onto a stage with nothing written', (ctx.progress.x={stage:'X2',since:null,nextAsk:null}, ctx.moveUp('x',[],D(0))), {ok:false,why:'X3 has nothing written yet.'});
eq('above the top', (ctx.progress.y={stage:'Y2',since:null,nextAsk:null}, ctx.moveUp('y',[],D(0))), {ok:false,why:'This is the top of the ladder.'});
eq('an area that is not there', [ctx.moveUp('zzz',[],D(0)).ok, ctx.notYet('zzz',[],D(0)).ok, ctx.stepBack('zzz',[],D(0)).ok, ctx.placeAt('zzz','X1',[],D(0)).ok], [false,false,false,false]);

console.log('setting the stage yourself (where you start, or somewhere else):');
reset();
r=ctx.placeAt('x','X2',[],D(0));
eq('placing', [r.ok, ctx.currentStage(X0()).id, ctx.decisions[0].action], [true,'X2','set']);
eq('already there', ctx.placeAt('x','X2',[],D(0)), {ok:false,why:'Already at X2.'});
eq('no such stage', ctx.placeAt('x','X9',[],D(0)), {ok:false,why:'No such stage.'});
eq('a stage with nothing written cannot be chosen', ctx.placeAt('x','X3',[],D(0)), {ok:false,why:'X3 has nothing written yet.'});
eq('placing is not held by the body: it is your claim', (ctx.checkIns=[ci(D(0),{elbow:8})], ctx.placeAt('x','X1',[],D(0)).ok), true);

console.log('today’s menu follows a move, unless the day has been started:');
reset(); [0,1,2,3,4,5].forEach(n=>fullDay(D(n)));
ctx.dayPlans[D(6)]={sittings:[{minutes:45,areas:['x']}],suggested:['x'],removed:{},why:{}};
ctx.freezeAreaDay(D(6),'x');
eq('planned at the old stage', ctx.frozenDays[D(6)+':x'].stage, 'X1');
ctx.moveUp('x',ctx.areaDays(),D(6));
eq('after the move it is planned at the new one', [ctx.frozenDays[D(6)+':x'].stage, sessionOf(D(6)).exercises.map(e=>e.id)], ['X2',['a','e']]);
reset(); [0,1,2,3,4,5].forEach(n=>fullDay(D(n)));
ctx.dayPlans[D(6)]={sittings:[{minutes:45,areas:['x']}],suggested:['x'],removed:{},why:{}};
partDay(D(6));
ctx.moveUp('x',ctx.areaDays(),D(6));
eq('a day with sets already logged is left as it was', ctx.frozenDays[D(6)+':x'].stage, 'X1');

console.log('what a stage needs from the other areas (advisory):');
reset();
eq('Y is at its first stage; X2 wants Y2', ctx.prereqStatus(X0().stages[1]), [{area:'y',stage:'Y2',name:'Why',have:'Y1',met:false}]);
ctx.progress.y={stage:'Y2',since:null,nextAsk:null};
eq('met once Y gets there', ctx.prereqStatus(X0().stages[1])[0].met, true);
eq('a stage that wants nothing', ctx.prereqStatus(X0().stages[0]), []);
eq('an area that no longer exists is not met', ctx.prereqStatus({requires:[{area:'gone',stage:'G1'}]}), [{area:'gone',stage:'G1',name:'gone',have:null,met:false}]);

console.log('equipment you own:');
reset();
eq('the bar is owned by default, rings are not', [ctx.equipmentOwned('bar'), ctx.equipmentOwned('rings')], [true,false]);
eq('something unknown is not owned', ctx.equipmentOwned('jetpack'), false);
let need=ctx.stageNeeds(X0().stages[0]);
eq('the first stage needs a bar and rings', need.equipment.map(e=>[e.id,e.owned]), [['bar',true],['rings',false]]);
eq('and says what is missing, in words', need.missing, ['Gymnastic rings']);
ctx.setEquipment('rings',true);
eq('tick them and nothing is missing', [ctx.stageNeeds(X0().stages[0]).missing, JSON.parse(store.settings).equipment], [[],{rings:true}]);
ctx.setEquipment('bar',false);
eq('untick the bar and it is', ctx.stageNeeds(X0().stages[0]).missing, ['Pull-up bar']);
eq('your own list beats the default', ctx.equipmentOwned('bar'), false);

ctx.areaData=real;
const K=id=>ctx.areaById('kb').stages.find(s=>s.id===id);
eq('bells default to the 15 and 25 lb you have', ctx.bellsOwned(), [15,25]);
need=ctx.stageNeeds(K('K1'));
eq('so the foundation stage has both', need.bells.map(b=>[b.lb,b.owned]), [[15,true],[25,true]]);
need=ctx.stageNeeds(K('K2'));
eq('the first S&S stage needs a 35 lb bell', [need.bells, need.missing], [[{kg:16,lb:35,owned:false}],['a 35 lb (16 kg) bell']]);
ctx.setBells(['25',15,15,-3,'x',300,35]);
eq('bells are cleaned: numbers, once each, in order', ctx.bellsOwned(), [15,25,35]);
eq('and with a 35 lb bell nothing is missing', ctx.stageNeeds(K('K2')).missing, []);
eq('a bell you own is saved with your settings', JSON.parse(store.settings).bellsLb, [15,25,35]);

console.log('on the real areas:');
reset(); ctx.areaData=real;
eq('nobody has moved: every area is at its first stage', real.list.every(a=>ctx.currentStage(a).id===a.stages[0].id), true);
const nordic=ctx.areaById('nordic');
eq('Nordic in N1 runs 2 / 3 / 3, two days apart', [ctx.stageWeek(nordic,ctx.currentStage(nordic)), ctx.stageGap(nordic,ctx.currentStage(nordic))], [{min:2,target:3,max:3},2]);
ctx.placeAt('nordic','N3',[],D(0));
eq('placed at N3 the week changes with it: 1 / 2 / 3, three days apart', [ctx.stageWeek(nordic,ctx.currentStage(nordic)), ctx.stageGap(nordic,ctx.currentStage(nordic))], [{min:1,target:2,max:3},3]);
eq('and the area page, the menu and the fit all read it', ctx.areaWeek(nordic,'2026-10-05','2026-10-07',[]).gap, 3);
reset(); ctx.areaData=real;
const mu=ctx.areaById('mu');
ctx.schedule={'W2-Mon':'2026-09-20'};
ctx.sessionById('W2-Mon').exercises.forEach(e=>{for(let i=0;i<e.sets;i++)ctx.writeLog('W2-Mon',e.id,i,{done:true});});
const legacy=ctx.areaDays().filter(r=>r.area==='mu'&&r.full).length;
ok('old plan days count at the first stage', legacy>=1&&ctx.stageProgress(mu,ctx.areaDays()).full===legacy);
ctx.placeAt('mu','M2',ctx.areaDays(),'2026-10-05');
eq('but not once you are at M2: they were M1 days', ctx.stageProgress(mu,ctx.areaDays()).full, 0);
ok('the old days are still there as history', ctx.areaDays().filter(r=>r.area==='mu'&&r.full).length===legacy);

console.log('storage and backup:');
reset(); ctx.areaData=synth;
ctx.progress={x:{stage:'X2',since:D(3),nextAsk:null}}; ctx.decisions=[{date:D(3),area:'x',from:'X1',to:'X2',action:'up',full:6}];
ctx.saveProgress(); ctx.saveDecisions();
ctx.progress={}; ctx.decisions=[]; ctx.loadProgress(); ctx.loadDecisions();
eq('they survive a reload', [ctx.progress.x, ctx.decisions.length], [{stage:'X2',since:D(3),nextAsk:null},1]);
eq('and are exported', [ctx.exportPayload().progress.x.stage, ctx.exportPayload().decisions[0].to], ['X2','X2']);
eq('junk progress is dropped, a half-good entry is kept', ctx.cleanProgress({a:null,b:{stage:7},c:{stage:'C2'},d:{stage:'D1',since:'tomorrow',nextAsk:'6'},e:{stage:'E1',nextAsk:-3},f:[]}),
   {c:{stage:'C2',since:null,nextAsk:null},d:{stage:'D1',since:null,nextAsk:6},e:{stage:'E1',since:null,nextAsk:null}});
eq('not an object', [ctx.cleanProgress(null),ctx.cleanProgress([1]),ctx.cleanProgress('x')], [{},{},{}]);
eq('junk decisions are dropped', ctx.cleanDecisions([null,{area:'x'},{area:'x',to:'X2',action:'up',date:'2026-10-05'},{area:'x',to:'X2',action:'nope',date:'2026-10-05'},{area:'x',to:'X2',action:'stay',date:'yesterday'},{area:'y',from:'Y1',to:'Y2',action:'set',date:'2026-10-05',full:'3',note:'felt ready'}]),
   [{date:'2026-10-05',area:'x',from:'X2',to:'X2',action:'up',full:0},{date:'2026-10-05',area:'y',from:'Y1',to:'Y2',action:'set',full:3,note:'felt ready'}]);
eq('not a list', ctx.cleanDecisions({}), []);
ok('a backup carrying progress is accepted', !ctx.inspectBackup(JSON.stringify({setLogs:[],progress:{x:{stage:'X2'}},decisions:[]})).error);
ok('progress as a list is refused', !!ctx.inspectBackup('{"progress":[]}').error);
ok('decisions as an object is refused', !!ctx.inspectBackup('{"decisions":{}}').error);
Object.keys(store).forEach(k=>delete store[k]);
store.progress='{"x":{"stage":"X2"}}'; store.decisions='[]';
ctx.writeBackup({setLogs:[{sessionId:'W2-Mon'}]});
eq('logs without them (an old file) clears them: a stage belongs to the history it was reached on', [store.progress,store.decisions], [undefined,undefined]);
store.progress='{"x":{"stage":"X2"}}';
ctx.writeBackup({baselines:[{date:'2026-09-19'}]});
eq('a file with no logs leaves them alone', store.progress, '{"x":{"stage":"X2"}}');
ctx.writeBackup({setLogs:[],progress:{y:{stage:'Y2'}},decisions:[]});
eq('a file that has them restores them', [store.progress,store.decisions], ['{"y":{"stage":"Y2"}}','[]']);
ok('frozen days keep their easy-block flag through a reload', (()=>{ctx.frozenDays={['2026-10-05:x']:{stage:'X1',deload:true},['2026-10-06:x']:{stage:'X1'}};ctx.saveFrozenDays();ctx.frozenDays={};ctx.loadFrozenDays();return ctx.frozenDays['2026-10-05:x'].deload===true&&!('deload' in ctx.frozenDays['2026-10-06:x']);})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
