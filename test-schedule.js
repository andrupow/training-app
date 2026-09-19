const fs=require('fs'), vm=require('vm');
const store={}; const noop=()=>{};
const fakeNode=new Proxy({},{get(t,k){if(['appendChild','addEventListener','remove','focus','setAttribute','removeAttribute','scrollIntoView','click'].includes(k))return noop;if(k==='querySelector'||k==='querySelectorAll')return()=>fakeNode;if(k==='childNodes'||k==='classList')return[];if(k==='style')return{};return'';},set(){return true;}});
const sandbox={console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,Blob:class{},URL:{createObjectURL:()=>'blob:x',revokeObjectURL:noop},
 localStorage:{getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
 fetch:()=>Promise.reject(new Error('x')),navigator:{},location:{hash:'',protocol:'http:',replace:noop},
 document:{createElement:()=>fakeNode,createTextNode:()=>fakeNode,getElementById:()=>fakeNode,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop,removeEventListener:noop,body:fakeNode},
 window:{addEventListener:noop,scrollTo:noop,scrollY:0,matchMedia:()=>({matches:false})}};
sandbox.globalThis=sandbox; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('app.js','utf8'),sandbox);
const ctx=sandbox;
ctx.plan=JSON.parse(fs.readFileSync('data/plan.json','utf8'));
ctx.baselines=[{date:'2026-09-01',bodyweightKg:78,pullup5RMAddedKg:20}];

let pass=0,fail=0;
function eq(l,g,w){const ok=JSON.stringify(g)===JSON.stringify(w);if(ok)pass++;else{fail++;console.log(`  FAIL ${l}\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`);}}
function ok(l,c){if(c)pass++;else{fail++;console.log(`  FAIL ${l}`);}}

const reset=()=>{ctx.schedule={};};
const D=id=>ctx.sessionDate(ctx.sessionById(id));
/* W6: Mon 19 Oct .. Fri 23 Oct */
const week6=['W6-Mon','W6-Tue','W6-Wed','W6-Thu','W6-Fri'];
const dates=()=>week6.map(D);

console.log('baseline (untouched plan):');
reset();
eq('W6 dates', dates(), ['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23']);
eq('nothing moved', ctx.movedCount(), 0);

console.log('swap: two days trade places, nothing else moves');
reset();
ctx.rescheduleSwap('W6-Mon','2026-10-21');      // do Monday's session on Wednesday
eq('dates', dates(), ['2026-10-21','2026-10-20','2026-10-19','2026-10-22','2026-10-23']);
eq('two rows moved', ctx.movedCount(), 2);
eq('Mon now on Wed', D('W6-Mon'), '2026-10-21');
eq('Wed now on Mon', D('W6-Wed'), '2026-10-19');
ok('nothing outside the pair touched', D('W6-Tue')==='2026-10-20' && D('W6-Fri')==='2026-10-23');
console.log('  swapping back restores the plan exactly:');
ctx.rescheduleSwap('W6-Mon','2026-10-19');
eq('restored', dates(), ['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23']);
eq('overrides cleared', ctx.movedCount(), 0);

console.log('push: target session takes the slot, the rest slide one later');
reset();
ctx.reschedulePush('W6-Wed','2026-10-19');      // pull Wednesday forward to Monday
eq('Wed takes Mon slot', D('W6-Wed'), '2026-10-19');
eq('Mon slides to Tue', D('W6-Mon'), '2026-10-20');
eq('Tue slides to Wed', D('W6-Tue'), '2026-10-21');
ok('nothing lost', new Set(week6.map(D)).size === 5);
console.log('  the slot the source vacated absorbs the shift, so nothing');
console.log('  beyond its old position moves and the block does not extend:');
eq('Thu unchanged', D('W6-Thu'), '2026-10-22');
eq('Fri unchanged', D('W6-Fri'), '2026-10-23');
eq('next week unchanged', D('W7-Mon'), '2026-10-26');
eq('only two rows moved', ctx.movedCount(), 3);   /* Wed + Mon + Tue */

console.log('  pulling in a session from BEFORE the target does extend it:');
reset();
const lastBefore = ctx.sessionsByDate()[ctx.plan.sessions.length-1];
ctx.reschedulePush('W5-Mon','2026-10-19');        /* 12 Oct -> 19 Oct */
eq('W5-Mon took the slot', D('W5-Mon'), '2026-10-19');
ok('the block now runs one slot later', D(lastBefore.id) > lastBefore.date);

