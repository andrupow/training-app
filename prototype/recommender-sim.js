/* PAPER PROTOTYPE — not app code, not imported by anything.
   Checks that the daily-recommender rules in AREAS-PLAN.md are satisfiable
   before they are built: can a 7-day week hit each area's target without
   breaking spacing, conflict or time-budget rules, and what gives when the
   day is short or an area is red-lit?

   Each day it picks the best combination of areas that fits the time budget,
   spacing, conflict and high-load limits (a brute-force search over at most 256
   subsets), after a first version that picked greedily starved the second-priority
   area.

   Targets, gaps, minutes and conflicts are the plan's placeholders.
   Assumes perfect compliance and no partial sessions.

   Run:  node prototype/recommender-sim.js */

'use strict';

/* min / target / max = days per Mon-Sun week. gap = minimum days between
   sessions of the same area (1 = daily is fine, 3 = at least 3 days apart). */
var BASE = {
  mu:     { pri: 1, min: 2, target: 2, max: 3, gap: 2, mins: 30, load: 'high', name: 'Muscle-up' },
  hspu:   { pri: 2, min: 2, target: 2, max: 3, gap: 2, mins: 20, load: 'high', name: 'Handstand push-up' },
  bridge: { pri: 3, min: 2, target: 3, max: 5, gap: 1, mins: 12, load: 'low',  name: 'Backward bridge' },
  pistol: { pri: 4, min: 2, target: 2, max: 3, gap: 2, mins: 18, load: 'med',  name: 'Pistol squat' },
  nordic: { pri: 5, min: 1, target: 2, max: 2, gap: 3, mins: 10, load: 'high', name: 'Nordic curl' },
  kb:     { pri: 6, min: 3, target: 5, max: 6, gap: 1, mins: 30, load: 'med',  name: 'Kettlebell S&S' },
  oap:    { pri: 7, min: 1, target: 2, max: 2, gap: 3, mins: 20, load: 'high', name: 'One-arm pull-up' },
  plyo:   { pri: 8, min: 1, target: 2, max: 2, gap: 2, mins: 20, load: 'high', name: 'Plyometrics' }
};

/* Pairs never recommended on the same day. soft = allowed when the area
   would otherwise miss its target (its spacing says it must go today). */
var CONFLICTS = [
  { a: 'mu',     b: 'oap',    why: 'both load the elbow tendons' },
  { a: 'hspu',   b: 'mu',     why: 'both load shoulders and triceps' },
  { a: 'nordic', b: 'kb',     why: 'both load the hamstrings' },
  { a: 'plyo',   b: 'nordic', why: 'jumping on tired hamstrings' }
];

/* A cap shared across areas, per week. */
var BUDGETS = [{ areas: ['mu', 'oap'], maxPerWeek: 4, why: 'elbow tendon' }];

var RULES = { dayMinutes: 60, maxAreas: 4, maxHigh: 2 };

