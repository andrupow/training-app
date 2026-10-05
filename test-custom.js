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
const files=()=>idx.areas.map(id=>read('data/areas/'+id+'.json'));
const clone=o=>JSON.parse(JSON.stringify(o));
const fresh=()=>{ctx.areaData={rules:clone(rules),legacy:read('data/legacy.json'),list:files()};ctx.customAreas=[];ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.progress={};ctx.decisions=[];ctx.checkIns=[];ctx.schedule={};ctx.settings={};ctx.weekFits={};
  ['customAreas','setLogs','progress','decisions','areaDays','dayPlans','settings','weekFits'].forEach(k=>delete store[k]);};
fresh();
const V=(o,opts)=>ctx.validateAreaPack(o,Object.assign({taken:[]},opts||{}));
const pack=()=>({id:'rowing',name:'Rowing technique',goal:'A smooth 2 km row at a steady pace.',perWeek:{min:2,target:3,max:4},minGapDays:1,minutes:25,load:'medium',order:'strength',guardedBy:['lowerBack'],
  stages:[{id:'R1',name:'Catch and drive',askAfter:6,work:'Rowing drills and short pieces.',ready:['5 x 500 m at a steady pace'],equipment:['mat'],
      exercises:[{id:'drill',name:'Pause drill',sets:3,reps:'10',restSec:45,load:{type:'bodyweight'},cue:'Legs, body, arms.'},{id:'piece',name:'Steady piece',sets:4,reps:'4 min',restSec:90,load:{type:'text',text:'Easy pace'},cue:'Same stroke rate.'}]},
    {id:'R2',name:'Steady state',askAfter:8,goal:true,work:'Longer steady rows.',ready:['2 km without stopping'],
      exercises:[{id:'steady',name:'Steady row',sets:3,reps:'6 min',restSec:90,load:{type:'text',text:'Easy pace'},cue:'Relax the shoulders.'}]}]});
const errs=(o,opts)=>V(o,opts).errors;
const has=(list,frag)=>list.some(e=>e.includes(frag));

console.log('the rules the built-in eight meet, applied to a pack:');
const builtIn=files();
builtIn.forEach(a=>{const r=V(a); ok(a.id+' passes the same check ('+r.errors.slice(0,2).join(' | ')+')', r.ok);});
ok('so does a small made-up pack', V(pack()).ok);
eq('with nothing to say about it', V(pack()).warnings, []);
ok('a pack may be wrapped as { "area": {...} }', V({area:pack()}).ok);
eq('the area comes back with the defaults filled in', (a=>[a.short,a.sessionTypes,a.tests])(V(pack()).area), ['Rowing',[],[]]);
ok('the input is not changed', (()=>{const o=pack(),s=JSON.stringify(o);V(o);return JSON.stringify(o)===s;})());

