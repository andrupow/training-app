/* Validates data/areas/*.json, data/rules.json and data/legacy.json.
   No app code involved: this is the contract the data has to keep, so a typo
   in an area file fails here instead of showing up as a blank card. */
const fs = require('fs');
const dir = 'data/areas';
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

let pass = 0, fail = 0;
function eq(l, g, w) { const ok = JSON.stringify(g) === JSON.stringify(w); if (ok) pass++; else { fail++; console.log(`  FAIL ${l}\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`); } }
function ok(l, c) { if (c) pass++; else { fail++; console.log(`  FAIL ${l}`); } }

const index = read(dir + '/index.json');
const rules = read('data/rules.json');
const legacy = read('data/legacy.json');
const plan = read('data/plan.json');
const areas = index.areas.map(id => read(`${dir}/${id}.json`));
const byId = {}; areas.forEach(a => { byId[a.id] = a; });

const AREA_KEYS = ['id', 'name', 'short', 'priority', 'goal', 'perWeek', 'minGapDays', 'minutes', 'load', 'order',
  'guardedBy', 'sessionTypes', 'tests', 'stages'];
const STAGE_KEYS = ['id', 'name', 'askAfter', 'optional', 'work', 'maxContacts', 'maxDepthContacts', 'goal',
  'milestone', 'ready', 'note', 'requires', 'bells', 'perWeek', 'minGapDays', 'draft',
  'exercises', 'equipment', 'types'];
const EXERCISE_KEYS = ['id', 'name', 'sets', 'reps', 'tempo', 'restSec', 'load', 'type', 'cue', 'note', 'contacts'];
const LOAD_TYPES = ['pct5RM', 'pctBW', 'fixedKg', 'bodyweight', 'text', 'none'];
const isInt = n => Number.isInteger(n);
const bodyIds = rules.bodyAreas.map(b => b.id);

console.log('index:');
eq('eight areas', index.areas.length, 8);
eq('ids are unique', new Set(index.areas).size, index.areas.length);
eq('files on disk match the index', fs.readdirSync(dir).filter(f => f !== 'index.json').map(f => f.replace('.json', '')).sort(), index.areas.slice().sort());
eq('priorities are 1..8 in index order', areas.map(a => a.priority), [1, 2, 3, 4, 5, 6, 7, 8]);