console.log('push does not disturb anything before the target:');
reset();
ctx.reschedulePush('W6-Wed','2026-10-21');
eq('W2 untouched', D('W2-Mon'), '2026-09-21');
eq('W6-Mon untouched', D('W6-Mon'), '2026-10-19');

console.log('skip: the occupant is abandoned, nothing else moves');
reset();
ctx.rescheduleSkip('W6-Fri','2026-10-19');
eq('Fri moved to Mon', D('W6-Fri'), '2026-10-19');
ok('Mon is skipped', ctx.isSkipped(ctx.sessionById('W6-Mon')));
eq('Tue untouched', D('W6-Tue'), '2026-10-20');
console.log('  a skipped session is not "today" and is not "next":');
ctx.todayISO=()=>'2026-10-19';
eq('next skips it', ctx.nextSession().id, 'W6-Fri');
ok('skipped is not moved', !ctx.isMoved(ctx.sessionById('W6-Mon')));

console.log('moving across a recalibration uses the day you TRAIN it:');
reset();
/* W8-Mon is 2 Nov, before the 6 Nov retest. Move it to 9 Nov, after. */
ctx.baselines=[{date:'2026-09-01',bodyweightKg:78,pullup5RMAddedKg:20},
               {date:'2026-11-06',bodyweightKg:79,pullup5RMAddedKg:26}];
const s8=ctx.sessionById('W8-Mon');
const pull=s8.exercises.find(e=>e.track==='pullup');
const before=ctx.resolveLoad(pull.load, ctx.sessionDate(s8)).text;
ctx.rescheduleSwap('W8-Mon','2026-11-09');
const after=ctx.resolveLoad(pull.load, ctx.sessionDate(s8)).text;
eq('scheduled date used the old 5RM', before, '+13.75 kg');   // 0.7 x 20 = 14 -> 13.75
eq('trained date uses the new 5RM', after, '+18.75 kg');      // 0.7 x 26 = 18.2 -> 18.75
ok('the move actually changed the load', before !== after);

console.log('gating follows the day you train it:');
reset();
ctx.checkIns=[{date:'2026-10-20',pain:{elbow:0,shoulder:0,achilles:0,hamstring:8},stiffness:'none'}];
const tue=ctx.sessionById('W6-Tue');            // 20 Oct, inside the red window
ok('suppressed on the red day', Object.keys(ctx.sessionGate(tue).suppressed).length > 0);
ctx.rescheduleSwap('W6-Tue','2026-11-02');      // move it well past the 7 days
eq('clear once moved out of the window', ctx.sessionGate(tue).suppressed, {});

console.log('week identity survives a move (deliberate):');
eq('still W6', tue.week, 'W6');
eq('still gated by W5', ctx.sessionGate(tue).prevWeek.id, 'W5');

console.log('reset puts everything back:');
ctx.resetSchedule();
eq('no overrides', ctx.movedCount(), 0);
eq('W6 back to plan', dates(), ['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23']);

console.log('schedule rides along in the backup:');
reset();
ctx.rescheduleSwap('W6-Mon','2026-10-21');
const payload=ctx.exportPayload();
ok('schedule exported', !!payload.schedule);
eq('round trips', ctx.inspectBackup(JSON.stringify(payload)).data.schedule, ctx.schedule);
ok('a bad schedule is rejected', !!ctx.inspectBackup('{"schedule":[]}').error);

console.log('every session still resolves and gates after a push:');
reset();
ctx.reschedulePush('W6-Wed','2026-10-19');
let errs=[];
ctx.plan.sessions.forEach(s=>{
  try {
    ctx.sessionGate(s);
    s.exercises.forEach(e=>{ const r=ctx.resolveLoad(e.load, ctx.sessionDate(s)); if(/NaN/.test(r.text)) errs.push(s.id); });
  } catch(e){ errs.push(s.id+': '+e.message); }
});
eq('no failures', errs, []);
ok('no duplicate dates', new Set(ctx.plan.sessions.filter(s=>!ctx.isSkipped(s)).map(s=>ctx.sessionDate(s))).size
   === ctx.plan.sessions.filter(s=>!ctx.isSkipped(s)).length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
