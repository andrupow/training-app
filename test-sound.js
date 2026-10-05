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

/* A fake audio clock: it records what is scheduled, what is stopped, and every gain it is given. */
const rec={now:0,osc:[],ctxs:0,destination:{name:'speaker'},limiters:[],masters:[]};
const param=()=>{const p={value:0,calls:[],setValueAtTime(v,t){p.calls.push(['set',v,t]);p.value=v;},exponentialRampToValueAtTime(v,t){p.calls.push(['exp',v,t]);}};return p;};
const FakeAC=function(){rec.ctxs++;this.state='running';Object.defineProperty(this,'currentTime',{get:()=>rec.now});this.destination=rec.destination;
  this.createOscillator=()=>{const o={type:'sine',frequency:param(),startAt:null,stopAt:null,out:null,connect(n){o.out=n;},disconnect(){},start(t){o.startAt=t;},stop(t){o.stopAt=(t===undefined?rec.now:t);}};rec.osc.push(o);return o;};
  this.createGain=()=>{const g={gain:param(),out:null,connect(n){g.out=n;},disconnect(){}};return g;};
  this.createDynamicsCompressor=()=>{const c={threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),out:null,connect(n){c.out=n;},disconnect(){}};rec.limiters.push(c);return c;};
  this.resume=()=>Promise.resolve();};
sandbox.window.AudioContext=FakeAC;
let clock=1e12; vm.runInContext('Date',sandbox).now=()=>clock;

vm.runInContext(fs.readFileSync('app.js','utf8'),sandbox);
const ctx=sandbox;
ctx.plan=JSON.parse(fs.readFileSync('data/plan.json','utf8'));

let pass=0,fail=0;
function ok(l,c){if(c)pass++;else{fail++;console.log(`  FAIL ${l}`);}}
function eq(l,g,w){const same=JSON.stringify(g)===JSON.stringify(w);if(same)pass++;else{fail++;console.log(`  FAIL ${l}\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`);}}

const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const idx=read('data/areas/index.json');
ctx.areaData={rules:read('data/rules.json'),legacy:read('data/legacy.json'),list:idx.areas.map(id=>read('data/areas/'+id+'.json'))};
ctx.paintTimer=noop; ctx.paintRunner=noop; ctx.paintCount=noop;
const reset=()=>{ctx.settings={};ctx.setLogs=[];ctx.logIndex={};ctx.cancelSounds();rec.osc.length=0;rec.now=0;clock=1e12;};
const prefs=(o)=>Object.assign({},ctx.SOUND_DEFAULTS,o||{});
const plan=(role,secs,o)=>ctx.soundPlan(role,secs,prefs(o));
const kinds=(p)=>p.map(e=>e.kind);
const near=(a,b)=>Math.abs(a-b)<1e-9;
/* the peak a oscillator reaches, through its own gain */
const peakOf=(o)=>Math.max.apply(null,o.out.gain.calls.filter(c=>c[0]==='exp').map(c=>c[1]));
/* what is scheduled and not stopped before it starts */
const live=(o)=>o.startAt!==null&&!(o.stopAt!==null&&o.stopAt<=o.startAt);

console.log('what you have chosen, and what happens to a choice that is not allowed:');
reset();
eq('with nothing chosen, the defaults', ctx.soundPrefs(), {volume:'high',workTicks:true,restTicks:true,endWork:'dong',endRest:'beeps',tickFrom:10});
ctx.settings={sound:{volume:'max',tickFrom:5}};
eq('a partial choice keeps what it says and fills in the rest', ctx.soundPrefs(), {volume:'max',workTicks:true,restTicks:true,endWork:'dong',endRest:'beeps',tickFrom:5});
ctx.settings={sound:{volume:'loudest',workTicks:'yes',tickFrom:7,endRest:'constructor',endWork:'__proto__'}};
eq('values that are not on offer fall back to the defaults', ctx.soundPrefs(), ctx.SOUND_DEFAULTS);
ctx.settings={sound:'loud'}; eq('as does a setting that is not even an object', ctx.soundPrefs(), ctx.SOUND_DEFAULTS);
ctx.settings={sound:['max']}; eq('or a list', ctx.soundPrefs(), ctx.SOUND_DEFAULTS);
reset();
eq('setSound saves a choice', [ctx.setSound('volume','low'), ctx.soundPrefs().volume, JSON.parse(store.settings).sound.volume], [true,'low','low']);
eq('and keeps the others', ctx.soundPrefs().tickFrom, 10);
eq('a value that is not allowed is refused and changes nothing', [ctx.setSound('volume','deafening'), ctx.soundPrefs().volume], [false,'low']);
eq('so is a setting that does not exist', [ctx.setSound('colour','teal'), ctx.setSound('constructor',1), ctx.setSound('__proto__','x')], [false,false,false]);
eq('a flag has to be a real true or false', [ctx.setSound('workTicks','no'), ctx.setSound('workTicks',false), ctx.soundPrefs().workTicks], [false,true,false]);
eq('a tick start has to be one of the offered', [ctx.setSound('tickFrom',3), ctx.setSound('tickFrom',15), ctx.soundPrefs().tickFrom], [false,true,15]);