console.log('what it refuses, in plain words:');
eq('not an object', [V(null).ok,V('x').ok,V([]).ok,V(7).ok], [false,false,false,false]);
eq('says so', errs(null), ['That is not an area: expected an object.']);
const mut=(f)=>{const o=pack();f(o);return errs(o);};
ok('an unknown field', has(mut(o=>{o.colour='teal';}),'Unknown field "colour".'));
ok('a bad id', has(mut(o=>{o.id='Rowing Tech';}),'"id" must be 2 to 24 lowercase'));
ok('an id that exists', has(errs(pack(),{taken:['rowing']}),'There is already an area with the id "rowing".'));
ok('a one-letter name', has(mut(o=>{o.name='R';}),'"name" must be 2 to 40 characters'));
ok('a name of only symbols', has(mut(o=>{o.name='!!!';}),'at least one letter or digit'));
ok('a long short name', has(mut(o=>{o.short='Rowing technique';}),'"short" must be 1 to 13'));
ok('min above target', has(mut(o=>{o.perWeek={min:4,target:3,max:4};}),'"perWeek" needs whole numbers'));
ok('max above 7', has(mut(o=>{o.perWeek={min:2,target:3,max:9};}),'"perWeek" needs whole numbers'));
ok('a fractional target', has(mut(o=>{o.perWeek={min:2,target:2.5,max:4};}),'"perWeek" needs whole numbers'));
ok('nominal below the target', has(mut(o=>{o.perWeek={min:2,target:3,max:4,nominalTarget:2};}),'nominalTarget'));
ok('a gap of 0', has(mut(o=>{o.minGapDays=0;}),'"minGapDays"'));
ok('a block of 2 minutes', has(mut(o=>{o.minutes=2;}),'"minutes"'));
ok('a load that is not low, medium or high', has(mut(o=>{o.load='heavy';}),'"load" must be low, medium or high.'));
ok('an order that is not in the day', has(mut(o=>{o.order='evening';}),'"order" must be one of: power, skill, strength, mobility, kettlebell.'));
ok('a body area that does not exist', has(mut(o=>{o.guardedBy=['ear'];}),'"guardedBy" must list body areas from:'));
ok('no stages', has(mut(o=>{o.stages=[];}),'"stages" must be a list of 1 to 12 stages.'));
ok('thirteen stages', has(mut(o=>{o.stages=Array.from({length:13},(_,i)=>Object.assign({},pack().stages[0],{id:'S'+(i+1)}));}),'1 to 12 stages'));
ok('a stage id used twice', has(mut(o=>{o.stages[1].id='R1';}),'the id is used twice.'));
ok('a stage with nothing to say', has(mut(o=>{o.stages[0].work='';}),'Stage R1: "work" must say what the stage trains.'));
ok('a stage with no standard', has(mut(o=>{o.stages[0].ready=[];}),'Stage R1: "ready" must list'));
ok('a vague standard', has(mut(o=>{o.stages[0].ready=['same'];}),'"ready" must list'));
ok('askAfter under a week of the area', has(mut(o=>{o.stages[0].askAfter=2;}),'under one week of the area (3 days)'));
ok('two goals', has(mut(o=>{o.stages[0].goal=true;}),'Only one stage can be the goal.'));
ok('a stage with no exercises', has(mut(o=>{delete o.stages[0].exercises;}),'Stage R1: needs at least one exercise'));
ok('an empty list of exercises', has(mut(o=>{o.stages[0].exercises=[];}),'needs at least one exercise'));
ok('sets of 0', has(mut(o=>{o.stages[0].exercises[0].sets=0;}),'exercise "drill": "sets" must be a whole number from 1 to 30.'));
ok('reps as a number', has(mut(o=>{o.stages[0].exercises[0].reps=5;}),'"reps" must be text'));
ok('a negative rest', has(mut(o=>{o.stages[0].exercises[0].restSec=-5;}),'"restSec"'));
ok('an unknown load', has(mut(o=>{o.stages[0].exercises[0].load={type:'stones'};}),'"load.type" must be one of:'));
ok('an exercise id used twice', has(mut(o=>{o.stages[0].exercises[1].id='drill';}),'the id is used twice in this stage.'));
ok('an exercise field that is not one', has(mut(o=>{o.stages[0].exercises[0].video='x';}),'exercise "drill": unknown field "video".'));
ok('a type the area does not have', has(mut(o=>{o.stages[0].exercises[0].type='heavy';}),'must be one of the area’s sessionTypes'));
ok('some typed, some not', has(mut(o=>{o.sessionTypes=['a'];o.stages[0].exercises[0].type='a';}),'either every exercise has a "type" or none does'));
ok('equipment that is not in the list', has(mut(o=>{o.stages[0].equipment=['jetpack'];}),'unknown equipment "jetpack". Known:'));
ok('bells that are not pairs', has(mut(o=>{o.stages[0].bells=[{kg:16}];}),'"bells" must list'));
ok('a prerequisite stage that does not exist', has(mut(o=>{o.stages[1].requires=[{area:'pistol',stage:'P9'}];}),'asks for pistol P9, which does not exist.'));
ok('a stage field that is not one', has(mut(o=>{o.stages[0].video='x';}),'Stage R1: unknown field "video".'));
ok('a tracked area with a ladder', has(errs(Object.assign(pack(),{track:true})),'A tracked area has no stages.'));
ok('every problem is reported, not just the first', mut(o=>{o.id='X';o.name='';o.minutes=1;o.stages[0].exercises[0].sets=0;}).length>=4);

console.log('and what it only mentions:');
let w=V((()=>{const o=pack();o.stages[0].exercises=[{id:'long',name:'A very long piece',sets:20,reps:'5 min',restSec:120,load:{type:'none'}}];return o;})()).warnings;
ok('a block far from the minutes you gave', w.length===1&&w[0].startsWith('Stage R1: the exercises add up to about'));
w=V((()=>{const o=pack();o.stages[1].requires=[{area:'unicycle',stage:'U2'}];return o;})()).warnings;
eq('a prerequisite from an area you do not have is advice, not an error', [V(pack()).ok, w.length, w[0].includes('unicycle')], [true,1,true]);
eq('a prerequisite from one you do', V((()=>{const o=pack();o.stages[1].requires=[{area:'pistol',stage:'P3'}];return o;})()).warnings, []);

