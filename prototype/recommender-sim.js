/* PAPER PROTOTYPE — not app code, not imported by anything.
   Checks that the daily-recommender rules in AREAS-PLAN.md are satisfiable
   before they are built: can a 7-day week hit every area's target without
   breaking spacing, conflict or time-budget rules, and what happens when the
   user trains less, has less time, or an area is red-lit?

   Targets, gaps, minutes and conflicts below are the plan's placeholders.
   Assumes perfect compliance and no partial sessions.

   Run:  node prototype/recommender-sim.js */

'use strict';

/* min / target / max = days per Mon-Sun week. gap = minimum days between
   sessions of the same area (1 = daily is fine, 3 = at least 3 days apart). */
var AREAS = {
  mu:     { pri: 1, min: 2, target: 2, max: 3, gap: 2, mins: 30, load: 'high', name: 'Muscle-up' },
  hspu:   { pri: 2, min: 2, target: 2, max: 3, gap: 2, mins: 20, load: 'high', name: 'Handstand push-up' },
  bridge: { pri: 3, min: 2, target: 3, max: 5, gap: 1, mins: 12, load: 'low',  name: 'Backward bridge' },
  pistol: { pri: 4, min: 2, target: 2, max: 3, gap: 2, mins: 18, load: 'med',  name: 'Pistol squat' },
  nordic: { pri: 5, min: 1, target: 2, max: 2, gap: 3, mins: 10, load: 'high', name: 'Nordic curl' },
  kb:     { pri: 6, min: 3, target: 5, max: 6, gap: 1, mins: 30, load: 'med',  name: 'Kettlebell S&S' },
  oap:    { pri: 7, min: 1, target: 2, max: 2, gap: 3, mins: 20, load: 'high', name: 'One-arm pull-up' }
};