areas.forEach(a => {
  console.log(`${a.id}:`);
  eq('no unknown area fields', Object.keys(a).filter(k => !AREA_KEYS.includes(k)), []);
  ok('has a name, short name and goal', a.name && a.short && a.goal);
  ok('short name fits a grid label', a.short.length <= 13);
  ok('perWeek is min <= target <= max', isInt(a.perWeek.min) && a.perWeek.min >= 1 && a.perWeek.min <= a.perWeek.target && a.perWeek.target <= a.perWeek.max);
  ok('nominal target, if any, is at least the target', a.perWeek.nominalTarget === undefined || a.perWeek.nominalTarget >= a.perWeek.target);
  ok('minGapDays is a positive integer', isInt(a.minGapDays) && a.minGapDays >= 1);
  ok('minutes is positive', a.minutes > 0);
  ok('load is low / medium / high', ['low', 'medium', 'high'].includes(a.load));
  ok('order is in the day order', rules.dayOrder.includes(a.order));
  ok('guarded by known body areas', a.guardedBy.length > 0 && a.guardedBy.every(b => bodyIds.includes(b)));
  ok('session types, if any, are strings', !a.sessionTypes || a.sessionTypes.every(t => typeof t === 'string'));

  const ids = a.stages.map(s => s.id);
  eq('stage ids are unique', new Set(ids).size, ids.length);
  const letter = ids[0][0];
  ok('one letter per area, numbered from 1 in order', ids.every((id, i) => id === letter + (i + 1)));
  const required = a.stages.filter(s => !s.optional);
  const optional = a.stages.filter(s => s.optional);
  ok('optional stages come last', a.stages.slice(required.length).every(s => s.optional));
  eq('the goal is the last required stage', a.stages.filter(s => s.goal).map(s => s.id), [required[required.length - 1].id]);
  ok('optional stages carry no review count', optional.every(s => s.askAfter === undefined));

  a.stages.forEach(s => {
    const bad = Object.keys(s).filter(k => !STAGE_KEYS.includes(k));
    if (bad.length) eq(`${s.id}: no unknown stage fields`, bad, []);
    ok(`${s.id}: has a name and what to do`, s.name && s.work);
    ok(`${s.id}: no standard is vague shorthand like "same"`, s.ready.every(r => r.length > 8));
    ok(`${s.id}: ready is a list of strings`, Array.isArray(s.ready) && s.ready.every(r => typeof r === 'string' && r.length > 0));
    if (!s.optional) {
      ok(`${s.id}: has a standard to attest to`, s.ready.length > 0);
      const per = (s.perWeek || a.perWeek).target;
      ok(`${s.id}: askAfter is at least one week of the area (${per})`, isInt(s.askAfter) && s.askAfter >= per);
    }
    if (s.draft !== undefined) ok(`${s.id}: draft is true or false`, typeof s.draft === 'boolean');
    if (s.exercises) {
      const ex = s.exercises, exIds = ex.map(e => e.id);
      ok(`${s.id}: has at least one exercise`, ex.length > 0);
      eq(`${s.id}: exercise ids are unique`, new Set(exIds).size, exIds.length);
      ex.forEach(e => {
        const badKeys = Object.keys(e).filter(k => !EXERCISE_KEYS.includes(k));
        if (badKeys.length) eq(`${s.id}/${e.id}: no unknown exercise fields`, badKeys, []);
        ok(`${s.id}/${e.id}: id is a slug`, /^[a-z0-9-]+$/.test(e.id));
        ok(`${s.id}/${e.id}: has a name`, typeof e.name === 'string' && e.name.length > 2);
        ok(`${s.id}/${e.id}: sets is a positive integer`, isInt(e.sets) && e.sets >= 1);
        ok(`${s.id}/${e.id}: reps is a non-empty string`, typeof e.reps === 'string' && e.reps.length > 0);
        ok(`${s.id}/${e.id}: rest is a non-negative integer`, isInt(e.restSec) && e.restSec >= 0);
        ok(`${s.id}/${e.id}: load uses a known rule`, e.load && LOAD_TYPES.includes(e.load.type));
        if (e.type) ok(`${s.id}/${e.id}: type is one of the area's session types`, (a.sessionTypes || []).includes(e.type));
      });
      ok(`${s.id}: either every exercise has a type or none does`, ex.every(e => !!e.type) || ex.every(e => !e.type));

      /* Plyometrics: every jump rep is a ground contact, and the stage caps them. */
      const contacts = ex.filter(e => e.contacts).reduce((n, e) => n + e.sets * (parseInt(e.reps, 10) || 0), 0);
      if (s.maxContacts) {
        ok(`${s.id}: has jumping work counted in contacts`, ex.some(e => e.contacts === true));
        ok(`${s.id}: ${contacts} ground contacts is within the cap of ${s.maxContacts}`, contacts <= s.maxContacts);
      } else {
        ok(`${s.id}: no contacts counted where there is no cap`, !ex.some(e => e.contacts));
      }

      /* A rough clock, to catch a block that is five minutes or two hours. */
      const secs = r => { const m = String(r).match(/^(\d+)(?:\s*[–-]\s*\d+)?\s*(s|min)\b/); return m ? Number(m[1]) * (m[2] === 'min' ? 60 : 1) : 45; };
      const minutes = list => list.reduce((n, e) => n + e.sets * (secs(e.reps) + e.restSec), 0) / 60;
      const groups = ex.some(e => e.type) ? [...new Set(ex.map(e => e.type))].map(ty => ex.filter(e => e.type === ty)) : [ex];
      groups.forEach(g => ok(`${s.id}: a block takes roughly the area's ${a.minutes} min (${Math.round(minutes(g))})`, minutes(g) >= a.minutes * 0.4 && minutes(g) <= a.minutes * 1.6));
    }
    if (s.equipment !== undefined) {
      ok(`${s.id}: equipment is a list`, Array.isArray(s.equipment));
      ok(`${s.id}: every piece of equipment is in the rules' list`, (s.equipment || []).every(id => rules.equipment.some(q => q.id === id)));
      eq(`${s.id}: equipment has no repeats`, new Set(s.equipment).size, (s.equipment || []).length);
    }
    if (s.perWeek) ok(`${s.id}: stage perWeek is min <= target <= max`, s.perWeek.min <= s.perWeek.target && s.perWeek.target <= s.perWeek.max);
    if (s.minGapDays !== undefined) ok(`${s.id}: stage gap is a positive integer`, isInt(s.minGapDays) && s.minGapDays >= 1);
    (s.requires || []).forEach(r => ok(`${s.id}: requires ${r.area} ${r.stage}, which exists`, byId[r.area] && byId[r.area].stages.some(x => x.id === r.stage)));
  });
});

