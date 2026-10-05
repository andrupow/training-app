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
const lb=()=>{ctx.settings={units:'lb'};}, kg=()=>{ctx.settings={};};

console.log('kg is the default, and what is stored:');
kg();
eq('usesLb is off with nothing set', ctx.usesLb(), false);
eq('a weight reads in kg', ctx.fmtWeight(5), '5 kg');
eq('and keeps its decimals', ctx.fmtWeight(18.75), '18.75 kg');
eq('the input shows kg as stored', ctx.toDisplayWeight(12.5), 12.5);
eq('and kg goes straight back', ctx.fromDisplayWeight(12.5), 12.5);
eq('the unit is kg', ctx.unitName(), 'kg');
eq('the load limit is the stored one', ctx.loadLimitInUnit().max, 250);
ctx.settings={units:'stone'};
eq('anything but lb counts as kg', [ctx.usesLb(), ctx.fmtWeight(5), ctx.unitName()], [false, '5 kg', 'kg']);

console.log('in pounds, to the nearest half:');
lb();
eq('usesLb is on', ctx.usesLb(), true);
eq('5 kg is 11 lb', ctx.fmtWeight(5), '11 lb');
eq('16 kg is 35.5 lb', ctx.fmtWeight(16), '35.5 lb');
eq('20 kg is 44 lb', ctx.fmtWeight(20), '44 lb');
eq('zero reads as 0 lb', ctx.fmtWeight(0), '0 lb');
eq('the input shows pounds', ctx.toDisplayWeight(20), 44);
eq('44 lb stores as about 19.96 kg', ctx.fromDisplayWeight(44), 19.96);
eq('the unit is lb', ctx.unitName(), 'lb');
eq('the load limit is 551 lb', [ctx.loadLimitInUnit().max, ctx.loadLimitInUnit().unit], [551, ' lb']);
eq('the load limit keeps its key and label', [ctx.loadLimitInUnit().key, ctx.loadLimitInUnit().label], ['loadKg', 'Load']);
const ok2 = (l,c)=>eq(l,!!c,true);
ok2('a round trip stays within half a pound', [1,2.5,5,7.5,10,12.5,16,20,24,32,48,100].every(k=>Math.abs(ctx.fromDisplayWeight(ctx.toDisplayWeight(k))-k)<=0.25/2.20462+0.01));

console.log('the set sheet check, in pounds:');
eq('500 lb is fine', ctx.checkSetValue('500', ctx.loadLimitInUnit()), {value: 500});
eq('552 lb is refused, in pounds', ctx.checkSetValue('552', ctx.loadLimitInUnit()), {error: 'Load has to be between 0 and 551 lb.'});
eq('blank still means as planned', ctx.checkSetValue('', ctx.loadLimitInUnit()), {value: undefined});
kg();
eq('the same 552 is fine in kg', ctx.checkSetValue('250', ctx.loadLimitInUnit()), {value: 250});
eq('and 251 kg is refused in kg', ctx.checkSetValue('251', ctx.loadLimitInUnit()), {error: 'Load has to be between 0 and 250 kg.'});
eq('the stored limits are not changed by looking', ctx.SET_LIMITS[0], {key:'loadKg',label:'Load',unit:' kg',min:0,max:250});
lb(); ctx.loadLimitInUnit(); kg();
eq('even after asking in pounds', ctx.SET_LIMITS[0].max, 250);

console.log('every place a load is written:');
ctx.baselines=[{date:'2026-09-01',bodyweightKg:80,pullup5RMAddedKg:20}];
kg();
eq('a fixed load, kg', ctx.resolveLoad({type:'fixedKg',value:5},'2026-09-10').text, '+5 kg');
eq('a % of 5RM, kg', ctx.resolveLoad({type:'pct5RM',value:0.5},'2026-09-10').text, '+10 kg');
eq('a % of bodyweight, kg (rounded to a plate)', ctx.resolveLoad({type:'pctBW',value:0.1},'2026-09-10').text, '+7.5 kg');
eq('a logged set, kg', ctx.setBits({loadKg:12.5,reps:5,rpe:8}), ['12.5 kg','5 reps','RPE 8']);
eq('the rule for a fixed load, kg', ctx.ruleText({type:'fixedKg',value:5}), '+5 kg');
lb();
eq('a fixed load, lb', ctx.resolveLoad({type:'fixedKg',value:5},'2026-09-10').text, '+11 lb');
eq('a % of 5RM, lb', ctx.resolveLoad({type:'pct5RM',value:0.5},'2026-09-10').text, '+22 lb');
eq('a % of bodyweight, lb', ctx.resolveLoad({type:'pctBW',value:0.1},'2026-09-10').text, '+16.5 lb');
eq('the number the app plans with is still kg', ctx.resolveLoad({type:'pct5RM',value:0.5},'2026-09-10').kg, 10);
eq('a missing baseline reads the same in either unit', ctx.resolveLoad({type:'pctBW',value:0.1},'2020-01-01').text, '— set baselines');
eq('words and bodyweight are untouched', [ctx.resolveLoad({type:'bodyweight'},'2026-09-10').text, ctx.resolveLoad({type:'text',text:'Medium band'},'2026-09-10').text], ['Bodyweight','Medium band']);
eq('a logged set, lb', ctx.setBits({loadKg:12.5,reps:1,rpe:8}), ['27.5 lb','1 rep','RPE 8']);
eq('a set with no load shows none', ctx.setBits({reps:5}), ['5 reps']);
eq('the rule for a fixed load, lb', ctx.ruleText({type:'fixedKg',value:5}), '+11 lb');
eq('the rule for a percent is unchanged', ctx.ruleText({type:'pct5RM',value:0.5}), '50% of 5RM added');

console.log('the switch itself does not touch what is stored:');
ctx.setLogs=[{sessionId:'s',exerciseId:'e',setIdx:0,done:true,loadKg:20,reps:5,ts:'2026-09-10T10:00:00Z'}];
const before=JSON.stringify(ctx.setLogs);
lb(); ctx.setBits(ctx.setLogs[0]); kg();
eq('a logged set is still in kg', JSON.stringify(ctx.setLogs), before);
eq('a fresh install is in kg', (()=>{ctx.settings={};return ctx.usesLb();})(), false);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