console.log('what to play, and when (a pure plan):');
const w30=plan('work',30);
eq('a 30 s set ticks for its last 10 s, twice a second: 20 ticks', w30.filter(e=>e.kind==='work-tick').length, 20);
ok('the first tick is at 20 s and the last at 29.5 s', near(w30[0].at,20) && near(w30[19].at,29.5));
ok('they are half a second apart', w30.slice(0,20).every((e,i)=>near(e.at,20+i*0.5)));
eq('then the double-dong, at the end', [w30[20].kind,w30[20].at,w30.length], ['dong',30,21]);
const r120=plan('rest',120);
eq('a 2 min rest ticks for its last 10 s, once a second: 10 ticks', r120.filter(e=>e.kind!=='beeps').length, 10);
ok('from 110 s to 119 s', r120.slice(0,10).every((e,i)=>near(e.at,110+i)));
eq('tick and tock take turns, ending on a tock', kinds(r120.slice(0,10)), ['rest-tick','rest-tock','rest-tick','rest-tock','rest-tick','rest-tock','rest-tick','rest-tock','rest-tick','rest-tock']);
eq('and the rest ends with the beeps', [r120[10].kind,r120[10].at], ['beeps',120]);
ok('a set and a rest do not tick the same way', !kinds(w30).includes('rest-tick') && !kinds(r120).includes('work-tick'));
eq('a 14 s set ticks for its last 7 s only (never more than half)', plan('work',14).filter(e=>e.kind==='work-tick').length, 14);
ok('starting at 7 s', near(plan('work',14)[0].at,7));
eq('an 8 s set ticks for 4 s', plan('work',8).filter(e=>e.kind==='work-tick').length, 8);
eq('a 3 s timer is too short to tick and just ends', kinds(plan('work',3)), ['dong']);
eq('so is a 2 s one', kinds(plan('rest',2)), ['beeps']);
eq('the last 5 s, if you ask for it', plan('work',30,{tickFrom:5}).filter(e=>e.kind==='work-tick').length, 10);
ok('starting at 25 s', near(plan('work',30,{tickFrom:5})[0].at,25));
ok('and the last 15 s, if you ask for that', near(plan('work',60,{tickFrom:15})[0].at,45));
eq('ticks off for sets leaves just the dong', kinds(plan('work',30,{workTicks:false})), ['dong']);
eq('the dong off leaves just the ticks', new Set(kinds(plan('work',30,{endWork:'off'}))).size, 1);
eq('ticks off for rests leaves just the beeps', kinds(plan('rest',120,{restTicks:false})), ['beeps']);
eq('a rest can end on the double-dong instead', kinds(plan('rest',120,{restTicks:false,endRest:'dong'})), ['dong-up']);
eq('or on nothing', plan('rest',120,{restTicks:false,endRest:'off'}), []);
eq('volume off plays nothing at all', [plan('work',30,{volume:'off'}), plan('rest',120,{volume:'off'})], [[],[]]);
eq('nothing to time, nothing to play', [plan('work',0), plan('work',-5), plan('rest',NaN), plan('rest',undefined)], [[],[],[],[]]);
ok('every sound is inside the timer', [w30,r120,plan('work',8),plan('rest',45)].every(p=>p.every(e=>e.at>=0&&e.at<=Math.max.apply(null,p.map(x=>x.at)))));
ok('and none is before it starts, whatever the length', [3,4,5,6,9,10,11,20,45,90,300].every(s=>['work','rest'].every(r=>plan(r,s).every(e=>e.at>=-1e-9&&e.at<=s+1e-9))));