/* ---- dates: strings only, as in the app ---- */
function addDays(s, n) {
  var d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dow(s) { return (new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7; }   /* Mon = 0 */
function diff(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }

/* ---- the recommender: a pure function of history, config and the date ---- */

function recommend(date, hist, cfg, opts) {
  opts = opts || {};
  var AREAS = cfg.areas, blocked = opts.blocked || {};
  var dayMin = opts.dayMinutes != null ? opts.dayMinutes : RULES.dayMinutes;
  var weekStart = addDays(date, -dow(date));
  var daysLeft = 7 - dow(date);                           /* including today */

  var wk = {}, last = {}, cands = [], skipped = [];

  Object.keys(AREAS).forEach(function (a) {
    var days = hist[a] || [];
    wk[a] = days.filter(function (d) { return d >= weekStart && d < date; }).length;
    last[a] = days.filter(function (d) { return d < date; }).sort().pop() || null;
  });

  Object.keys(AREAS).forEach(function (a) {
    var A = AREAS[a], why = null;

    if (blocked[a]) why = 'blocked: ' + blocked[a];
    else if (wk[a] >= A.max) why = 'at weekly max (' + A.max + ')';
    else if (last[a] && diff(last[a], date) < A.gap) why = 'too soon: last ' + diff(last[a], date) + ' d ago, needs ' + A.gap;
    else BUDGETS.forEach(function (b) {
      var used = b.areas.reduce(function (n, x) { return n + (wk[x] || 0); }, 0);
      if (b.areas.indexOf(a) >= 0 && used >= b.maxPerWeek) why = 'weekly ' + b.why + ' budget used (' + used + '/' + b.maxPerWeek + ')';
    });

    if (why) { skipped.push({ area: a, why: why }); return; }

    /* How tight is it to fit the remaining sessions, spaced by gap, before Sunday? */
    var need = A.target - wk[a];
    var span = need > 0 ? (need - 1) * A.gap + 1 : 0;
    var needMin = Math.max(0, A.min - wk[a]);
    var spanMin = needMin > 0 ? (needMin - 1) * A.gap + 1 : 0;

    cands.push({
      area: a,
      need: need,
      pressure: need > 0 ? (need * A.gap) / daysLeft : 0,
      stale: last[a] ? diff(last[a], date) / (7 / A.target) : 9,
      must: need > 0 && span >= daysLeft,
      mustMin: needMin > 0 && spanMin >= daysLeft,
      reason: wk[a] + '/' + A.target + ' this week, ' + (last[a] ? diff(last[a], date) + ' d since last' : 'not trained yet')
    });
  });

  /* 1) a minimum about to become impossible jumps the queue, highest priority first
     2) then everything by how tight the spacing to its target is */
  cands.sort(function (x, y) {
    return (y.mustMin - x.mustMin)
      || (x.mustMin && y.mustMin ? AREAS[x.area].pri - AREAS[y.area].pri : 0)
      || (y.must - x.must) || (y.pressure - x.pressure)
      || (y.stale - x.stale) || (AREAS[x.area].pri - AREAS[y.area].pri);
  });

  var picked = [], reasons = {}, mins = 0, high = 0;

  function clashOf(area, others) {
    return cfg.conflicts.filter(function (k) {
      return (k.a === area && others.indexOf(k.b) >= 0) || (k.b === area && others.indexOf(k.a) >= 0);
    })[0];
  }

  if (cfg.mode === 'greedy') {
    cands.forEach(function (c) {
      var A = AREAS[c.area];
      if (c.need <= 0) return;                              /* target met: not recommended */
      if (picked.length >= RULES.maxAreas) return;
      if (mins + A.mins > dayMin) return;                   /* the time budget is hard */
      if (A.load === 'high' && high >= RULES.maxHigh) return;

      var clash = clashOf(c.area, picked);
      if (clash && !(clash.soft && (c.must || c.mustMin))) {
        skipped.push({ area: c.area, why: 'not with ' + (clash.a === c.area ? clash.b : clash.a) + ': ' + clash.why });
        return;
      }
      picked.push(c.area);
      reasons[c.area] = (c.must ? 'DUE · ' : '') + c.reason + (clash ? ' · after ' + (clash.a === c.area ? clash.b : clash.a) : '');
      mins += A.mins;
      if (A.load === 'high') high++;
    });
  } else {
    /* Best combination that fits. With <= 8 areas that is at most 256 subsets a day.
       Value rewards urgent minimums and tight spacing, weighted by priority, so a
       high-priority area is not starved by a lower one that merely looks urgent. */
    var pool = cands.filter(function (c) { return c.need > 0; });
    var w = function (c) { return 1 + (9 - AREAS[c.area].pri) * 0.12; };
    pool.forEach(function (c) {
      c.value = w(c) * (4 * c.mustMin + 2 * c.must + c.pressure + 0.25 * Math.min(c.stale, 4));
    });

    var best = null;
    for (var m = 1; m < (1 << pool.length); m++) {
      var set = [], t = 0, h = 0, ok = true, v = 0;
      for (var b = 0; b < pool.length && ok; b++) {
        if (!(m & (1 << b))) continue;
        var c2 = pool[b], A2 = AREAS[c2.area];
        t += A2.mins; if (A2.load === 'high') h++;
        set.push(c2); v += c2.value;
        if (set.length > RULES.maxAreas || t > dayMin || h > RULES.maxHigh) ok = false;
      }
      if (!ok) continue;
      for (var i = 0; i < set.length && ok; i++) for (var j = i + 1; j < set.length && ok; j++) {
        var k = cfg.conflicts.filter(function (q) {
          return (q.a === set[i].area && q.b === set[j].area) || (q.b === set[i].area && q.a === set[j].area);
        })[0];
        if (k && !(k.soft && (set[i].must || set[i].mustMin || set[j].must || set[j].mustMin))) ok = false;
      }
      if (!ok) continue;
      if (!best || v > best.v + 1e-9 || (Math.abs(v - best.v) < 1e-9 && t < best.t)) best = { set: set, v: v, t: t };
    }
    if (best) best.set.sort(function (x, y) { return AREAS[x.area].pri - AREAS[y.area].pri; }).forEach(function (c) {
      picked.push(c.area);
      reasons[c.area] = (c.must ? 'DUE · ' : '') + c.reason;
      mins += AREAS[c.area].mins;
    });
    pool.forEach(function (c) {
      if (picked.indexOf(c.area) >= 0) return;
      var cl = clashOf(c.area, picked);
      skipped.push({ area: c.area, why: cl ? 'not with ' + (cl.a === c.area ? cl.b : cl.a) + ': ' + cl.why : 'does not fit today\'s time' });
    });
  }

  return { picked: picked, mins: mins, reasons: reasons, skipped: skipped };
}

/* ---- simulation ---- */

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function run(cfg, weeks, o) {
  o = o || {};
  var start = '2026-10-05';                               /* a Monday */
  var hist = {}, log = [];
  Object.keys(cfg.areas).forEach(function (a) { hist[a] = []; });

  for (var i = 0; i < weeks * 7; i++) {
    var d = addDays(start, i), minsToday = typeof o.dayMinutes === 'function' ? o.dayMinutes(dow(d)) : o.dayMinutes;
    if (o.restDays && o.restDays.indexOf(dow(d)) >= 0) { log.push({ d: d, rest: true }); continue; }
    var r = recommend(d, hist, cfg, { dayMinutes: minsToday, blocked: o.blockedOn && o.blockedOn(i) });
    r.picked.forEach(function (a) { hist[a].push(d); });
    log.push({ d: d, picked: r.picked, mins: r.mins });
  }

  /* steady state: weeks 2..N, average days per area per week */
  var avg = {}, belowMin = 0, belowTarget = 0;
  Object.keys(cfg.areas).forEach(function (a) {
    var tot = 0;
    for (var w = 1; w < weeks; w++) {
      var s = addDays(start, w * 7), e = addDays(s, 6);
      var n = hist[a].filter(function (d) { return d >= s && d <= e; }).length;
      tot += n;
      if (n < cfg.areas[a].min) belowMin++;
      if (n < cfg.areas[a].target) belowTarget++;
    }
    avg[a] = tot / (weeks - 1);
  });

  var trained = log.filter(function (l) { return !l.rest; });
  var viol = 0;
  Object.keys(cfg.areas).forEach(function (a) {
    var h = hist[a];
    for (var k = 1; k < h.length; k++) if (diff(h[k - 1], h[k]) < cfg.areas[a].gap) viol++;
  });
  trained.forEach(function (l) {
    cfg.conflicts.forEach(function (c) {
      if (!c.soft && l.picked.indexOf(c.a) >= 0 && l.picked.indexOf(c.b) >= 0) viol++;
    });
  });
  var minsAvg = Math.round(trained.reduce(function (n, l) { return n + l.mins; }, 0) / trained.length);

  return { hist: hist, log: log, avg: avg, belowMin: belowMin, belowTarget: belowTarget, viol: viol, minsAvg: minsAvg };
}

function report(label, cfg, weeks, o) {
  var r = run(cfg, weeks, o);
  var line = Object.keys(cfg.areas).map(function (a) {
    var A = cfg.areas[a], v = r.avg[a];
    var mark = v < A.min - 0.01 ? '!' : v < A.target - 0.01 ? '-' : ' ';
    return (v.toFixed(1) + mark).padStart(5);
  }).join('');
  console.log(label.padEnd(54) + line + ' | ' + String(r.minsAvg).padStart(3) + ' min/day | viol ' + r.viol);
  return r;
}

function header() {
  console.log('\n' + ''.padEnd(54) + Object.keys(BASE).map(function (a) { return a.padStart(5); }).join('') + ' |');
  console.log(''.padEnd(54) + Object.keys(BASE).map(function (a) { return String(BASE[a].target).padStart(4) + ' '; }).join('') + ' | (nominal)');
}

function cfgWith(mods) {
  var c = { areas: clone(BASE), conflicts: clone(CONFLICTS), mode: 'subset' };
  (mods || []).forEach(function (m) { m(c); });
  return c;
}
var greedy = function (c) { c.mode = 'greedy'; };
var nordic3 = function (c) { c.areas.nordic.min = 2; c.areas.nordic.target = 3; c.areas.nordic.max = 3; c.areas.nordic.gap = 2; };
var softNordicKb = function (c) { c.conflicts.forEach(function (k) { if (k.a === 'nordic' && k.b === 'kb') k.soft = true; }); };
var noPlyo = function (c) { delete c.areas.plyo; c.conflicts = c.conflicts.filter(function (k) { return k.a !== 'plyo' && k.b !== 'plyo'; }); };

var MIXED = function (d) { return [45, 45, 30, 45, 45, 60, 60][d]; };     /* Mon..Sun, 330 min/week */

/* Plan defaults after the review: Nordic 3 a week, kettlebell nominal 5 but
   time-fitted to 3, never on the same day unless the area would miss its target. */
var KB3 = function (c) { c.areas.kb.target = 3; c.areas.kb.min = 2; };
var NOW = [nordic3, softNordicKb, KB3];

var cost = function (c, key) { return Object.keys(c.areas).reduce(function (n, a) { return n + c.areas[a][key] * c.areas[a].mins; }, 0); };
var nominal = cfgWith([nordic3, softNordicKb]), fitted = cfgWith(NOW);
console.log('Weekly minutes, eight areas: nominal targets (KB 5) ' + cost(nominal, 'target') + ', plan defaults (KB 3) ' +
            cost(fitted, 'target') + ' (' + Math.round(cost(fitted, 'target') / 7) + ' min/day), minimums ' + cost(fitted, 'min') +
            ' (' + Math.round(cost(fitted, 'min') / 7) + ' min/day).');
console.log('Cells: average days per week over weeks 2-10.   ! below minimum   - below target');

console.log('\nHow the day is picked: best combination that fits vs greedy (mixed 30-60 week)');
header();
report('greedy, KB 5, Nordic 3', cfgWith([greedy, nordic3, softNordicKb]), 10, { dayMinutes: MIXED });
report('best combination, KB 5, Nordic 3', cfgWith([nordic3, softNordicKb]), 10, { dayMinutes: MIXED });

console.log('\nNordic 3 a week and KB 5 a week: do they fit?');
header();
report('60 min every day, KB 5, Nordic 3', cfgWith([nordic3, softNordicKb]), 10, { dayMinutes: 60 });
report('60 min every day, KB 5, Nordic 2', cfgWith([]), 10, { dayMinutes: 60 });
report('60 min every day, KB 3, Nordic 3', cfgWith(NOW), 10, { dayMinutes: 60 });
report('mixed 30-60, KB 5, Nordic 3', cfgWith([nordic3, softNordicKb]), 10, { dayMinutes: MIXED });
report('mixed 30-60, KB 3, Nordic 3   <- plan default', cfgWith(NOW), 10, { dayMinutes: MIXED });

console.log('\nThe time you actually have (plan defaults)');
header();
report('60 min every day (420 min/week)', cfgWith(NOW), 10, { dayMinutes: 60 });
report('mixed 30-60: 45 45 30 45 45 60 60 (330 min/week)', cfgWith(NOW), 10, { dayMinutes: MIXED });
report('45 min every day (315 min/week)', cfgWith(NOW), 10, { dayMinutes: 45 });
report('30 min every day (210 min/week)', cfgWith(NOW), 10, { dayMinutes: 30 });

console.log('\nSeven areas instead of eight (mixed 30-60 week)');
header();
var noPlyoKb5 = [nordic3, softNordicKb, noPlyo];
report('no plyometrics, KB 5, Nordic 3', cfgWith(noPlyoKb5), 10, { dayMinutes: MIXED });

console.log('\nSafety: hamstring red for the first 5 days (nordic + kb blocked), 60 min');
header();
report('red days 1-5, then green', cfgWith(NOW), 4, { dayMinutes: 60, blockedOn: function (i) { return i < 5 ? { nordic: 'hamstring red', kb: 'hamstring red' } : null; } });

/* What the Today screen would show: a 45-minute Thursday in the mixed week. */
var cfg = fitted;
var sim = run(cfg, 8, { dayMinutes: MIXED });
var day = addDays('2026-10-05', 14 + 3);
var hist2 = {};
Object.keys(sim.hist).forEach(function (a) { hist2[a] = sim.hist[a].filter(function (d) { return d < day; }); });
var menu = recommend(day, hist2, cfg, { dayMinutes: MIXED(dow(day)) });
console.log('\nToday\'s menu, ' + day + ', budget ' + MIXED(dow(day)) + ' min:');
menu.picked.forEach(function (a) { console.log('  [x] ' + cfg.areas[a].name.padEnd(20) + String(cfg.areas[a].mins).padStart(3) + ' min   ' + menu.reasons[a]); });
menu.skipped.forEach(function (x) { console.log('  [ ] ' + cfg.areas[x.area].name.padEnd(20) + '         ' + x.why); });
console.log('  total ' + menu.mins + ' min');
