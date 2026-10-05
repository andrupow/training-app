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
const loaded={rules:read('data/rules.json'),legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};
ctx.plan=JSON.parse(fs.readFileSync('data/plan.json','utf8'));
const ci=(date,pain,stiff)=>({date,pain:Object.assign({},pain),stiffness:stiff||'none'});
const OLD=(date,pain,stiff)=>({date,pain:Object.assign({elbow:0,shoulder:0,achilles:0,hamstring:0},pain),stiffness:stiff||'none'});   // what the app wrote before
const reset=()=>{ctx.setLogs=[];ctx.logIndex={};ctx.dayPlans={};ctx.frozenDays={};ctx.checkIns=[];ctx.schedule={};ctx.settings={};ctx.weekFits={};};
ctx.areaData=null; reset();

console.log('which body areas are asked:');
eq('before the area data is in (or if it never loads): the old four', ctx.areas(), ['elbow','shoulder','achilles','hamstring']);
ctx.areaData=loaded;
eq('once it is in: seven, in the rules’ order', ctx.areas(), ['elbow','shoulder','wrist','lowerBack','knee','hamstring','achilles']);
eq('with words for each', ctx.areas().map(ctx.bodyLabel), ['Medial elbow','Shoulder','Wrist','Lower back','Knee','Hamstring','Achilles']);
eq('and the old labels still serve before the data is in', (ctx.areaData=null, ['wrist','lowerBack','knee'].map(ctx.bodyLabel)), ['Wrist','Lower back','Knee']);
ctx.areaData=loaded;

console.log('older check-ins are untouched:');
const old=OLD('2026-10-03',{elbow:4,hamstring:8},'under30');
eq('they read 0 for the three new areas', ['wrist','lowerBack','knee'].map(b=>ctx.painOf(old,b)), [0,0,0]);
let st=ctx.areaStates(old,[]);
eq('the four they had keep their verdicts', [st.elbow,st.shoulder,st.achilles,st.hamstring], ['amber','green','green','red']);
eq('and the new three are simply green', [st.wrist,st.lowerBack,st.knee], ['green','green','green']);
eq('the worst of them is what it always was', ctx.worstState(st), 'red');
eq('an old check-in summarises without inventing anything', ctx.painSummary(old), 'Medial elbow 4 · Hamstring 8');
eq('and one with no pain says so', ctx.painSummary(OLD('2026-10-04',{})), 'no pain');
eq('a new one lists what hurts, in order', ctx.painSummary(ci('2026-10-05',{wrist:3,knee:6})), 'Wrist 3 · Knee 6');

console.log('what each body area guards (from the area files):');
eq('elbow: muscle-up and one-arm together, as the plan says', ctx.guardedAreas('elbow').map(a=>a.id), ['mu','oap']);
eq('wrist', ctx.guardedAreas('wrist').map(a=>a.id), ['mu','hspu','bridge']);
eq('lower back', ctx.guardedAreas('lowerBack').map(a=>a.id), ['bridge','kb']);
eq('knee', ctx.guardedAreas('knee').map(a=>a.id), ['pistol','nordic','plyo']);
eq('Achilles stays with plyometrics', ctx.guardedAreas('achilles').map(a=>a.id), ['plyo']);
eq('hamstring', ctx.guardedAreas('hamstring').map(a=>a.id), ['nordic','kb']);
eq('amber says what it holds', ctx.consequenceText('elbow','amber'), 'Holds Muscle-up, One-arm');
eq('red says what it pauses', ctx.consequenceText('knee','red'), 'Pauses Pistol, Nordic, Plyo');
ctx.areaData=null;
eq('before the areas are in it falls back to the old plan’s tracks', ctx.consequenceText('elbow','amber'), 'pull-up, dips');
ctx.areaData=loaded;