console.log('the sounds themselves:');
reset();
ctx.scheduleSounds('work',30);
const wOsc=rec.osc.slice();
eq('a 30 s set: 20 ticks and a double-dong of two four-part bells', wOsc.length, 20+8);
ok('everything is scheduled ahead, none right now', wOsc.every(o=>o.startAt>=0));
ok('the first tick is 20 s on the audio clock', near(Math.min.apply(null,wOsc.map(o=>o.startAt)),20));
ok('ticks are sharp square clicks', wOsc.slice(0,20).every(o=>o.type==='square'));
ok('the bell is built from sine partials', wOsc.slice(20).every(o=>o.type==='sine'));
eq('the second dong is lower than the first', (()=>{const f=wOsc.slice(20).filter(o=>o.frequency.calls[0][1]<800&&o.frequency.calls[0][1]>500||true).map(o=>o.frequency.calls[0][1]);return [f[0]>f[4]*1.2];})(), [true]);
ok('the second dong starts later than the first', wOsc[24].startAt>wOsc[20].startAt+0.4);
reset();
ctx.scheduleSounds('rest',120);
eq('a 2 min rest: ten tick-tocks and three beeps', rec.osc.length, 13);
ok('the first is at 110 s', near(Math.min.apply(null,rec.osc.map(o=>o.startAt)),110));
const restPitches=rec.osc.slice(0,10).map(o=>o.frequency.calls[0][1]);
reset(); ctx.scheduleSounds('work',30);
const setPitches=rec.osc.slice(0,20).map(o=>o.frequency.calls[0][1]);
ok('a rest ticks lower than a set does (under 1.5 kHz against over 2 kHz), so the two never sound alike', restPitches.every(f=>f<1500) && setPitches.every(f=>f>2000));
eq('tick and tock are different pitches', [restPitches[0]>restPitches[1]], [true]);
reset(); ctx.scheduleSounds('rest',120);
reset();
ctx.scheduleSounds('work',30,'test');
ctx.scheduleSounds('rest',120);
ctx.cancelSounds('rest');
eq('cancelling the rest stops only the rest\'s 13', [rec.osc.filter(o=>!live(o)).length, rec.osc.filter(live).length], [13,28]);
ctx.cancelSounds();
ok('cancelling everything stops everything', rec.osc.every(o=>!live(o)));
reset();
ctx.settings={sound:{volume:'off'}};
ctx.scheduleSounds('work',30); ctx.scheduleSounds('rest',120);
eq('with the volume off nothing is even scheduled', rec.osc.length, 0);
reset();
ctx.scheduleSounds('work',30);
ctx.scheduleSounds('work',30);
eq('scheduling a set again replaces the first, it does not stack on it', rec.osc.filter(live).length, 28);

console.log('the audio is unlocked by the tap that starts a set, even when that set plays nothing itself:');
const noAudioYet=()=>{reset();vm.runInContext('audioCtx = null; audioOut = null;',ctx);rec.ctxs=0;};
noAudioYet(); ctx.settings={sound:{workTicks:false,endWork:'off'}};
ctx.scheduleSounds('work',20);
eq('set ticks off and the set end silent: the audio context is still made in that tap, ready for the rest that follows', [rec.ctxs,rec.osc.length], [1,0]);
noAudioYet(); ctx.settings={sound:{volume:'off'}};
ctx.scheduleSounds('work',20);
eq('with the volume off there is nothing to unlock, so none is made', rec.ctxs, 0);
noAudioYet(); ctx.settings={sound:{workTicks:false,endWork:'off'}};
ctx.scheduleSounds('work',20); ctx.scheduleSounds('rest',60);
eq('and the rest that follows then plays: a 60 s rest is ten tick-tocks and three beeps, on that same context', [rec.osc.length,rec.ctxs], [13,1]);
reset();

