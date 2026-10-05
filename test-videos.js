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
const VIDEOS=read('data/videos.json');
const ID=/^[A-Za-z0-9_-]{11}$/;
const WATCH='https://www.youtube.com/watch?v=';

/* every exercise id the app can show: the areas' stages and the old plan's sessions */
const known={}, namesOf={};
const see=e=>{known[e.id]=known[e.id]||e.name;(namesOf[e.id]=namesOf[e.id]||{})[e.name]=true;};
idx.areas.forEach(id=>read('data/areas/'+id+'.json').stages.forEach(s=>(s.exercises||[]).forEach(see)));
const walk=o=>{if(Array.isArray(o))o.forEach(walk);else if(o&&typeof o==='object'){if(o.id&&o.name&&(o.sets||o.reps||o.dur)&&o.cue!==undefined)see(o);Object.values(o).forEach(walk);}};
walk(ctx.plan.sessions);
const ids=Object.keys(known);

console.log('the data file:');
ok('there are exercises to cover', ids.length>=150);
const covered=id=>!!VIDEOS.videos[id]||VIDEOS.none.indexOf(id)>=0;
eq('every exercise has a video, or is on the list of things that are not exercises, bar the one circuit that no single video shows', ids.filter(id=>!covered(id)).sort(), ['kb-light']);
eq('what is on the "none" list is rest and protocol placeholders, not exercises with sets', VIDEOS.none.slice().sort(), ['contingency','no-pogo','nothing','prime','rest']);
ok('and every one of them is a real id in the data', VIDEOS.none.every(id=>id in known));
eq('nothing is on both lists', VIDEOS.none.filter(id=>VIDEOS.videos[id]), []);
const baseKeys=Object.keys(VIDEOS.videos).filter(k=>k.indexOf('|')<0), variantKeys=Object.keys(VIDEOS.videos).filter(k=>k.indexOf('|')>=0);
eq('no video is kept for an id the app no longer has', Object.keys(VIDEOS.videos).filter(k=>!(k.split('|')[0] in known)), []);
eq('a variant key names a variant that is really in the data, under an id that also has its own video', variantKeys.filter(k=>{const i=k.indexOf('|'),id=k.slice(0,i),name=k.slice(i+1);return !(namesOf[id]&&namesOf[id][name])||!VIDEOS.videos[id];}), []);
eq('the variants that need their own video are these', variantKeys.sort(), ['heel-raise|Loaded single-leg heel raise (easy)','heel-raise|Single-leg heel raise, loaded','nordic|Nordic curl','nordic|Weighted Nordic curl','pogo|Single-leg pogo']);
eq('every video id is 11 characters of the YouTube alphabet', Object.keys(VIDEOS.videos).filter(id=>!ID.test(VIDEOS.videos[id].v)), []);
eq('every video keeps the title it was found under', Object.keys(VIDEOS.videos).filter(id=>!(typeof VIDEOS.videos[id].t==='string'&&VIDEOS.videos[id].t.length>=3)), []);
eq('and there is no " - YouTube" tail left on a title', Object.keys(VIDEOS.videos).filter(id=>/\s-\s+YouTube\s*$/.test(VIDEOS.videos[id].t)), []);
eq('"fit" is either absent (an exact video) or "close"', Object.keys(VIDEOS.videos).filter(id=>[undefined,'close'].indexOf(VIDEOS.videos[id].fit)<0), []);
ok('most are exact: the close ones are the exception', Object.values(VIDEOS.videos).filter(v=>v.fit==='close').length<Object.keys(VIDEOS.videos).length/3);

console.log('cleaning what is read:');
const c1=ctx.cleanVideoData({videos:{a:{v:'dQw4w9WgXcQ',t:'T',fit:'close'},b:{v:'short'},c:'x',d:{v:'dQw4w9WgXcQ'},e:{v:12345678901},f:null},none:['rest',3,null]});
eq('a good entry stays, a close one stays close, anything else is normalised', [c1.videos.a,c1.videos.d], [{v:'dQw4w9WgXcQ',t:'T',fit:'close'},{v:'dQw4w9WgXcQ',t:'',fit:'exact'}]);
eq('bad ids and junk entries are dropped', Object.keys(c1.videos).sort(), ['a','d']);
eq('and only text goes on the none list', c1.none, ['rest']);
eq('nothing, a list or a word gives an empty set', [ctx.cleanVideoData(null),ctx.cleanVideoData([]),ctx.cleanVideoData('x'),ctx.cleanVideoData({videos:['a']})].map(x=>[Object.keys(x.videos).length,x.none.length]), [[0,0],[0,0],[0,0],[0,0]]);
const real=ctx.cleanVideoData(VIDEOS);
eq('the real file survives cleaning whole', Object.keys(real.videos).length, Object.keys(VIDEOS.videos).length);