console.log('a red light pauses the areas it guards, and only those:');
const TODAY='2026-10-08';
const pausedBy=(pain,date)=>{ ctx.checkIns=[ci('2026-10-07',pain)]; return ctx.areaList().filter(a=>ctx.heldReason(a,date||TODAY)).map(a=>a.id); };
eq('knee 7: pistol, Nordic and plyometrics', pausedBy({knee:7}), ['pistol','nordic','plyo']);
eq('wrist 7: muscle-up, HSPU and the bridge', pausedBy({wrist:7}), ['mu','hspu','bridge']);
eq('lower back 7: the bridge and the kettlebell', pausedBy({lowerBack:7}), ['bridge','kb']);
eq('Achilles 7: plyometrics only', pausedBy({achilles:7}), ['plyo']);
eq('elbow 7: muscle-up and one-arm', pausedBy({elbow:7}), ['mu','oap']);
eq('shoulder 7: muscle-up, HSPU, the bridge... everything that loads it', pausedBy({shoulder:7}), ['mu','hspu','bridge','kb','oap']);
eq('pain 5 is amber, not red: nothing is paused', pausedBy({knee:5}), []);
eq('the reason names the body area', (ctx.checkIns=[ci('2026-10-07',{knee:7})], ctx.heldReason(ctx.areaById('pistol'),TODAY)), 'knee red');
eq('seven days from the check-in, then it lifts', [ctx.heldReason(ctx.areaById('pistol'),'2026-10-13'), ctx.heldReason(ctx.areaById('pistol'),'2026-10-14')], ['knee red', null]);
eq('red on the knee is seen by the red-light table the old plan uses', Object.keys(ctx.redAreasOn(TODAY)), ['knee']);
ctx.checkIns=[ci('2026-10-07',{},'over60')];
eq('a morning stiff for over an hour is red for every body area, as it always was: all eight areas paused', ctx.areaList().filter(a=>ctx.heldReason(a,TODAY)).length, 8);

console.log('amber holds, it does not pause:');
ctx.checkIns=[ci('2026-10-07',{wrist:4})];
eq('amber wrist holds muscle-up, HSPU and the bridge', ctx.areaList().filter(a=>ctx.holdReason(a,TODAY)).map(a=>a.id), ['mu','hspu','bridge']);
eq('none of them is held', ctx.areaList().filter(a=>ctx.heldReason(a,TODAY)).length, 0);
ctx.checkIns=[ci('2026-10-07',{knee:4})];
eq('amber knee holds pistol, Nordic and plyometrics, saying why', [ctx.holdReason(ctx.areaById('pistol'),TODAY), ctx.holdReason(ctx.areaById('mu'),TODAY)], ['knee amber', null]);

console.log('and the recommender honours it:');
ctx.checkIns=[ci('2026-10-07',{knee:7})];
const days=[];
let r=ctx.recommendFor(TODAY,[90],days);
ok('pistol, Nordic and plyometrics are not on the menu', ['pistol','nordic','plyo'].every(id=>r.picked.indexOf(id)<0));
eq('each says it is held for the knee', ['pistol','nordic','plyo'].map(id=>r.lines[id].why), ['Held: knee red.','Held: knee red.','Held: knee red.']);
ok('and something else is recommended instead', r.picked.length>0);
ctx.checkIns=[ci('2026-10-07',{wrist:7})];
r=ctx.recommendFor(TODAY,[90],days);
ok('a red wrist leaves muscle-up, HSPU and the bridge off', ['mu','hspu','bridge'].every(id=>r.picked.indexOf(id)<0));

console.log('the screen draws, with and without the areas:');
ctx.checkIns=[old,ci('2026-10-05',{wrist:3,knee:6})];
ok('check-in with seven areas', (()=>{try{ctx.renderCheckIn();return true;}catch(e){console.log(e.stack.split('\n').slice(0,3).join('|'));return false;}})());
ok('each history row, old and new', ctx.checkIns.every(c=>{try{ctx.checkInRow(c);return true;}catch(e){return false;}}));
ctx.areaData=null;
ok('and with the old four, if the area data never loads', (()=>{try{ctx.renderCheckIn();return true;}catch(e){return false;}})());
ctx.areaData=loaded;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