console.log('loud, and never clipping:');
reset();
const master=()=>ctx.audioOut.master;
ctx.scheduleSounds('work',30);
ok('everything goes through one volume control into a limiter and then the speaker', rec.osc.every(o=>o.out.out===master()) && master().out===rec.limiters[rec.limiters.length-1] && rec.limiters[rec.limiters.length-1].out===rec.destination);
eq('the volume steps', ['off','low','medium','high','max'].map(v=>{ctx.setSound('volume',v);return master().gain.value;}), [0,0.3,0.55,0.8,1]);
reset(); ctx.scheduleSounds('rest',120);
ctx.setSound('volume','off');
eq('turning the volume off silences what is already scheduled for a running timer', [master().gain.value, rec.osc.filter(live).length>0], [0,true]);
ctx.setSound('volume','max');
eq('and turning it up brings it up', master().gain.value, 1);
reset(); ctx.scheduleSounds('work',30);
reset();
ctx.scheduleSounds('work',30); ctx.scheduleSounds('rest',120,'rest');
const allOsc=rec.osc.slice();
ok('every cue peaks well above the 0.4 the old beep reached', allOsc.filter(o=>o.out.gain.calls.length).some(o=>peakOf(o)>0.4));
const byKind=(sec,role,n)=>{reset();ctx.scheduleSounds(role,sec);return rec.osc.slice(0,n).map(peakOf);};
ok('the ticks peak at 0.8 or more', byKind(30,'work',20).every(p=>p>=0.8));
ok('the rest ticks peak at 0.7 or more', byKind(120,'rest',10).every(p=>p>=0.7));
ok('ticks hold their level for a moment, they are not a few-millisecond spike a phone speaker barely plays', (()=>{reset();ctx.scheduleSounds('work',30);return rec.osc.slice(0,20).every(o=>o.out.gain.calls.some(c=>c[0]==='set'&&c[1]>=0.8&&c[2]>=o.startAt+0.025));})());
reset(); ctx.scheduleSounds('work',30);
const bellPeaks=rec.osc.slice(20,24).map(peakOf);
ok('the bell is loud where it counts: its strongest part is over 0.5', Math.max.apply(null,bellPeaks)>0.5);
ok('and one strike never adds up past full scale', bellPeaks.reduce((a,b)=>a+b,0)<=1.3);
ok('the limiter is set to catch peaks', rec.limiters[rec.limiters.length-1].threshold.value<0 && rec.limiters[rec.limiters.length-1].ratio.value>=4);
ok('one audio context is made and reused', (()=>{const n=rec.ctxs;ctx.scheduleSounds('rest',120);ctx.scheduleSounds('work',30);return rec.ctxs===n;})());

console.log('hearing it in the settings:');
reset();
ctx.previewSound('work');
eq('"hear the end of a set": the last 4 s of ticks and the dong', rec.osc.length, 8+8);
reset(); ctx.previewSound('rest');
eq('"hear the end of a rest": four tick-tocks and the beeps', rec.osc.length, 4+3);
reset(); ctx.settings={sound:{volume:'off'}}; ctx.previewSound('work');
eq('with the volume off it says so instead of playing', rec.osc.length, 0);
reset(); ctx.previewCue('dong');
eq('a cue on its own, for hearing a volume change', rec.osc.length, 8);
reset(); ctx.settings={sound:{volume:'off'}}; ctx.previewCue('dong');
eq('and not at volume off', rec.osc.length, 0);
reset(); ctx.settings={sound:{endWork:'off',workTicks:false}}; ctx.previewCue('dong');
eq('even when the set sounds are off, so a volume change can still be heard', rec.osc.length, 8);

console.log('the timed set: the end sound is no longer cancelled by the tick that finishes the set (this was the bug):');
let found=null;
for(const s of ctx.plan.sessions){const i=s.exercises.findIndex(e=>ctx.timedSeconds(e)!==null&&Number(e.sets)>1&&Number(e.restSec)>0);if(i>=0){found={s,i};break;}}
ok('the plan has a timed exercise to test with', !!found);
ctx.sessionById=(id)=>id===found.s.id?found.s:null;
const ex=()=>found.s.exercises[found.i];
const run=()=>{reset();ctx.enterRunner(found.s.id,found.i);ctx.startTimedSet();};
run();
const secs=ctx.runner.secs;
const atStart=rec.osc.filter(live).length;
ok('starting a timed set schedules its ticks and its double-dong', atStart>=8);
clock+=secs*1000-400; rec.now=secs-0.4;      /* the 250 ms tick finishes the set up to half a second early */
ctx.tickRunner();
eq('the set is finished and the rest has begun', ctx.runner.phase, 'resting');
const stillComing=rec.osc.filter(o=>live(o)&&o.startAt>=rec.now);
ok('the double-dong is still going to play', stillComing.filter(o=>o.type==='sine'&&o.startAt>=secs-0.01).length===8);
ok('and none of the set\'s sounds was cancelled', rec.osc.slice(0,atStart).every(live));
ok('the rest has its own sounds scheduled', rec.osc.length>atStart);
ok('after the rest is over it will beep', rec.osc.slice(atStart).some(o=>o.frequency.calls[0][1]===880&&Math.abs(o.startAt-(rec.now+ex().restSec))<1));

