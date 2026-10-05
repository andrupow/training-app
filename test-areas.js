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
  'milestone', 'ready', 'note', 'requires', 'bells', 'perWeek', 'minGapDays',
  'exercises', 'equipment', 'types'];                      /* the last three arrive with the stage engine */
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
    ok(`${s.id}: ready is a list of strings`, Array.isArray(s.ready) && s.ready.every(r => typeof r === 'string' && r.length > 0));
    if (!s.optional) {
      ok(`${s.id}: has a standard to attest to`, s.ready.length > 0);
      const per = (s.perWeek || a.perWeek).target;
      ok(`${s.id}: askAfter is at least one week of the area (${per})`, isInt(s.askAfter) && s.askAfter >= per);
    }
    if (s.perWeek) ok(`${s.id}: stage perWeek is min <= target <= max`, s.perWeek.min <= s.perWeek.target && s.perWeek.target <= s.perWeek.max);
    if (s.minGapDays !== undefined) ok(`${s.id}: stage gap is a positive integer`, isInt(s.minGapDays) && s.minGapDays >= 1);
    (s.requires || []).forEach(r => ok(`${s.id}: requires ${r.area} ${r.stage}, which exists`, byId[r.area] && byId[r.area].stages.some(x => x.id === r.stage)));
  });
});

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
eq('the four existing check-in areas are collected', rules.bodyAreas.filter(b => b.collected).map(b => b.id).sort(), ['achilles', 'elbow', 'hamstring', 'shoulder']);
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