console.log('the equipment list:');
ok('every piece has an id, a label and whether you own it by default', rules.equipment.every(q => /^[a-z-]+$/.test(q.id) && q.label && typeof q.owned === 'boolean'));
eq('ids are unique', new Set(rules.equipment.map(q => q.id)).size, rules.equipment.length);

console.log('every stage is runnable, so a level-up never lands on an empty stage:');
areas.forEach(a => a.stages.forEach(s => {
  ok(`${s.id}: has exercises`, Array.isArray(s.exercises) && s.exercises.length > 0);
  ok(`${s.id}: lists its equipment`, Array.isArray(s.equipment));
  if (s.id !== a.stages[0].id || a.id !== 'mu') ok(`${s.id}: is marked a draft until it has been read`, s.draft === true);
  if (a.id === 'kb') ok(`${s.id}: needs the kettlebell`, (s.equipment || []).includes('kettlebell'));
}));
areas.forEach(a => {
  const ids = a.stages.map(s => (s.exercises || []).map(e => e.id));
  ok(`${a.id}: a stage adds or changes something: no two neighbouring stages are identical`, ids.every((x, i) => i === 0 || JSON.stringify(a.stages[i].exercises) !== JSON.stringify(a.stages[i - 1].exercises)));
});

console.log('everyone starts at stage 1, so stage 1 has to be runnable:');
areas.forEach(a => ok(`${a.id}: ${a.stages[0].id} has exercises`, Array.isArray(a.stages[0].exercises) && a.stages[0].exercises.length > 0));
eq('only muscle-up uses session types in stage 1', areas.filter(a => (a.stages[0].exercises || []).some(e => e.type)).map(a => a.id), ['mu']);
eq('muscle-up stage 1 comes from the old plan, the rest are drafts', areas.filter(a => a.stages[0].draft === false).map(a => a.id), ['mu']);
eq('and every other first stage says it is a draft', areas.filter(a => a.id !== 'mu').every(a => a.stages[0].draft === true), true);

console.log('ladder lengths match the plan:');
eq('full area-days per ladder', areas.map(a => a.stages.reduce((n, s) => n + (s.askAfter || 0), 0)), [44, 50, 84, 58, 48, 104, 86, 70]);
eq('stages per ladder, optional included', areas.map(a => a.stages.length), [4, 6, 7, 6, 6, 9, 6, 6]);

console.log('weekly cost matches the plan:');
const cost = key => areas.reduce((n, a) => n + (key === 'nominal' ? (a.perWeek.nominalTarget || a.perWeek.target) : a.perWeek[key]) * a.minutes, 0);
/* Nordic runs 3 a week in N1-N2, so the plan's 372 uses the stage override. */
const nordicN1 = byId.nordic.stages[0];
const adj = key => cost(key) + (nordicN1.perWeek[key] - byId.nordic.perWeek[key]) * byId.nordic.minutes;
eq('target week, with Nordic in N1-N2', adj('target'), 372);
eq('minimum week, with Nordic in N1-N2', adj('min'), 280);