console.log('adding one of your own:');
fresh();
const r1=ctx.addCustomArea(pack());
eq('it goes in', [r1.ok, r1.area.id, r1.area.custom], [true,'rowing',true]);
eq('after the eight, with the next priority', [ctx.areaList().length, ctx.areaById('rowing').priority], [9,9]);
eq('and it is kept with your data', [JSON.parse(store.customAreas).length, JSON.parse(store.customAreas)[0].id, 'custom' in JSON.parse(store.customAreas)[0]], [1,'rowing',false]);
eq('the same id again is refused', (r=>[r.ok,r.errors[0]])(ctx.addCustomArea(pack())), [false,'There is already an area with the id "rowing".']);
eq('so is the id of one of the eight', ctx.addCustomArea(Object.assign(pack(),{id:'mu'})).ok, false);
eq('nothing was added by the refusals', [ctx.customAreas.length, ctx.areaList().length], [1,9]);
const second=Object.assign(pack(),{id:'sculling',name:'Sculling',priority:1});
second.stages=pack().stages;
ctx.addCustomArea(second);
eq('a pack that asks to come first among yours does, but still after the eight', ctx.areaList().slice(8).map(a=>[a.id,a.priority]), [['sculling',9],['rowing',10]]);
eq('the eight are untouched', ctx.areaList().slice(0,8).map(a=>a.id), idx.areas);
ok('a whole ladder works like the others: a stage, exercises and a draft flag that is its own', ctx.areaById('rowing').stages.length===2&&!ctx.currentStage(ctx.areaById('rowing')).draft);

console.log('something you only track:');
fresh();
const form={name:'Morning run',perWeek:3,minutes:30,order:'power',guardedBy:['knee','achilles']};
const raw=ctx.trackedAreaFrom(form);
eq('the form becomes an area: min one less, max one more, two days apart at 3 a week or fewer', [raw.id,raw.track,raw.perWeek,raw.minGapDays], ['morning-run',true,{min:2,target:3,max:4},2]);
eq('five days a week: daily is fine', (r=>[r.perWeek,r.minGapDays])(ctx.trackedAreaFrom({name:'Walk',perWeek:5,minutes:20})), [{min:4,target:5,max:6},1]);
eq('one a week: min 1, max 2', ctx.trackedAreaFrom({name:'Swim',perWeek:1,minutes:40}).perWeek, {min:1,target:1,max:2});
eq('seven a week stops at seven', ctx.trackedAreaFrom({name:'Stretch',perWeek:7,minutes:10}).perWeek, {min:6,target:7,max:7});
const rt=ctx.addCustomArea(raw);
eq('it is accepted', [rt.ok, rt.warnings], [true,[]]);
const run=ctx.areaById('morning-run');
eq('with one stage and one thing to do', [run.stages.length, run.stages[0].id, run.stages[0].exercises.map(e=>[e.id,e.sets])], [1,'T1',[['done',1]]]);
eq('and the kind of work and what it could hurt', [run.order, run.guardedBy, run.load], ['power',['knee','achilles'],'medium']);
eq('stored without the stage it is given at load', JSON.parse(store.customAreas)[0].stages, undefined);
ctx.freezeAreaDay('2026-10-06','morning-run');
const rs=ctx.sessionById('2026-10-06:morning-run');
ok('a day of it is a session like any other', rs&&rs.exercises.length===1&&ctx.totalSets(rs)===1);
ctx.writeLog(rs.id,'done',0,{done:true});
eq('one tick is a full day', ctx.areaDays().filter(r=>r.area==='morning-run').map(r=>[r.date,r.full]), [['2026-10-06',true]]);
eq('and counts in its week', ctx.areaWeek(run,'2026-10-05','2026-10-07',ctx.areaDays()).touched, 1);
eq('it has no review to ask for', [ctx.stageProgress(run,ctx.areaDays()).phase, ctx.stageProgress(run,ctx.areaDays()).due], ['top',false]);
ctx.checkIns=[{date:'2026-10-05',pain:{knee:8},stiffness:'none'}];
eq('a red knee pauses it, since you said it can hurt the knee', ctx.heldReason(run,'2026-10-06'), 'knee red');
ctx.checkIns=[];
ctx.todayISO=()=>'2026-10-07';
const rec7=ctx.recommendFor('2026-10-07',[60],ctx.areaDays());
ok('the recommender considers it with the rest', 'morning-run' in rec7.lines);
eq('a name that is only symbols is refused', ctx.addCustomArea(ctx.trackedAreaFrom({name:'!!!',perWeek:2,minutes:20})).ok, false);
eq('a name that would clash with one of the eight gets a free id instead', ctx.trackedAreaFrom({name:'MU',perWeek:2,minutes:20}).id, 'mu-2');
eq('and one starting with a digit', ctx.trackedAreaFrom({name:'5k run',perWeek:2,minutes:30}).id, 'area-5k-run');
eq('a long name is cut to a usable id', ctx.trackedAreaFrom({name:'A very very long name for an exercise nobody does',perWeek:2,minutes:30}).id.length<=24, true);
ctx.areaData.rules.dayOrder;