/* Never recommended together on the same day. The user can still add them. */
var CONFLICTS = [
  ['mu', 'oap',   'both load the elbow tendons'],
  ['nordic', 'kb', 'both load the hamstrings'],
  ['hspu', 'mu',  'both load shoulders and triceps']
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

/* ---- the recommender: a pure function of history, rules and the date ---- */

function recommend(date, hist, opts) {
  opts = opts || {};
  var blocked = opts.blocked || {};                       /* area -> reason (red light) */
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
      var used = b.areas.reduce(function (n, x) { return n + wk[x]; }, 0);
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

  var picked = [], reasons = {}, shortfall = [], mins = 0, high = 0;

  cands.forEach(function (c) {
    var A = AREAS[c.area];
    if (c.need <= 0) return;                              /* target met: not recommended */
    if (picked.length >= RULES.maxAreas) return;
    if (mins + A.mins > dayMin) { shortfall.push(c.area); return; }   /* the time budget is hard */
    if (A.load === 'high' && high >= RULES.maxHigh) return;

    var clash = CONFLICTS.filter(function (k) {
      return (k[0] === c.area && picked.indexOf(k[1]) >= 0) || (k[1] === c.area && picked.indexOf(k[0]) >= 0);
    })[0];
    if (clash) { skipped.push({ area: c.area, why: 'not with ' + (clash[0] === c.area ? clash[1] : clash[0]) + ': ' + clash[2] }); return; }

    picked.push(c.area);
    reasons[c.area] = (c.must ? 'DUE · ' : '') + c.reason;
    mins += A.mins;
    if (A.load === 'high') high++;
  });

  return { picked: picked, mins: mins, reasons: reasons, skipped: skipped, shortfall: shortfall };
}

/* ---- simulation ---- */

function simulate(label, weeks, o) {
  o = o || {};
  var start = '2026-10-05';                               /* a Monday */
  var hist = {}, log = [];
  Object.keys(AREAS).forEach(function (a) { hist[a] = []; });

  for (var i = 0; i < weeks * 7; i++) {
    var d = addDays(start, i);
    if (o.restDays && o.restDays.indexOf(dow(d)) >= 0) { log.push({ d: d, rest: true }); continue; }
    var r = recommend(d, hist, { dayMinutes: o.dayMinutes, blocked: o.blockedOn && o.blockedOn(i) });
    r.picked.forEach(function (a) { hist[a].push(d); });
    log.push({ d: d, picked: r.picked, mins: r.mins });
  }

  console.log('\n== ' + label + ' ==');
  console.log('week  ' + Object.keys(AREAS).map(function (a) { return a.padEnd(7); }).join(''));
  for (var w = 0; w < Math.min(weeks, 3); w++) {
    var ws = addDays(start, w * 7), we = addDays(ws, 6);
    console.log(('W' + (w + 1)).padEnd(6) + Object.keys(AREAS).map(function (a) {
      var n = hist[a].filter(function (d) { return d >= ws && d <= we; }).length;
      var A = AREAS[a];
      return (n + (n < A.min ? '!' : n < A.target ? '-' : '')).padEnd(7);
    }).join(''));
  }

  /* steady state: every week from the second onward */
  var short = 0, belowMin = 0, total = 0;
  for (var w2 = 1; w2 < weeks; w2++) {
    var s2 = addDays(start, w2 * 7), e2 = addDays(s2, 6);
    Object.keys(AREAS).forEach(function (a) {
      var n = hist[a].filter(function (d) { return d >= s2 && d <= e2; }).length;
      total++;
      if (n < AREAS[a].target) short++;
      if (n < AREAS[a].min) belowMin++;
    });
  }
  var trained = log.filter(function (l) { return !l.rest; });
  var mins = trained.map(function (l) { return l.mins; });
  var violations = 0;
  Object.keys(AREAS).forEach(function (a) {
    var h = hist[a];
    for (var k = 1; k < h.length; k++) if (diff(h[k - 1], h[k]) < AREAS[a].gap) violations++;
  });
  trained.forEach(function (l) {
    CONFLICTS.forEach(function (c) { if (l.picked.indexOf(c[0]) >= 0 && l.picked.indexOf(c[1]) >= 0) violations++; });
  });

  console.log('legend: ! below minimum, - below target');
  console.log('steady state (week 2+): below target ' + short + '/' + total + ' area-weeks, below minimum ' + belowMin +
    ' | minutes/day ' + Math.min.apply(null, mins) + '-' + Math.max.apply(null, mins) +
    ' avg ' + Math.round(mins.reduce(function (a, b) { return a + b; }, 0) / mins.length) +
    ' | rule violations ' + violations);
  return { hist: hist, log: log };
}

var needed = Object.keys(AREAS).reduce(function (n, a) { return n + AREAS[a].target * AREAS[a].mins; }, 0);
var needMin = Object.keys(AREAS).reduce(function (n, a) { return n + AREAS[a].min * AREAS[a].mins; }, 0);
console.log('Weekly minutes at target: ' + needed + ' (~' + Math.round(needed / 7) + ' min/day over 7 days); at minimums: ' + needMin);

var sim = simulate('A. follows every recommendation, 7 days/week, 60 min/day', 8);
simulate('E. rests Sundays only (6 days/week)', 8, { restDays: [6] });
simulate('F. 5 days/week (Wed + Sun off) with 90 min/day', 8, { restDays: [2, 6], dayMinutes: 90 });
simulate('B. 5 days/week (Wed + Sun off) at 60 min/day  [budget too small: expected to fall short]', 8, { restDays: [2, 6] });
simulate('C. 30 min/day  [budget too small: expected to fall short]', 8, { dayMinutes: 30 });
simulate('D. hamstring red for the first 5 days (nordic + kb blocked)', 4, {
  blockedOn: function (i) { return i < 5 ? { nordic: 'hamstring red', kb: 'hamstring red' } : null; }
});

/* What the Today screen would show: day 1 of week 3 of scenario A. */
var day = addDays('2026-10-05', 14 + 3);
var hist2 = {};
Object.keys(sim.hist).forEach(function (a) { hist2[a] = sim.hist[a].filter(function (d) { return d < day; }); });
var menu = recommend(day, hist2);
console.log('\n== Today\'s menu, ' + day + ' ==');
menu.picked.forEach(function (a) { console.log('  [x] ' + AREAS[a].name.padEnd(20) + String(AREAS[a].mins).padStart(3) + ' min   ' + menu.reasons[a]); });
menu.skipped.forEach(function (s) { console.log('  [ ] ' + AREAS[s.area].name.padEnd(20) + '         ' + s.why); });
console.log('  total ' + menu.mins + ' min');