console.log('overrides land where the plan says:');
eq('Nordic N1-N2 run 2/3/3 with 2 days between', byId.nordic.stages.slice(0, 2).map(s => [s.perWeek, s.minGapDays]), [[{ min: 2, target: 3, max: 3 }, 2], [{ min: 2, target: 3, max: 3 }, 2]]);
ok('Nordic N3 onward use the area defaults (3 days between)', byId.nordic.stages.slice(2).every(s => s.perWeek === undefined && s.minGapDays === undefined));
eq('Plyometrics Y5-Y6 need 3 days between', byId.plyo.stages.filter(s => s.minGapDays === 3).map(s => s.id), ['Y5', 'Y6']);
eq('Y5 advises pistol P4 and Nordic N3', byId.plyo.stages.find(s => s.id === 'Y5').requires, [{ area: 'pistol', stage: 'P4' }, { area: 'nordic', stage: 'N3' }]);
eq('Plyometrics has a vertical-jump test', byId.plyo.tests.map(t => t.id), ['vertical']);

console.log('kettlebell ladder:');
const kb = byId.kb.stages;
const bellKg = kb.filter(s => s.bells && !s.optional).map(s => s.bells[s.bells.length - 1].kg);
eq('bells climb from the ones you own to 50 kg', bellKg, [11.3, 16, 20, 24, 28, 32, 40, 48, 50]);
ok('every bell has a matching lb weight', kb.every(s => (s.bells || []).every(b => Math.abs(b.kg * 2.20462 - b.lb) < 1.5)));
eq('K1 uses the 15 lb and 25 lb you own', kb[0].bells.map(b => b.lb), [15, 25]);
eq('K6 and K8 are the book milestones', kb.filter(s => s.milestone).map(s => s.id), ['K6', 'K8']);
eq('the goal stage is the 50 kg bell', kb.find(s => s.goal).bells, [{ kg: 50, lb: 110 }]);

console.log('rules:');
const rid = new Set(index.areas);
rules.conflicts.forEach(c => ok(`conflict ${c.areas.join(' + ')} names real areas`, c.areas.length === 2 && c.areas.every(x => rid.has(x)) && c.why));
rules.budgets.forEach(b => ok(`budget ${b.areas.join(' + ')} names real areas`, b.areas.every(x => rid.has(x)) && isInt(b.maxPerWeek)));
eq('only Nordic and kettlebell is a soft conflict', rules.conflicts.filter(c => c.soft).map(c => c.areas), [['nordic', 'kb']]);
ok('time options ascend and include the default', rules.defaults.timeOptions.every((t, i, l) => !i || t > l[i - 1]) && rules.defaults.timeOptions.includes(rules.defaults.dayMinutes));
ok('up to three sittings', rules.defaults.maxSittings === 3);
eq('body area ids are unique', new Set(bodyIds).size, bodyIds.length);
eq('all seven body areas are collected at the check-in', rules.bodyAreas.filter(b => b.collected).map(b => b.id).sort(), ['achilles', 'elbow', 'hamstring', 'knee', 'lowerBack', 'shoulder', 'wrist']);
ok('and every area is guarded by body areas that are collected', areas.every(a => a.guardedBy.every(g => rules.bodyAreas.some(b => b.id === g && b.collected))));
ok('Achilles is kept for plyometrics', byId.plyo.guardedBy.includes('achilles'));
ok('verdict thresholds are numbers', Object.values(rules.verdicts).every(Number.isFinite));

console.log('legacy mapping:');
const planIds = new Set(); plan.sessions.forEach(s => s.exercises.forEach(e => planIds.add(e.id)));
const groups = [Object.keys(legacy.toArea), Object.keys(legacy.retired), legacy.ignore];
eq('every exercise in the old plan is placed exactly once', [...planIds].filter(id => groups.filter(g => g.includes(id)).length !== 1), []);
eq('nothing is mapped that the old plan never had', groups.flat().filter(id => !planIds.has(id)), []);
ok('every mapped area exists', Object.values(legacy.toArea).every(a => rid.has(a)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