console.log('taking it away, and bringing it back:');
eq('removed', [ctx.removeCustomArea('morning-run'), ctx.areaById('morning-run'), ctx.areaList().length], [true,null,8]);
eq('and from storage', JSON.parse(store.customAreas), []);
eq('removing what is not there', ctx.removeCustomArea('morning-run'), false);
eq('the days stay in the logs but count for nothing now', [ctx.setLogs.some(l=>l.sessionId==='2026-10-06:morning-run'), ctx.areaDays().some(r=>r.area==='morning-run')], [true,false]);
ctx.addCustomArea(raw);
eq('add it back and they count again', ctx.areaDays().filter(r=>r.area==='morning-run').length, 1);

console.log('a stored area that no longer passes is skipped, not lost:');
fresh();
ctx.customAreas=[{id:'broken',name:'B',track:true,perWeek:{min:1,target:1,max:1},minGapDays:1,minutes:20,load:'low',order:'skill',guardedBy:[]},ctx.trackedAreaFrom({name:'Climbing',perWeek:2,minutes:60})];
ctx.mergeCustomAreas();
eq('only the good one joins', ctx.areaList().slice(8).map(a=>a.id), ['climbing']);
eq('and the other is reported with its reasons', ctx.areaData.skipped.map(s=>[s.id,s.errors.length>0]), [['broken',true]]);
eq('it is still stored', ctx.customAreas.map(a=>a.id), ['broken','climbing']);
ctx.customAreas.push(JSON.parse(JSON.stringify(ctx.customAreas[1])));
ctx.mergeCustomAreas();
eq('a clash between two stored ones: the first wins and the second is reported', [ctx.areaList().slice(8).map(a=>a.id), ctx.areaData.skipped.map(s=>s.id)], [['climbing'],['broken','climbing']]);

console.log('names for things:');
eq('a name to a short name', [ctx.shortNameOf('Morning run'),ctx.shortNameOf('Kettlebell swings'),ctx.shortNameOf('Extraordinarily'),ctx.shortNameOf('')], ['Morning','Kettlebell','Extraordinari','']);
eq('a name to an id', [ctx.slugOf('Morning run!'),ctx.slugOf('  Hill   sprints '),ctx.slugOf('10k'),ctx.slugOf('')], ['morning-run','hill-sprints','area-10k','area']);

console.log('storage and backup:');
fresh();
ctx.addCustomArea(ctx.trackedAreaFrom({name:'Climbing',perWeek:2,minutes:60}));
ctx.customAreas=[]; ctx.loadCustomAreas();
eq('survives a reload', ctx.customAreas.map(a=>a.id), ['climbing']);
store.customAreas='[null,1,"x",{"id":5},{"id":"ok"},[]]'; ctx.loadCustomAreas();
eq('junk in storage is dropped', ctx.customAreas.map(a=>a.id), ['ok']);
store.customAreas='not json'; {const w=console.warn; console.warn=()=>{}; ctx.loadCustomAreas(); console.warn=w;}
eq('unreadable storage is an empty list', ctx.customAreas, []);
fresh(); ctx.addCustomArea(pack());
eq('exported', ctx.exportPayload().customAreas.map(a=>a.id), ['rowing']);
ok('a backup carrying them is accepted', !ctx.inspectBackup(JSON.stringify({setLogs:[],customAreas:[pack()]})).error);
ok('as an object it is refused', !!ctx.inspectBackup('{"customAreas":{}}').error);
Object.keys(store).forEach(k=>delete store[k]); store.customAreas=JSON.stringify([pack()]);
ctx.writeBackup({setLogs:[{sessionId:'W2-Mon'}]});
eq('logs without them (an older file) leave your areas alone: they are definitions, not history', store.customAreas, JSON.stringify([pack()]));
ctx.writeBackup({setLogs:[],customAreas:[]});
eq('a file that has them replaces them', store.customAreas, '[]');
eq('a restore reads them and puts them in the list', (store.customAreas=JSON.stringify([pack()]), ctx.loadCustomAreas(), ctx.mergeCustomAreas(), ctx.areaById('rowing')!==null), true);