console.log('what to link:');
ctx.videoData=real;
const closeId=baseKeys.find(id=>VIDEOS.videos[id].fit==='close');
const exactId=baseKeys.find(id=>!VIDEOS.videos[id].fit);
const L=(id,extra)=>ctx.videoFor(Object.assign({id:id,name:known[id]||'Some exercise'},extra||{}));
eq('an exercise with a video links to it', [L(exactId).url,L(exactId).kind,L(exactId).label], [WATCH+VIDEOS.videos[exactId].v,'exact','Video']);
eq('and it carries the title of the video', L(exactId).title, VIDEOS.videos[exactId].t);
eq('a close one says so', [L(closeId).url,L(closeId).kind,L(closeId).label], [WATCH+VIDEOS.videos[closeId].v,'close','Similar video']);
eq('Nordic curl has its own', L('nordic').url, WATCH+VIDEOS.videos.nordic.v);
const named=(id,name)=>ctx.videoFor({id:id,name:name}).url;
eq('the band-assisted one, which is what the id means in the areas, gets the band video', named('nordic','Band-assisted Nordic curl'), WATCH+VIDEOS.videos.nordic.v);
eq('the plain Nordic curl and the weighted one each get their own', [named('nordic','Nordic curl'),named('nordic','Weighted Nordic curl')], [WATCH+VIDEOS.videos['nordic|Nordic curl'].v,WATCH+VIDEOS.videos['nordic|Weighted Nordic curl'].v]);
ok('and those are three different videos', new Set([named('nordic','Band-assisted Nordic curl'),named('nordic','Nordic curl'),named('nordic','Weighted Nordic curl')]).size===3);
eq('a single-leg pogo is not the double-leg video', [named('pogo','Double-leg pogos'),named('pogo','Single-leg pogo')], [WATCH+VIDEOS.videos.pogo.v,WATCH+VIDEOS.videos['pogo|Single-leg pogo'].v]);
ok('and the two differ', named('pogo','Double-leg pogos')!==named('pogo','Single-leg pogo'));
eq('the double-leg heel raise keeps the id’s video and the single-leg loaded ones get theirs', [named('heel-raise','Double-leg heel raise off step'),named('heel-raise','Single-leg heel raise, loaded'),named('heel-raise','Loaded single-leg heel raise (easy)')], [WATCH+VIDEOS.videos['heel-raise'].v,WATCH+VIDEOS.videos['heel-raise|Single-leg heel raise, loaded'].v,WATCH+VIDEOS.videos['heel-raise|Loaded single-leg heel raise (easy)'].v]);
eq('a name nobody wrote an override for falls back to the id', named('nordic','Some other Nordic'), WATCH+VIDEOS.videos.nordic.v);
eq('a pack’s own video wins over the table', L('nordic',{video:'dQw4w9WgXcQ'}).url, WATCH+'dQw4w9WgXcQ');
eq('a bad one is ignored and the table is used', L('nordic',{video:'nope'}).url, WATCH+VIDEOS.videos.nordic.v);
eq('and so is one that is not text', L('nordic',{video:12345678901}).url, WATCH+VIDEOS.videos.nordic.v);
eq('a placeholder that is not an exercise has no link', [L('rest'),L('nothing'),L('contingency')], [null,null,null]);
const circuit=L('kb-light');
eq('an exercise with no video gets a search for it', [circuit.kind,circuit.label,circuit.url], ['search','Find video','https://www.youtube.com/results?search_query='+encodeURIComponent(known['kb-light']+' how to')]);
const mine=ctx.videoFor({id:'mine',name:'Wall angels & more'});
eq('a name is encoded into the search address', mine.url, 'https://www.youtube.com/results?search_query='+encodeURIComponent('Wall angels & more how to'));
ok('so an ampersand cannot end the query early', mine.url.split('search_query=')[1].indexOf('&')<0);
eq('the stand-in for a tracked area, and nothing at all, link to nothing', [ctx.videoFor({id:'done',name:'Running'}),ctx.videoFor({id:'x'}),ctx.videoFor(null),ctx.videoFor(undefined),ctx.videoFor('x')], [null,null,null,null,null]);
ctx.videoData={videos:{},none:[]};
eq('before the file has loaded every exercise still has a way to see it done', L('nordic').kind, 'search');
ctx.videoData=real;

console.log('on the screen:');
const made=[]; const origEl=ctx.el;
ctx.el=function(tag,attrs,kids){const n=origEl(tag,attrs,kids);made.push({tag,attrs:attrs||{},kids,n});return n;};
const links=()=>made.filter(m=>m.tag==='a'&&/(^| )(ex-video|run-link)( |$)/.test(m.attrs.class||''));
const ex=id=>({id:id,name:known[id]||id,sets:3,reps:'5',restSec:90,load:{type:'bodyweight'},cue:'Slow.'});