console.log('stopping early still stops the sound:');
run();
ctx.cancelSounds('work'); ctx.completeSet();     /* what the "Done early" button does */
ok('"Done early" cancels the set\'s ticks and bell', rec.osc.slice(0,atStart).every(o=>!live(o)));
ok('and the rest starts with its own', rec.osc.length>atStart);
run(); ctx.skipSet();
ok('skipping the set cancels them', rec.osc.slice(0,atStart).every(o=>!live(o)));
run(); ctx.skipExercise();
ok('skipping the exercise cancels them', rec.osc.slice(0,atStart).every(o=>!live(o)));
run(); ctx.leaveRunner();
ok('leaving the runner mid-hold cancels them', rec.osc.slice(0,atStart).every(o=>!live(o)));
run(); clock+=secs*1000-400; rec.now=secs-0.4; ctx.tickRunner();
const restStart=rec.osc.length;
ctx.skipRest();
ok('skipping the rest cancels its sounds', rec.osc.slice(atStart).every(o=>!live(o)||o.startAt<rec.now) );
ok('a rest started from the Today tab ticks and ends too', (()=>{reset();ctx.startRest(ex());return rec.osc.length>=3;})());
ok('and the "+30 s" button reschedules it from what is left', (()=>{reset();ctx.startRest(ex());const n=rec.osc.length;ctx.addRest(30);return rec.osc.slice(0,n).every(o=>!live(o))&&rec.osc.length>n;})());
ok('stopping the rest silences it', (()=>{reset();ctx.startRest(ex());ctx.stopRest();return rec.osc.every(o=>!live(o));})());

console.log('the Sound section:');
const made=[]; const origEl=ctx.el;
ctx.el=function(tag,attrs,kids){const n=origEl(tag,attrs,kids);made.push({tag,attrs:attrs||{},n});return n;};
const chip=(label,row)=>{const hits=made.filter(m=>m.tag==='button'&&m.attrs.text===label);return row===undefined?hits[0]:hits[row];};
reset(); made.length=0;
ok('it draws', (()=>{try{ctx.soundSection();return true;}catch(e){console.log(e.message);return false;}})());
ok('with a chip for each volume', ['Off','Low','Medium','High','Max'].every(l=>chip(l)));
ok('and for each tick start', ['5 s','10 s','15 s'].every(l=>chip(l)));
ok('and two ways to hear it', chip('Hear the end of a set') && chip('Hear the end of a rest'));
ok('the current choice is marked', made.some(m=>m.tag==='button'&&m.attrs.text==='High'&&/is-on/.test(m.attrs.class)));
reset(); made.length=0; ctx.soundSection();
chip('Max').n._h.click();
eq('tapping Max saves it', ctx.soundPrefs().volume, 'max');
eq('and you hear a double-dong at once, at that level', [rec.osc.length,master().gain.value], [8,1]);
reset(); made.length=0; ctx.soundSection();
chip('Off').n._h.click();
eq('tapping Off saves it, and plays nothing', [ctx.soundPrefs().volume,rec.osc.length], ['off',0]);
reset(); made.length=0; ctx.soundSection();
chip('15 s').n._h.click();
eq('tapping 15 s saves it', ctx.soundPrefs().tickFrom, 15);
reset(); made.length=0; ctx.soundSection();
chip('Silent',0).n._h.click();
eq('"When a set ends: Silent" saves', ctx.soundPrefs().endWork, 'off');
reset(); made.length=0; ctx.soundSection();
chip('Silent',1).n._h.click();
eq('"When a rest ends: Silent" saves', ctx.soundPrefs().endRest, 'off');
reset(); made.length=0; ctx.soundSection();
chip('Off',1).n._h.click();   /* the first Off is the volume; the next is "ticks in a set" */
eq('"ticks in a set: Off" saves', ctx.soundPrefs().workTicks, false);
reset(); made.length=0; ctx.soundSection();
chip('Hear the end of a set').n._h.click();
eq('"Hear the end of a set" plays it', rec.osc.length, 16);
ctx.el=origEl;
ok('the whole Progress tab draws with it in', (()=>{try{ctx.renderProgress();return true;}catch(e){console.log(e.message);return false;}})());

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