console.log('the add-area screens draw (the fake DOM cannot be read):');
const draws=(f)=>{try{f();return true;}catch(e){console.log('   ',String(e.stack).split('\n').slice(0,3).join(' | '));return false;}};
fresh(); ctx.todayISO=()=>'2026-10-07';
ok('the first sheet, the track form and the pack picker', draws(()=>{ctx.openAddAreaSheet();ctx.openTrackForm();}));
ok('a pack that is not JSON', draws(()=>ctx.reviewPack('not json')));
ok('a pack that fails, with many problems', draws(()=>ctx.reviewPack(JSON.stringify({id:'X',name:'',stages:[]}))));
ok('a pack that passes, with a warning', draws(()=>{const o=pack();o.stages[0].exercises=[{id:'long',name:'A very long piece',sets:20,reps:'5 min',restSec:120,load:{type:'none'}}];ctx.reviewPack(JSON.stringify(o));}));
ok('a pack that passes', draws(()=>ctx.reviewPack(JSON.stringify(pack()))));
eq('looking at one does not add it', ctx.customAreas.length, 0);
ok('the problem sheet with more than it shows', draws(()=>ctx.showPackProblems(Array.from({length:14},(_,i)=>'Problem '+i))));
ctx.addCustomArea(ctx.trackedAreaFrom({name:'Morning run',perWeek:3,minutes:30,order:'power',guardedBy:['knee']}));
ctx.addCustomArea(pack());
const days0=ctx.areaDays();
ok('the Areas tab, with both kinds', draws(()=>ctx.renderAreas()));
ok('a card for each, tracked and laddered', draws(()=>{ctx.areaCard(ctx.areaById('morning-run'),days0);ctx.areaCard(ctx.areaById('rowing'),days0);}));
ok('each area page', draws(()=>{ctx.renderAreaDetail('morning-run');ctx.renderAreaDetail('rowing');}));
ok('the review of a tracked area says there is none, and of a pack area works', draws(()=>{ctx.renderReview('morning-run');ctx.renderReview('rowing');}));
ctx.freezeAreaDay('2026-10-07','morning-run'); ctx.freezeAreaDay('2026-10-07','rowing');
const dp={sittings:[{minutes:60,areas:['morning-run','rowing']}],suggested:['morning-run','rowing'],removed:{},why:{}};
ok('Today with a tracked area and a pack area on the menu', draws(()=>{ctx.dayPlans['2026-10-07']=dp;ctx.todaySessions=[];ctx.renderToday();}));
ok('a tracked area’s day card has "Mark done"', draws(()=>ctx.areaDayCard('2026-10-07',0,'morning-run',dp,false)));
eq('marking it done (what the button does) makes it a full day', (ctx.logAreaBlock('2026-10-07','morning-run'), ctx.areaDays().filter(r=>r.area==='morning-run'&&r.full).length), 1);
ctx.customAreas.push({id:'broken',name:'B',track:true,perWeek:{min:1,target:1,max:1},minGapDays:1,minutes:20,load:'low',order:'skill',guardedBy:[]});
ctx.mergeCustomAreas();
ok('a stored area that cannot load is listed with a way to clear it', draws(()=>{ctx.skippedAreasNote();ctx.renderAreas();}));
eq('and when nothing is wrong there is no note', (ctx.removeCustomArea('broken'), ctx.skippedAreasNote()), null);
ok('the sweep of every screen with custom areas present', draws(()=>{ctx.renderAreas();ctx.renderProgress();ctx.renderCheckIn();ctx.renderToday();}));
ok('and the recommender with them', draws(()=>ctx.recommendFor('2026-10-07',[60],ctx.areaDays())));
ok('and the feedback for them', draws(()=>{ctx.areaFeedback(ctx.areaById('morning-run'),'2026-10-26',ctx.areaDays());ctx.nudgesFor('2026-10-26',ctx.areaDays());ctx.weekStrip('2026-10-26',ctx.areaDays());}));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