made.length=0; ctx.exerciseCard(ex('nordic'),null,'plain',null);
let a=links();
eq('an exercise card has one video link', a.length, 1);
eq('it goes to the video, in a new tab, without handing the app over', [a[0].attrs.href,a[0].attrs.target,a[0].attrs.rel], [WATCH+VIDEOS.videos.nordic.v,'_blank','noopener noreferrer']);
eq('it reads Video ↗, and has a full sentence for a screen reader', [a[0].attrs.text,a[0].attrs['aria-label']], ['Video ↗','Watch a video of '+known.nordic]);
eq('and shows the title of the video on hover', a[0].attrs.title, VIDEOS.videos.nordic.t);
ok('it sits in the card’s head, beside the name', made.some(m=>m.attrs.class==='ex-head'&&m.kids&&m.kids.indexOf(a[0].n)>=0));

made.length=0; ctx.exerciseCard(ex(closeId),null,'plain',null); a=links();
eq('a close video says Similar video', [a[0].attrs.text,a[0].attrs['aria-label']], ['Similar video ↗','Watch a similar video of '+known[closeId]]);
made.length=0; ctx.exerciseCard(ex('kb-light'),null,'plain',null); a=links();
eq('an exercise with no video says Find video', [a[0].attrs.text,/^Search YouTube for /.test(a[0].attrs['aria-label'])], ['Find video ↗',true]);
made.length=0; ctx.exerciseCard(ex('rest'),null,'plain',null);
eq('a rest-day placeholder has no link at all', links().length, 0);
const s0=ctx.plan.sessions.filter(s=>s.exercises.some(e=>!VIDEOS.none.includes(e.id)))[0], e0=s0.exercises.filter(e=>!VIDEOS.none.includes(e.id))[0];
made.length=0; ctx.exerciseCard(e0,s0,'live',ctx.sessionGate(s0));
eq('and a live card on a real session has the link as well as the chips and the run button', [links().length,made.some(m=>/(^| )ex-run( |$)/.test(m.attrs.class||''))], [1,true]);
made.length=0; const rl=ctx.videoLink(ex('nordic'),'run-link');
eq('the runner’s link is the same link in the runner’s style', [rl&&made[made.length-1].attrs.class,made[made.length-1].attrs.href], ['run-link',WATCH+VIDEOS.videos.nordic.v]);
eq('and an exercise with no link gives none to put in a row', ctx.videoLink(ex('rest')), null);

/* every real exercise in the data draws a card with exactly one link, or none where it is a placeholder */
made.length=0; let bad=[];
ids.forEach(id=>{made.length=0; try{ctx.exerciseCard(ex(id),null,'plain',null);}catch(e){bad.push(id+': '+e.message);return;}
  const n=links().length; if(n!==(VIDEOS.none.indexOf(id)>=0?0:1)) bad.push(id+' has '+n);});
eq('every exercise in the app draws with one link (none for the placeholders)', bad, []);
ctx.el=origEl;

console.log('a pack can bring its own:');
const pack=()=>JSON.parse(fs.readFileSync('docs/area-pack-example.json','utf8'));
const V=(o)=>ctx.validateAreaPack(o,{taken:[]});
eq('the starter pack still passes', V(pack()).ok, true);
let p=pack(); p.stages[0].exercises[0].video='dQw4w9WgXcQ';
eq('with a good video id it passes', V(p).ok, true);
p=pack(); p.stages[0].exercises[0].video='dQw4w9WgXc';
let r=V(p);
ok('ten characters is refused, and the message says what is wanted', !r.ok&&r.errors.some(e=>/"video" must be the 11-character YouTube id/.test(e)));
p=pack(); p.stages[0].exercises[0].video='https://youtu.be/dQw4w9WgXcQ';
ok('a whole address is refused too', !V(p).ok);
p=pack(); p.stages[0].exercises[0].video=5;
ok('and so is a number', !V(p).ok);
p=pack(); p.stages[0].exercises[0].video='dQw4w9WgX?Q';
ok('and a character that is not in the alphabet', !V(p).ok);
ok('the how-to page tells people about it', /video \(the 11-character YouTube id/.test(fs.readFileSync('app.js','utf8')));

console.log('loading it:');
(async()=>{
  ctx.videoData={videos:{},none:[]};
  let asked=null;
  ctx.fetch=(u,o)=>{asked={u,o};return Promise.resolve({ok:true,json:()=>Promise.resolve(VIDEOS)});};
  eq('a good load says so', await ctx.loadVideos(), true);
  eq('it asked for the data file, fresh', [asked.u,asked.o&&asked.o.cache], ['data/videos.json','no-cache']);
  eq('and the videos are in', Object.keys(ctx.videoData.videos).length, Object.keys(VIDEOS.videos).length);

  ctx.videoData={videos:{keep:{v:'dQw4w9WgXcQ',t:'',fit:'exact'}},none:[]};
  ctx.fetch=()=>Promise.resolve({ok:false,status:404,json:()=>Promise.resolve({})});
  eq('a missing file says it did not load', await ctx.loadVideos(), false);
  eq('and what was there is left alone', Object.keys(ctx.videoData.videos), ['keep']);
  ctx.fetch=()=>Promise.reject(new Error('offline'));
  eq('offline says the same and breaks nothing', await ctx.loadVideos(), false);
  ctx.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.reject(new Error('bad json'))});
  eq('unreadable data too', await ctx.loadVideos(), false);

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
