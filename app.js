/* The Integrated Plan — Milestones 1-8, complete; M9-M10 runner and rescheduling;
   M11 workout areas (read-only)
   Shell + PWA + plan browser + today's session with set logging
   + dated baselines and the load calculator + rest timer + JSON backup
   + morning check-in, the traffic light, HOLD gating and progression charts.
   Vanilla JS, no build step. */

'use strict';

var BUILD = '1.10.0-m11';
var PLAN_URL = 'data/plan.json';
var LS_PLAN = 'plan.cache.v1';
var LS_LOGS = 'setLogs';
var LS_BASELINES = 'baselines';
var LS_CHECKINS = 'checkIns';
var LS_SETTINGS = 'settings';
var LS_SCHEDULE = 'schedule';
var LS_DAYPLANS = 'dayPlans';      /* the menu of each day, so the week can say what was skipped */
var LS_AREADAYS = 'areaDays';      /* what each area-day contained, fixed when it was first planned */

/* Everything the app owns, in one list. Export walks it, import restores it,
   and Milestone 5 gets checkIns backed up without touching this file. */
var COLLECTIONS = [LS_BASELINES, LS_LOGS, LS_CHECKINS, LS_SCHEDULE, LS_SETTINGS, LS_DAYPLANS, LS_AREADAYS];

var EXPORT_NAG_DAYS = 7;
var LS_TIMER = 'restTimer';

var plan = null;
var planScroll = 0;     /* remember where the week list was scrolled to */
var todaySession = null; /* the session the Today tab is currently showing */

/* ---------------------------------------------------------------- storage */
/* localStorage can throw: private mode, storage pressure, quota. */

function lsGet(key) {
  try {
    var raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch (err) {
    console.warn('localStorage read failed', key, err);
    return null;
  }
}

/* ------------------------------------------------------------------- logs */
/* setLogs[] = { sessionId, exerciseId, setIdx, done, loadKg?, reps?, rpe?, ts }
   One localStorage key, one flat array, plus an in-memory index so a tap
   between sets never walks 900 rows. Exercise ids are unique within a
   session, so sessionId|exerciseId|setIdx is a safe key. */

var setLogs = [];
var logIndex = {};

function logKey(sessionId, exerciseId, setIdx) {
  return sessionId + '|' + exerciseId + '|' + setIdx;
}

function loadLogs() {
  var stored = lsGet(LS_LOGS);
  setLogs = Array.isArray(stored) ? stored : [];
  logIndex = {};
  setLogs.forEach(function (e) {
    logIndex[logKey(e.sessionId, e.exerciseId, e.setIdx)] = e;
  });
}

function getLog(sessionId, exerciseId, setIdx) {
  return logIndex[logKey(sessionId, exerciseId, setIdx)] || null;
}

function saveLogs() {
  try {
    localStorage.setItem(LS_LOGS, JSON.stringify(setLogs));
    return true;
  } catch (err) {
    console.warn('setLogs write failed', err);
    toast('Could not save — phone storage is full or blocked.');
    return false;
  }
}

/* Patch one set. undefined in the patch deletes that field. A row that ends
   up carrying nothing is dropped rather than left as an empty husk. */
function writeLog(sessionId, exerciseId, setIdx, patch) {
  var key = logKey(sessionId, exerciseId, setIdx);
  var entry = logIndex[key];

  if (!entry) {
    entry = { sessionId: sessionId, exerciseId: exerciseId, setIdx: setIdx, done: false };
    setLogs.push(entry);
    logIndex[key] = entry;
  }

  Object.keys(patch).forEach(function (k) {
    if (patch[k] === undefined) delete entry[k];
    else entry[k] = patch[k];
  });
  entry.ts = new Date().toISOString();

  if (!entry.done && entry.loadKg === undefined && entry.reps === undefined && entry.rpe === undefined) {
    setLogs = setLogs.filter(function (e) { return e !== entry; });
    delete logIndex[key];
    entry = null;
  }

  saveLogs();
  return entry;
}

function hasDetail(entry) {
  return !!entry && (entry.loadKg !== undefined || entry.reps !== undefined || entry.rpe !== undefined);
}

/* The red light pulls exercises off the page (see sessionGate). They have to
   leave the sums as well, or a session with one of them paused could never
   read as done. The logs themselves are untouched. */
function activeExercises(session) {
  if (areaPaused(session)) return [];
  var suppressed = sessionGate(session).suppressed;
  return session.exercises.filter(function (ex) { return !(ex.track && suppressed[ex.track]); });
}

function totalSets(session) {
  return activeExercises(session).reduce(function (n, ex) { return n + (Number(ex.sets) || 0); }, 0);
}

function doneSets(session) {
  var n = 0;
  activeExercises(session).forEach(function (ex) {
    for (var i = 0; i < (Number(ex.sets) || 0); i++) {
      var e = getLog(session.id, ex.id, i);
      if (e && e.done) n++;
    }
  });
  return n;
}

function sessionHasLogs(session) {
  return session.exercises.some(function (ex) {
    for (var i = 0; i < (Number(ex.sets) || 0); i++) {
      if (getLog(session.id, ex.id, i)) return true;
    }
    return false;
  });
}

/* ------------------------------------------------------------------ dates */
/* Everything is a YYYY-MM-DD string and compared as a string.
   Never build a Date from a plan date — that lands on the wrong day
   either side of midnight. */

var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function todayISO() {
  var d = new Date();                       /* local calendar day, not UTC */
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function fmtDate(iso) {
  var p = String(iso).split('-');
  if (p.length !== 3) return String(iso);
  return Number(p[2]) + ' ' + (MONTHS[Number(p[1]) - 1] || '?') + ' ' + p[0];
}

function fmtDateShort(iso) {
  var p = String(iso).split('-');
  if (p.length !== 3) return String(iso);
  return Number(p[2]) + ' ' + (MONTHS[Number(p[1]) - 1] || '?');
}

function fmtRest(sec) {
  if (!sec) return null;
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/* -------------------------------------------------------------- baselines */
/* baselines[] = { date, bodyweightKg, pullup5RMAddedKg, maxCleanDips,
                   maxSLHeelRaises, nordicBreakPoint }
   Append-only and dated: a recalibration must never rewrite what a past
   session was actually done at. Kept sorted by date ascending. */

var baselines = [];

function loadBaselines() {
  var stored = lsGet(LS_BASELINES);
  baselines = Array.isArray(stored) ? stored : [];
  sortBaselines();
}

function sortBaselines() {
  baselines.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

function saveBaselines() {
  try {
    localStorage.setItem(LS_BASELINES, JSON.stringify(baselines));
    return true;
  } catch (err) {
    console.warn('baselines write failed', err);
    toast('Could not save — phone storage is full or blocked.');
    return false;
  }
}

/* The entry in force on a given date — the most recent one dated on or
   before it. Never the newest unconditionally, or every past session
   silently rewrites itself the moment you recalibrate. */
function baselinesFor(date) {
  var found = null;
  for (var i = 0; i < baselines.length; i++) {
    if (baselines[i].date <= date) found = baselines[i];
    else break;                       /* sorted ascending, so we are past it */
  }
  return found;
}

function latestBaselines() {
  return baselines.length ? baselines[baselines.length - 1] : null;
}

/* ------------------------------------------------------- traffic light */
/* checkIns[] = { date, pain: {elbow, shoulder, achilles, hamstring},
                  stiffness, note }

   The verdict is never stored. It is recomputed from checkIns every time it
   is asked for, so correcting a pain entry fixes everything downstream by
   itself. Evaluated per area, using that area's pain and the check-in's
   single stiffness reading. */

var checkIns = [];

var STIFFNESS = [
  { value: 'none',    label: 'None' },
  { value: 'under30', label: 'Under 30 min' },
  { value: '30to60',  label: '30–60 min' },
  { value: 'over60',  label: 'Over 60 min' }
];

var STIFFNESS_GREEN = ['none', 'under30'];

function loadCheckIns() {
  var stored = lsGet(LS_CHECKINS);
  checkIns = Array.isArray(stored) ? stored : [];
  sortCheckIns();
}

function sortCheckIns() {
  checkIns.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

function saveCheckIns() {
  try {
    localStorage.setItem(LS_CHECKINS, JSON.stringify(checkIns));
    return true;
  } catch (err) {
    console.warn('checkIns write failed', err);
    toast('Could not save — phone storage is full or blocked.');
    return false;
  }
}

function checkInOn(date) {
  return checkIns.filter(function (c) { return c.date === date; })[0] || null;
}

function painOf(checkIn, area) {
  var p = checkIn && checkIn.pain ? Number(checkIn.pain[area]) : NaN;
  return isFinite(p) ? p : 0;
}

function areas() {
  return plan.trafficLight.areas;
}

function tracksForArea(area) {
  return plan.trafficLight.areaToTracks[area] || [];
}

/* "pain rising 3 sessions running" — strictly up across three consecutive
   check-ins for that one area. A plateau is not a rise. */
function risingThree(area, checkIn, prior) {
  if (prior.length < 2) return false;
  var a = painOf(prior[prior.length - 2], area);
  var b = painOf(prior[prior.length - 1], area);
  var c = painOf(checkIn, area);
  return a < b && b < c;
}

/* prior = the check-ins before this one, oldest first. */
function areaState(area, checkIn, prior) {
  var pain = painOf(checkIn, area);
  var stiff = checkIn ? checkIn.stiffness : null;

  if (pain > 5 || stiff === 'over60') return 'red';
  if (risingThree(area, checkIn, prior || [])) return 'red';
  if ((pain >= 4 && pain <= 5) || stiff === '30to60') return 'amber';
  if (pain <= 3 && STIFFNESS_GREEN.indexOf(stiff) >= 0) return 'green';
  return 'amber';                 /* nothing unclassified slips through as green */
}

/* Everything before this date, so a draft being edited today is judged
   against real history rather than against itself. */
function priorTo(date) {
  return checkIns.filter(function (c) { return c.date < date; });
}

function areaStates(checkIn, prior) {
  var out = {};
  var before = prior || priorTo(checkIn.date);
  areas().forEach(function (a) { out[a] = areaState(a, checkIn, before); });
  return out;
}

var STATE_RANK = { green: 0, amber: 1, red: 2 };

function worstState(states) {
  var worst = 'green';
  Object.keys(states).forEach(function (k) {
    if (STATE_RANK[states[k]] > STATE_RANK[worst]) worst = states[k];
  });
  return worst;
}

/* The plan's own words, not a paraphrase. */
function stateAction(state) {
  var rule = plan.trafficLight.rules.filter(function (r) { return r.state === state; })[0];
  return rule ? rule.action : '';
}

/* ------------------------------------------------------------------ loads */
/* The whole reason this app exists: every load in the plan is a percentage
   of a calibrated number, and working that out on a gym floor five times a
   day is the thing being automated. */

var PLATE = 1.25;                     /* smallest plate pair */

function roundToPlate(kg) {
  return Math.round(kg / PLATE) * PLATE;
}

/* 18.75 → "18.75", 15.00 → "15" */
function fmtKg(kg) {
  return String(Number(kg.toFixed(2)));
}

function usableNumber(v) {
  var n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

/* Returns { text, kg, missing } — never NaN, whatever the inputs. */
function resolveLoad(load, date) {
  if (!load || !load.type) return { text: '—', kg: null, missing: false };

  switch (load.type) {
    case 'bodyweight': return { text: 'Bodyweight', kg: null, missing: false };
    case 'text':       return { text: load.text || '—', kg: null, missing: false };
    case 'none':       return { text: '—', kg: null, missing: false };

    case 'fixedKg': {
      var fixed = Number(load.value);
      if (!isFinite(fixed)) return { text: '—', kg: null, missing: false };
      return { text: '+' + fmtKg(fixed) + ' kg', kg: fixed, missing: false };
    }

    case 'pct5RM':
    case 'pctBW': {
      var b = baselinesFor(date);
      var field = load.type === 'pct5RM' ? 'pullup5RMAddedKg' : 'bodyweightKg';
      var base = b ? usableNumber(b[field]) : null;

      if (base === null) {
        return { text: '— set baselines', kg: null, missing: true };
      }

      var pctValue = Number(load.value);
      if (!isFinite(pctValue)) return { text: '—', kg: null, missing: false };

      var kg = roundToPlate(base * pctValue);
      return { text: '+' + fmtKg(kg) + ' kg', kg: kg, missing: false };
    }

    default: return { text: '—', kg: null, missing: false };
  }
}

/* The rule itself, for the baselines screen — "72% of 5RM", not a number. */
function ruleText(load) {
  if (!load || !load.type) return '—';
  switch (load.type) {
    case 'pct5RM':     return pct(load.value) + '% of 5RM added';
    case 'pctBW':      return pct(load.value) + '% bodyweight';
    case 'fixedKg':    return '+' + load.value + ' kg';
    case 'bodyweight': return 'Bodyweight';
    case 'text':       return load.text || '—';
    default:           return '—';
  }
}

function pct(v) {
  return String(Math.round(Number(v) * 1000) / 10);
}

/* -------------------------------------------------------------------- dom */

function el(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) return;
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
  }
  (children || []).forEach(function (c) {
    if (c === null || c === undefined || c === false) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

function badge(text, cls) {
  return el('span', { class: 'badge ' + (cls || ''), text: text });
}

/* ------------------------------------------------------------- schedule */
/* A session has two dates: the one the plan was written with, and the one
   you actually trained it on. Everything that cares about WHEN — loads,
   Today, ordering, red-light windows — must read the effective date.

   Two things deliberately keep the plan date instead:
     - week identity and week windows, because check-ins are real calendar
       mornings and re-deriving weeks from moved sessions would make the
       amber-holds-next-week rule circular;
     - checkpoints, which are fixed diary entries. */

var schedule = {};        /* sessionId -> 'YYYY-MM-DD' | 'skipped' */

function loadSchedule() {
  var stored = lsGet(LS_SCHEDULE);
  schedule = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {};
}

function saveSchedule() {
  try {
    localStorage.setItem(LS_SCHEDULE, JSON.stringify(schedule));
    return true;
  } catch (err) {
    console.warn('schedule write failed', err);
    toast('Could not save — phone storage is full or blocked.');
    return false;
  }
}

function sessionDate(s) {
  if (!s) return null;
  var v = schedule[s.id];
  return (v && v !== 'skipped') ? v : s.date;
}

function isSkipped(s) {
  return !!s && schedule[s.id] === 'skipped';
}

function isMoved(s) {
  var v = s && schedule[s.id];
  return !!v && v !== 'skipped' && v !== s.date;
}

function movedCount() {
  return plan.sessions.filter(function (s) { return isMoved(s) || isSkipped(s); }).length;
}

function setSessionDate(s, date) {
  if (date === s.date) delete schedule[s.id];
  else schedule[s.id] = date;
}

/* Whatever is sitting on a date, ignoring anything abandoned. */
function sessionOn(date, exceptId) {
  return plan.sessions.filter(function (s) {
    return s.id !== exceptId && !isSkipped(s) && sessionDate(s) === date;
  })[0] || null;
}

/* --- the three moves ---------------------------------------------------- */

/* Trade places. Nothing else in the block shifts. */
function rescheduleSwap(sourceId, targetDate) {
  var src = sessionById(sourceId);
  if (!src) return;
  var from = sessionDate(src);
  var occupant = sessionOn(targetDate, sourceId);

  setSessionDate(src, targetDate);
  if (occupant) setSessionDate(occupant, from);
  saveSchedule();
}

/* Insert at the target date; everything from there on slides one slot later.
   The slots are the dates already in use, so the block keeps its rhythm
   rather than being smeared across weekends. */
function reschedulePush(sourceId, targetDate) {
  var src = sessionById(sourceId);
  if (!src) return;

  var affected = sessionsByDate().filter(function (s) {
    return s.id !== sourceId && !isSkipped(s) && sessionDate(s) >= targetDate;
  });

  /* The slot pool is every date in use from the target onwards — INCLUDING
     the one the source is vacating. Leave that out and everything after it
     shifts a day further than it should. */
  var slots = [];
  sessionsByDate().forEach(function (s) {
    if (isSkipped(s)) return;
    var d = sessionDate(s);
    if (d >= targetDate && slots.indexOf(d) < 0) slots.push(d);
  });
  if (slots.indexOf(targetDate) < 0) slots.push(targetDate);
  slots.sort();

  /* One short whenever the target was already occupied: extend by the gap
     the plan was last using (1 day midweek, 3 across a weekend). */
  while (slots.length < affected.length + 1) {
    var n = slots.length;
    var gap = n >= 2 ? daysBetween(slots[n - 2], slots[n - 1]) : 1;
    slots.push(addDays(slots[n - 1], Math.max(1, gap)));
  }

  setSessionDate(src, slots[0]);
  affected.forEach(function (s, i) { setSessionDate(s, slots[i + 1]); });
  saveSchedule();
}

/* Take the slot and abandon whatever was in it. */
function rescheduleSkip(sourceId, targetDate) {
  var src = sessionById(sourceId);
  if (!src) return;
  var occupant = sessionOn(targetDate, sourceId);

  setSessionDate(src, targetDate);
  if (occupant) schedule[occupant.id] = 'skipped';
  saveSchedule();
}

function resetSchedule() {
  schedule = {};
  saveSchedule();
}

/* ------------------------------------------------------------ plan lookups */

/* plan.weeks covers W2–W15. Three sessions live outside it (TEST, JAN),
   so build week-shaped stand-ins for those from their own sessions. */
function allWeeks() {
  var known = {};
  var list = plan.weeks.map(function (w) {
    known[w.id] = true;
    return w;
  });

  var seen = {};
  plan.sessions.forEach(function (s) {
    if (known[s.week] || seen[s.week]) return;
    seen[s.week] = true;
    list.push({
      id: s.week,
      label: s.weekLabel || s.week,
      dates: s.weekDates || fmtDateShort(s.date),
      start: s.date,
      block: s.block,
      muPhase: s.muPhase,
      deload: false,
      extra: true
    });
  });

  list.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return list;
}

/* plan.sessions is stored in plan order. Once a session can be moved, the
   order you will actually do them in is a different thing. */
function sessionsByDate() {
  return plan.sessions.slice().sort(function (a, b) {
    var da = sessionDate(a), db = sessionDate(b);
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

function weekById(id) {
  return allWeeks().filter(function (w) { return w.id === id; })[0] || null;
}

function sessionsForWeek(id) {
  return plan.sessions.filter(function (s) { return s.week === id; });
}

function sessionById(id) {
  var found = plan.sessions.filter(function (s) { return s.id === id; })[0];
  if (found) return found;
  var p = parseAreaDayId(id);                    /* "2026-10-06:mu": an area on a date */
  return p && areaData ? areaDaySession(p.date, p.area) : null;
}

function checkpointsOn(date) {
  return plan.checkpoints.filter(function (c) { return c.date === date; });
}

function checkpointsInWeek(week) {
  var dates = {};
  sessionsForWeek(week.id).forEach(function (s) { dates[s.date] = true; });
  return plan.checkpoints.filter(function (c) { return dates[c.date]; });
}

/* The week containing today, or the first week if the block hasn't started. */
function currentWeekId() {
  var today = todayISO();
  var weeks = allWeeks();
  var current = null;
  for (var i = 0; i < weeks.length; i++) {
    if (weeks[i].start <= today) current = weeks[i].id;
  }
  return current || (weeks[0] && weeks[0].id) || null;
}

function nextSession() {
  var today = todayISO();
  return sessionsByDate().filter(function (s) { return !isSkipped(s) && sessionDate(s) >= today; })[0] || null;
}

/* ------------------------------------------------------------ workout areas */
/* What you are getting better at (muscle-up, pistol squat…) and how often you
   trained each in a Mon–Sun week. The areas live in data/areas/*.json and the
   rules between them in data/rules.json; nothing below knows an area by name.
   Not to be confused with areas() further up, which is the body areas the
   traffic light watches.

   Until the stage engine exists, everyone sits at the start of every ladder
   and the history comes from the old plan's logs, split by exercise. */

var AREAS_BASE = 'data/areas/';
var LS_AREAS = 'areas.cache.v1';

var areaData = null;       /* { rules, legacy, list: [area, ...] } */

function areaList() { return areaData ? areaData.list : []; }

function areaById(id) {
  return areaList().filter(function (a) { return a.id === id; })[0] || null;
}

function bodyLabel(id) {
  var b = areaData && areaData.rules.bodyAreas.filter(function (x) { return x.id === id; })[0];
  return b ? b.label : (AREA_LABEL[id] || id);
}

function loadAreaData() {
  function get(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      return res.json();
    });
  }

  return get(AREAS_BASE + 'index.json')
    .then(function (index) {
      return Promise.all([
        get('data/rules.json'),
        get('data/legacy.json'),
        Promise.all(index.areas.map(function (id) { return get(AREAS_BASE + id + '.json'); }))
      ]);
    })
    .then(function (parts) {
      var data = { rules: parts[0], legacy: parts[1], list: parts[2] };
      cacheAreaData(data);
      return data;
    })
    .catch(function (err) {
      console.warn('area data fetch failed, trying cache', err);
      var cached = lsGet(LS_AREAS);
      if (cached) return cached;
      throw err;
    });
}

/* Same belt-and-braces as the plan: the service worker caches these too. */
function cacheAreaData(data) {
  try {
    var next = JSON.stringify(data);
    if (localStorage.getItem(LS_AREAS) !== next) localStorage.setItem(LS_AREAS, next);
  } catch (err) {
    console.warn('area cache write failed', err);
  }
}

/* Monday = 0. Read from the calendar fields, never from a local Date. */
function isoDow(iso) {
  var d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
  return (d.getUTCDay() + 6) % 7;
}

function weekStartOf(iso) { return addDays(iso, -isoDow(iso)); }

/* A stage may override its area's weekly targets and spacing (Nordic does,
   in the banded stages, where lower load allows more often). */
function currentStage(area) { return area.stages[0]; }
function stageWeek(area, stage) { return stage.perWeek || area.perWeek; }
function stageGap(area, stage) { return stage.minGapDays || area.minGapDays; }

/* The old plan's sessions mix several areas. Split each by exercise, on the day
   the session was actually trained, into one record per area per date. A day
   counts as trained once any set is logged; it is full when every set of that
   area's block is done. */
function legacyAreaDays() {
  if (!areaData || !plan) return [];
  var toArea = areaData.legacy.toArea;
  var fullPct = areaData.rules.defaults.fullAreaPct;
  var byKey = {};

  plan.sessions.forEach(function (s) {
    var date = sessionDate(s);
    var blocks = {};

    s.exercises.forEach(function (ex) {
      var a = toArea[ex.id];
      if (!a) return;                              /* retired, or a placeholder row */
      var b = blocks[a] = blocks[a] || { done: 0, total: 0 };
      var sets = Number(ex.sets) || 0;
      b.total += sets;
      for (var i = 0; i < sets; i++) {
        var e = getLog(s.id, ex.id, i);
        if (e && e.done) b.done++;
      }
    });

    Object.keys(blocks).forEach(function (a) {
      if (!blocks[a].done) return;                 /* nothing logged: not trained */
      var key = date + '|' + a;
      var r = byKey[key] = byKey[key] || { date: date, area: a, done: 0, total: 0 };
      r.done += blocks[a].done;
      r.total += blocks[a].total;
    });
  });

  return Object.keys(byKey).map(function (k) {
    var r = byKey[k];
    r.full = r.done * 100 >= r.total * fullPct;
    return r;
  });
}

/* --- days, menus, and what each day held ------------------------------- */
/* An area-day is one area on one date. Its id is "2026-10-06:mu", and it is
   logged exactly like a plan session (sessionId|exerciseId|setIdx), so the set
   chips, the set sheet, the runner and the rest timer all work on it as they
   are. The session itself is never stored: it is built from the area's data
   and from what was fixed on the day it was first planned. */

var MAX_SITTINGS = 3;
var FALLBACK_MINUTES = 45;
var AREA_DAY_RE = /^(\d{4}-\d{2}-\d{2}):([a-z0-9-]+)$/;

var dayPlans = {};    /* date -> { sittings: [{ minutes, areas }], suggested: [id], removed: { id: reason } } */
var frozenDays = {};  /* "date:area" -> { stage, type } */

function areaDayId(date, areaId) { return date + ':' + areaId; }

function parseAreaDayId(id) {
  var m = AREA_DAY_RE.exec(String(id));
  return m ? { date: m[1], area: m[2] } : null;
}

function uniqueStrings(list) {
  var seen = {}, out = [];
  (Array.isArray(list) ? list : []).forEach(function (x) {
    if (typeof x === 'string' && x && !seen[x]) { seen[x] = true; out.push(x); }
  });
  return out;
}

/* Storage can hold anything: a hand-edited file, an older build. Anything that
   is not a well-formed day is dropped rather than trusted. */
function cleanDayPlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  var sittings = (Array.isArray(raw.sittings) ? raw.sittings : []).slice(0, MAX_SITTINGS).map(function (x) {
    var m = x ? Number(x.minutes) : 0;
    return { minutes: m > 0 && m <= 600 ? Math.round(m) : FALLBACK_MINUTES, areas: uniqueStrings(x && x.areas) };
  });
  if (!sittings.length) return null;

  var removed = {};
  if (raw.removed && typeof raw.removed === 'object' && !Array.isArray(raw.removed)) {
    Object.keys(raw.removed).forEach(function (id) {
      removed[id] = typeof raw.removed[id] === 'string' ? raw.removed[id] : '';
    });
  }
  return { sittings: sittings, suggested: uniqueStrings(raw.suggested), removed: removed };
}

function loadDayPlans() {
  var stored = lsGet(LS_DAYPLANS);
  dayPlans = {};
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
  Object.keys(stored).forEach(function (date) {
    var plan = /^\d{4}-\d{2}-\d{2}$/.test(date) ? cleanDayPlan(stored[date]) : null;
    if (plan) dayPlans[date] = plan;
  });
}

function loadFrozenDays() {
  var stored = lsGet(LS_AREADAYS);
  frozenDays = {};
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
  Object.keys(stored).forEach(function (key) {
    var f = stored[key];
    if (!parseAreaDayId(key) || !f || typeof f.stage !== 'string') return;
    frozenDays[key] = f.type && typeof f.type === 'string' ? { stage: f.stage, type: f.type } : { stage: f.stage };
  });
}

function saveCollection(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(key + ' write failed', err);
    toast('Could not save — phone storage is full or blocked.');
    return false;
  }
}

function saveDayPlans() { return saveCollection(LS_DAYPLANS, dayPlans); }
function saveFrozenDays() { return saveCollection(LS_AREADAYS, frozenDays); }

/* How long you usually have on this weekday, from the last time you said. */
function defaultMinutes(date) {
  var m = settings.weekdayMinutes && Number(settings.weekdayMinutes[isoDow(date)]);
  if (m > 0) return m;
  return areaData ? areaData.rules.defaults.dayMinutes : FALLBACK_MINUTES;
}

function rememberMinutes(date, minutes) {
  settings.weekdayMinutes = settings.weekdayMinutes || {};
  settings.weekdayMinutes[isoDow(date)] = minutes;
  saveSettings();
}

function stageById(area, id) {
  return area.stages.filter(function (s) { return s.id === id; })[0] || null;
}

/* Sets done so far per area-day, in one pass over the logs. */
function doneByAreaDay() {
  var out = {};
  setLogs.forEach(function (e) {
    if (e.done && parseAreaDayId(e.sessionId)) out[e.sessionId] = (out[e.sessionId] || 0) + 1;
  });
  return out;
}

/* The session types a stage actually has exercises for, in the area's order. */
function stageTypes(area, stage) {
  var used = {};
  (stage.exercises || []).forEach(function (e) { if (e.type) used[e.type] = true; });
  return (area.sessionTypes || []).filter(function (t) { return used[t]; });
}

/* Which kind of day an area is due: the type it did longest ago, one it has
   never done first, ties in the order the area lists them. */
function nextSessionType(area, stage, beforeDate) {
  var types = stageTypes(area, stage);
  if (!types.length) return null;

  var last = {}, done = doneByAreaDay();
  types.forEach(function (t) { last[t] = ''; });
  Object.keys(frozenDays).forEach(function (key) {
    var p = parseAreaDayId(key), f = frozenDays[key];
    if (p.area !== area.id || p.date >= beforeDate || !f.type || last[f.type] === undefined) return;
    if (done[key] && p.date > last[f.type]) last[f.type] = p.date;
  });

  var pick = types[0];
  types.forEach(function (t) { if (last[t] < last[pick]) pick = t; });
  return pick;
}

/* Fix what this area contains today, the first time it is planned. A stage
   change or the next type in the rotation must never rewrite a day you did. */
function freezeAreaDay(date, areaId) {
  var key = areaDayId(date, areaId);
  if (frozenDays[key]) return frozenDays[key];

  var area = areaById(areaId);
  var stage = area && currentStage(area);
  if (!stage || !stage.exercises) return null;

  var f = { stage: stage.id };
  var type = nextSessionType(area, stage, date);
  if (type) f.type = type;
  frozenDays[key] = f;
  saveFrozenDays();
  return f;
}

/* Taken off before anything was done: forget what it would have held, so
   planning it again picks fresh. Anything already logged stays put. */
function unfreezeAreaDay(date, areaId) {
  var key = areaDayId(date, areaId);
  if (!frozenDays[key] || doneByAreaDay()[key]) return;
  delete frozenDays[key];
  saveFrozenDays();
}

var DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* A session-shaped object for one area on one date, so everything that already
   knows how to show and log a session can show and log this. */
function areaDaySession(date, areaId) {
  var area = areaById(areaId);
  if (!area) return null;

  var f = frozenDays[areaDayId(date, areaId)] || null;
  var stage = f ? stageById(area, f.stage) : currentStage(area);
  if (!stage || !stage.exercises) return null;

  var type = f ? (f.type || null) : nextSessionType(area, stage, date);
  var exercises = stage.exercises.filter(function (e) { return !type || !e.type || e.type === type; });

  return {
    id: areaDayId(date, areaId),
    areaId: areaId,
    date: date,
    week: null,                                  /* weeks here are Mon–Sun, not plan weeks */
    weekLabel: fmtDateShort(date),
    day: DAY_SHORT[isoDow(date)],
    name: area.name + ' · ' + stage.id + (type ? ' · ' + type : ''),
    stageId: stage.id,
    type: type,
    draft: !!stage.draft,
    frozen: !!f,
    exercises: exercises
  };
}

/* An area is paused as a whole when a body area that guards it is red. */
function areaPaused(session) {
  var area = session && session.areaId ? areaById(session.areaId) : null;
  return !!area && redGuards(area, sessionDate(session)).length > 0;
}

/* One record per area per date from the new logs, in the same shape as the
   old plan's. Sets logged against an exercise the day no longer holds are not
   counted. */
function loggedAreaDays() {
  var byId = {};
  setLogs.forEach(function (e) {
    if (!e.done || !parseAreaDayId(e.sessionId)) return;
    (byId[e.sessionId] = byId[e.sessionId] || []).push(e);
  });

  var fullPct = areaData.rules.defaults.fullAreaPct;
  var out = [];
  Object.keys(byId).forEach(function (id) {
    var p = parseAreaDayId(id);
    var s = areaDaySession(p.date, p.area);
    if (!s) return;

    var inBlock = {}, total = 0;
    s.exercises.forEach(function (ex) { inBlock[ex.id] = Number(ex.sets) || 0; total += inBlock[ex.id]; });
    var done = byId[id].filter(function (e) { return e.setIdx < (inBlock[e.exerciseId] || 0); }).length;
    if (!done) return;

    out.push({ date: p.date, area: p.area, done: done, total: total, full: done * 100 >= total * fullPct });
  });
  return out;
}

/* Everything trained, old plan and new, as { date, area, done, total, full }.
   If both ever land on the same area and date they are added together. */
function areaDays() {
  if (!areaData) return [];
  var byKey = {};
  legacyAreaDays().concat(loggedAreaDays()).forEach(function (r) {
    var key = r.date + '|' + r.area;
    var have = byKey[key];
    if (!have) { byKey[key] = { date: r.date, area: r.area, done: r.done, total: r.total, full: r.full }; return; }
    have.done += r.done;
    have.total += r.total;
    have.full = have.done * 100 >= have.total * areaData.rules.defaults.fullAreaPct;
  });
  return Object.keys(byKey).map(function (k) { return byKey[k]; });
}

/* How many full days an area has in its current stage. Everything so far counts,
   because nobody has left the first stage yet. */
function stageProgress(area, days) {
  var stage = currentStage(area);
  var full = days.filter(function (r) { return r.area === area.id && r.full; }).length;
  return { stage: stage, full: full, askAfter: stage.askAfter };
}

/* Body areas guarding this area that are under the red protocol on `date`. */
function redGuards(area, date) {
  var red = redAreasOn(date);
  return area.guardedBy.filter(function (b) { return red[b]; });
}

/* Where an area stands in one Mon–Sun week.
   A finished week is judged by what happened. A running one asks whether the
   target can still be reached: sessions must be `gap` days apart, counting from
   the last one even when that was last week, so the room left is a number of
   sessions, not just a number of days. */
function weekStatus(area, per, gap, start, end, today, touched, mine) {
  if (end < today) {
    if (touched > per.max) return { key: 'over', label: 'Over the max' };
    if (touched >= per.target) return { key: 'hit', label: 'Hit' };
    if (touched >= per.min) return { key: 'met', label: 'Met minimum' };
    return { key: 'missed', label: 'Missed' };
  }
  if (start > today) return { key: 'ahead', label: '' };
  if (touched >= per.target) return { key: 'done', label: 'Done' };

  var red = redGuards(area, today);
  if (red.length) return { key: 'held', label: 'Held · ' + bodyLabel(red[0]).toLowerCase() + ' red' };

  var last = null;
  mine.forEach(function (r) { if (r.date <= today && (!last || r.date > last)) last = r.date; });
  var first = last ? addDays(last, gap) : today;
  if (first < today) first = today;

  var avail = first > end ? 0 : daysBetween(first, end) + 1;
  var room = avail > 0 ? Math.floor((avail - 1) / gap) + 1 : 0;   /* sessions that still fit */

  var need = per.target - touched;
  var needMin = Math.max(0, per.min - touched);

  if (need <= room) {
    return (need === room && first === today) ? { key: 'due', label: 'Due today' } : { key: 'track', label: 'On track' };
  }
  return needMin <= room ? { key: 'behind', label: 'Behind' } : { key: 'risk', label: 'At risk' };
}

function areaWeek(area, start, today, days) {
  var end = addDays(start, 6);
  var stage = currentStage(area);
  var per = stageWeek(area, stage);
  var gap = stageGap(area, stage);

  var mine = days.filter(function (r) { return r.area === area.id; });
  var byDate = {};
  mine.forEach(function (r) { byDate[r.date] = r; });

  var cells = [], touched = 0, full = 0;
  for (var i = 0; i < 7; i++) {
    var date = addDays(start, i);
    var rec = byDate[date] || null;
    var state = rec ? (rec.full ? 'full' : 'partial') : (date > today ? 'future' : 'none');
    if (rec) { touched++; if (rec.full) full++; }
    cells.push({ date: date, state: state, isToday: date === today, record: rec });
  }

  return {
    area: area, start: start, end: end, cells: cells, touched: touched, full: full,
    min: per.min, target: per.target, max: per.max, gap: gap,
    status: weekStatus(area, per, gap, start, end, today, touched, mine)
  };
}

/* Days trained in each of the `n` weeks before `start`, oldest first; null for
   weeks before there was any history. */
function recentWeekCounts(area, start, n, days, firstWeek) {
  var out = [];
  for (var k = n; k >= 1; k--) {
    var s = addDays(start, -7 * k);
    out.push(s < firstWeek ? null : areaWeek(area, s, addDays(s, 7), days).touched);   /* a finished week */
  }
  return out;
}

/* The earliest week worth showing: the plan's first, or earlier if you logged
   something before it began. */
function firstWeekStart(days) {
  var first = plan && plan.meta ? plan.meta.startDate : todayISO();
  days.forEach(function (r) { if (r.date < first) first = r.date; });
  return weekStartOf(first);
}

/* ------------------------------------------------------------------ views */

function view() { return document.getElementById('view'); }

function setView(title, sub, nodes) {
  document.getElementById('appbar-title').textContent = title;
  document.getElementById('appbar-sub').textContent = sub || '';
  var v = view();
  v.textContent = '';
  nodes.forEach(function (n) { if (n) v.appendChild(n); });
}

function tagClass(prefix, tag) {
  return prefix + '-' + (['mu', 'ten', 'test', 'rest'].indexOf(tag) >= 0 ? tag : 'rest');
}

var TAG_LABEL = { mu: 'Muscle-up', ten: 'Tendon', test: 'Test', rest: 'Rest' };

/* --- Plan: the 14 weeks --- */

function renderWeekList() {
  var weeks = allWeeks();
  var nowId = currentWeekId();
  var today = todayISO();

  var nodes = [el('p', { class: 'section-label', text: plan.meta.title })];

  weeks.forEach(function (w) {
    var n = sessionsForWeek(w.id).length;
    var cps = checkpointsInWeek(w);
    var isNow = w.id === nowId;
    var badges = el('div', { class: 'badges' }, [
      isNow ? badge(w.start > today ? 'Up next' : 'This week', 'badge-now') : null,
      w.deload ? badge('Deload') : null,
      cps.length ? badge('Checkpoint', 'badge-test') : null,
      badge(w.block)
    ]);

    nodes.push(el('a', {
      class: 'card' + (isNow ? ' is-now' : ''),
      href: '#/plan/' + w.id,
      id: isNow ? 'now-week' : null
    }, [
      el('div', { class: 'card-top' }, [
        el('span', { class: 'card-title', text: w.label }),
        badges
      ]),
      el('div', { class: 'card-sub', text: w.dates + ' · ' + n + (n === 1 ? ' session' : ' sessions') + (w.muPhase && w.muPhase !== '—' ? ' · phase ' + w.muPhase : '') })
    ]));
  });

  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));

  setView('Plan', plan.meta.daysPerWeek + ' days/week', nodes);

  /* Land on the week you're actually in. */
  var now = document.getElementById('now-week');
  if (now) {
    if (planScroll) window.scrollTo(0, planScroll);
    else now.scrollIntoView({ block: 'center' });
  }
}

/* --- Plan: one week's five days --- */

function renderWeek(id) {
  var w = weekById(id);
  if (!w) return renderNotFound('No week "' + id + '".');

  var today = todayISO();
  var nodes = [el('a', { class: 'back', href: '#/plan', text: '‹ All weeks' })];

  if (w.deload) {
    nodes.push(el('div', { class: 'callout' }, [
      el('strong', { text: 'Deload week' }),
      document.createTextNode('Reduced volume. Take it as written — it is part of the plan, not a concession.')
    ]));
  }

  checkpointsInWeek(w).forEach(function (c) {
    nodes.push(el('div', { class: 'callout callout-checkpoint' }, [
      el('strong', { text: c.label + ' · ' + fmtDateShort(c.date) }),
      document.createTextNode(c.detail)
    ]));
  });

  sessionsForWeek(w.id).forEach(function (s) {
    var isToday = !isSkipped(s) && sessionDate(s) === today;
    nodes.push(el('a', {
      class: 'card' + (isToday ? ' is-now' : ''),
      href: '#/session/' + s.id
    }, [
      el('div', { class: 'card-top' }, [
        el('span', { class: 'dot ' + tagClass('dot', s.tag) }),
        el('span', { class: 'card-title', text: s.day }),
        el('div', { class: 'badges' }, [
          isToday ? badge('Today', 'badge-now') : null,
          moveBadges(s),
          checkpointsOn(s.date).length ? badge('Checkpoint', 'badge-test') : null,
          badge(TAG_LABEL[s.tag] || s.tag, tagClass('badge', s.tag))
        ])
      ]),
      el('div', { class: 'card-sub', text: fmtDateShort(sessionDate(s)) + ' · ' + s.name })
    ]));
  });

  setView(w.label, w.dates, nodes);
  window.scrollTo(0, 0);
}

/* --- Plan: one session --- */

function renderSession(id) {
  var s = sessionById(id);
  if (!s) return renderNotFound('No session "' + id + '".');

  var nodes = [
    el('a', { class: 'back', href: '#/plan/' + s.week, text: '‹ ' + (s.weekLabel || s.week) }),
    el('div', { class: 'session-head' }, [
      el('div', { class: 'badges', style: 'justify-content:flex-start;margin:0 0 6px' }, [
        badge(TAG_LABEL[s.tag] || s.tag, tagClass('badge', s.tag)),
        s.deload ? badge('Deload') : null,
        badge(s.block),
        s.muPhase && s.muPhase !== '—' ? badge('Phase ' + s.muPhase) : null
      ]),
      el('h2', { text: s.name }),
      el('div', { class: 'meta', text: s.day + ' ' + fmtDate(sessionDate(s))
        + (isMoved(s) ? ' · planned for ' + fmtDateShort(s.date) : '')
        + (isSkipped(s) ? ' · skipped' : '') })
    ])
  ];

  checkpointsOn(s.date).forEach(function (c) {
    nodes.push(el('div', { class: 'callout callout-checkpoint' }, [
      el('strong', { text: c.label }),
      document.createTextNode(c.detail)
    ]));
  });

  var gate = sessionGate(s);
  if (gate.redAreas.length) nodes.push(redBanner(s, gate));
  var hb = holdBanner(s, gate);
  if (hb) nodes.push(hb);

  var mode = sessionHasLogs(s) ? 'review' : 'plain';
  s.exercises.forEach(function (ex) {
    if (ex.track && gate.suppressed[ex.track]) return;
    nodes.push(exerciseCard(ex, s, mode, gate));
  });

  setView(s.day + ' · ' + fmtDateShort(sessionDate(s)), s.weekLabel || s.week, nodes);
  window.scrollTo(0, 0);
}

/* "5 × 4", but the plan also holds rounds, timed holds and one-off test
   attempts, and "1 × —" reads like a bug. */
function specText(ex) {
  var sets = Number(ex.sets) || 0;
  var reps = String(ex.reps || '').trim();

  if (reps === '' || reps === '—') return sets > 1 ? sets + ' sets' : '';
  if (reps === 'round' || reps === 'rounds') return sets + (sets === 1 ? ' round' : ' rounds');
  if (sets === 1) return /^\d+$/.test(reps) ? reps + (reps === '1' ? ' rep' : ' reps') : reps;
  return sets + ' × ' + reps;
}

/* Shared by Today and the Plan browser.
   mode: 'live' = tappable chips, 'review' = chips shown but locked,
         'plain' = no chips at all. */
function exerciseCard(ex, session, mode, gate) {
  var spec = el('div', { class: 'ex-spec' }, []);
  var held = !!(gate && ex.track && gate.holds[ex.track]);

  var counts = specText(ex);
  if (counts) spec.appendChild(el('span', { text: counts }));

  /* A held track shows what it was at last week, not the scheduled rise.
     If last week has no counterpart, the badge still stands and its own
     load is shown — there is nothing better to fall back to. */
  var load = held ? heldLoad(ex, session, gate.prevWeek) : null;
  if (!load) load = resolveLoad(ex.load, session ? sessionDate(session) : todayISO());

  if (load.text !== '—') {
    if (spec.childNodes.length) spec.appendChild(el('span', { class: 'sep', text: '·' }));
    spec.appendChild(load.missing
      ? el('a', { class: 'load load-missing', href: '#/progress', text: load.text })
      : el('span', { class: 'load' + (held ? ' load-held' : ''), text: load.text }));
  }

  var rest = fmtRest(ex.restSec);
  if (rest) {
    if (spec.childNodes.length) spec.appendChild(el('span', { class: 'sep', text: '·' }));
    spec.appendChild(el('span', { class: 'rest', text: 'rest ' + rest }));
  }

  var runLink = (mode === 'live' && session)
    ? el('a', { class: 'ex-run', href: '#/run/' + session.id + '/' + session.exercises.indexOf(ex),
        'aria-label': 'Run ' + ex.name, text: '▶' })
    : null;

  var card = el('div', { class: 'ex' + (held ? ' is-held' : '') }, [
    el('div', { class: 'ex-head' }, [
      el('span', { class: 'ex-name', text: ex.name }),
      held ? badge('HOLD', 'badge-hold') : null,
      runLink
    ]),
    spec.childNodes.length ? spec : null,
    ex.tempo && ex.tempo !== '—' ? el('div', { class: 'ex-tempo', text: ex.tempo }) : null
  ]);

  if (mode === 'live' || mode === 'review') {
    card.appendChild(chipRow(ex, session, mode === 'live'));
  }

  if (ex.cue) card.appendChild(el('div', { class: 'ex-cue', text: ex.cue }));
  if (ex.note) card.appendChild(el('div', { class: 'ex-note', text: ex.note }));

  return card;
}

/* --- set chips -------------------------------------------------------- */
/* Tap = done, tap again = undone. Long-press = what actually happened.
   You are sweaty and one-handed; that is the whole interaction budget. */

function chipRow(ex, session, live) {
  var sets = Number(ex.sets) || 0;
  var row = el('div', { class: 'chips' + (live ? '' : ' is-locked') });
  var logged = el('div', { class: 'ex-logged' });

  for (var i = 0; i < sets; i++) {
    row.appendChild(chip(ex, session, i, live, logged));
  }

  var wrap = el('div', {}, [row, logged]);
  paintLogged(logged, ex, session);
  return wrap;
}

function chip(ex, session, i, live, logged) {
  var btn = el('button', {
    class: 'chip',
    type: 'button',
    'aria-label': 'Set ' + (i + 1) + ' of ' + ex.name,
    text: String(i + 1)
  });

  paintChip(btn, getLog(session.id, ex.id, i));

  if (!live) {
    btn.disabled = true;
    return btn;
  }

  var timer = null;
  var longFired = false;

  function startPress() {
    longFired = false;
    timer = setTimeout(function () {
      timer = null;
      longFired = true;
      if (navigator.vibrate) navigator.vibrate(12);
      openSetSheet(ex, session, i, btn, logged);
    }, 500);
  }

  function cancelPress() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  btn.addEventListener('pointerdown', startPress);
  btn.addEventListener('pointerup', cancelPress);
  btn.addEventListener('pointercancel', cancelPress);
  btn.addEventListener('pointerleave', cancelPress);
  btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  btn.addEventListener('click', function () {
    if (longFired) { longFired = false; return; }   /* the press opened the sheet */
    var cur = getLog(session.id, ex.id, i);
    var nowDone = !(cur && cur.done);
    writeLog(session.id, ex.id, i, { done: nowDone });
    paintChip(btn, getLog(session.id, ex.id, i));
    paintLogged(logged, ex, session);
    paintCount();
    if (nowDone) startRest(ex);    /* ticking a set off starts the rest */
  });

  return btn;
}

function paintChip(btn, entry) {
  var done = !!(entry && entry.done);
  btn.className = 'chip' + (done ? ' is-done' : '') + (hasDetail(entry) ? ' has-detail' : '');
  btn.setAttribute('aria-pressed', done ? 'true' : 'false');
}

/* What actually happened, when it differed from the plan. */
function paintLogged(node, ex, session) {
  node.textContent = '';
  var sets = Number(ex.sets) || 0;

  for (var i = 0; i < sets; i++) {
    var e = getLog(session.id, ex.id, i);
    if (!hasDetail(e)) continue;

    var bits = [];
    if (e.loadKg !== undefined) bits.push(e.loadKg + ' kg');
    if (e.reps !== undefined) bits.push(e.reps + (e.reps === 1 ? ' rep' : ' reps'));
    if (e.rpe !== undefined) bits.push('RPE ' + e.rpe);

    node.appendChild(el('div', { text: 'Set ' + (i + 1) + ' — ' + bits.join(' · ') }));
  }
}

function paintCount() {
  if (!todaySession) return;
  var sub = document.getElementById('appbar-sub');
  sub.textContent = doneSets(todaySession) + ' of ' + totalSets(todaySession) + ' sets';
}

/* --- rest timer -------------------------------------------------------- */
/* Rests run 3–4 minutes and you will not time them by feel.
   Everything is driven off a wall-clock end time rather than a counter, so
   a throttled or frozen tab comes back showing the truth instead of however
   far its interval happened to get. */

var restTimer = null;      /* { endAt, total, label, rang } */
var restTick = null;
var wakeLock = null;
var audioCtx = null;
var beepNodes = [];

/* Must be called from inside a user gesture or mobile browsers refuse. */
function ensureAudio() {
  try {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (err) {
    console.warn('audio unavailable', err);
    return null;
  }
}

/* Scheduled ahead of time rather than fired by the tick: the audio clock
   keeps its own time, so the beep lands even if the tick is being throttled. */
function scheduleBeep(inSeconds) {
  var ctx = audioCtx;
  if (!ctx) return;

  var at = ctx.currentTime + Math.max(0, inSeconds);

  [0, 0.22, 0.44].forEach(function (offset, i) {
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 2 ? 1320 : 880;
      gain.gain.setValueAtTime(0.0001, at + offset);
      gain.gain.exponentialRampToValueAtTime(0.4, at + offset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.19);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at + offset);
      osc.stop(at + offset + 0.21);
      beepNodes.push(osc);
    } catch (err) {
      console.warn('beep scheduling failed', err);
    }
  });
}

function cancelBeep() {
  beepNodes.forEach(function (n) {
    try { n.stop(); n.disconnect(); } catch (err) { /* already finished */ }
  });
  beepNodes = [];
}

/* Keeping the screen awake is the real answer to "survives screen lock":
   the phone is on a bench in front of you, so do not let it lock at all. */
function acquireWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* denied, low battery, not visible — carry on */ });
  } catch (err) { /* not supported */ }
}

function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch (err) { /* already gone */ }
  wakeLock = null;
}

function persistTimer() {
  try {
    if (restTimer) localStorage.setItem(LS_TIMER, JSON.stringify(restTimer));
    else localStorage.removeItem(LS_TIMER);
  } catch (err) {
    console.warn('timer persist failed', err);
  }
}

function startRest(ex) {
  var secs = Number(ex.restSec) || 0;
  if (secs <= 0) return;

  cancelBeep();
  restTimer = { endAt: Date.now() + secs * 1000, total: secs, label: ex.name, rang: false };
  persistTimer();

  ensureAudio();               /* we are inside the chip tap, so this is allowed */
  scheduleBeep(secs);
  acquireWakeLock();

  if (!restTick) restTick = setInterval(paintTimer, 250);
  paintTimer();
}

function addRest(secs) {
  if (!restTimer) return;
  /* From now if it already rang, otherwise on to the end. */
  var base = Math.max(Date.now(), restTimer.endAt);
  restTimer.endAt = base + secs * 1000;
  restTimer.total += secs;
  restTimer.rang = false;
  persistTimer();

  cancelBeep();
  ensureAudio();
  scheduleBeep((restTimer.endAt - Date.now()) / 1000);
  paintTimer();
}

function stopRest() {
  cancelBeep();
  releaseWakeLock();
  restTimer = null;
  persistTimer();
  if (restTick) { clearInterval(restTick); restTick = null; }
  paintTimer();
}

function restRemaining() {
  if (!restTimer) return 0;
  return Math.max(0, Math.round((restTimer.endAt - Date.now()) / 1000));
}

function paintTimer() {
  var bar = document.getElementById('rest-bar');

  if (!restTimer) {
    if (bar) bar.remove();
    document.body.classList.remove('has-rest');
    return;
  }

  var left = restRemaining();

  if (left === 0 && !restTimer.rang) {
    restTimer.rang = true;
    persistTimer();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
    releaseWakeLock();          /* rest is over, let the screen sleep again */
  }

  if (!bar) {
    bar = el('div', { id: 'rest-bar', class: 'restbar', role: 'status' }, [
      el('div', { class: 'restbar-main' }, [
        el('div', { class: 'restbar-time', id: 'rest-time' }),
        el('div', { class: 'restbar-label', id: 'rest-label' })
      ]),
      el('button', { class: 'restbar-btn', type: 'button', id: 'rest-add', text: '+30s' }),
      el('button', { class: 'restbar-btn restbar-close', type: 'button', id: 'rest-stop', 'aria-label': 'Stop rest timer', text: '✕' })
    ]);
    document.body.appendChild(bar);
    document.body.classList.add('has-rest');
    document.getElementById('rest-add').addEventListener('click', function () { addRest(30); });
    document.getElementById('rest-stop').addEventListener('click', stopRest);
  }

  bar.classList.toggle('is-done', left === 0);
  document.getElementById('rest-time').textContent = left === 0 ? 'Rest done' : fmtClock(left);
  document.getElementById('rest-label').textContent = left === 0
    ? 'Next set'
    : restTimer.label;

  /* Stop ticking once it has rung, but leave the bar up to be dismissed. */
  if (left === 0 && restTick) { clearInterval(restTick); restTick = null; }
}

function fmtClock(secs) {
  var m = Math.floor(secs / 60);
  var s = secs % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/* A reload mid-rest should pick the timer back up where the clock says
   it is, not where the page happened to stop. */
function restoreTimer() {
  var stored = lsGet(LS_TIMER);
  if (!stored || typeof stored !== 'object' || !stored.endAt) return;

  /* Anything more than five minutes past the end is yesterday's business. */
  if (Date.now() - stored.endAt > 5 * 60 * 1000) {
    try { localStorage.removeItem(LS_TIMER); } catch (err) { /* nothing to do */ }
    return;
  }

  restTimer = stored;
  if (restRemaining() > 0 && !restTick) restTick = setInterval(paintTimer, 250);
  paintTimer();
}

/* Coming back from a locked screen: repaint at once rather than waiting for
   the next tick, and take the wake lock back if the rest is still running. */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible' || !restTimer) return;
  if (restRemaining() > 0) {
    if (!restTick) restTick = setInterval(paintTimer, 250);
    acquireWakeLock();
  }
  paintTimer();
});

/* --- the long-press sheet --------------------------------------------- */

function openSetSheet(ex, session, i, btn, logged) {
  var entry = getLog(session.id, ex.id, i) || {};

  var loadIn = el('input', { type: 'text', inputmode: 'decimal', id: 'f-load', placeholder: resolveLoad(ex.load, sessionDate(session)).text });
  var repsIn = el('input', { type: 'text', inputmode: 'numeric', id: 'f-reps', placeholder: String(ex.reps || '') });
  var rpeIn  = el('input', { type: 'text', inputmode: 'decimal', id: 'f-rpe',  placeholder: '1–10' });

  if (entry.loadKg !== undefined) loadIn.value = entry.loadKg;
  if (entry.reps !== undefined) repsIn.value = entry.reps;
  if (entry.rpe !== undefined) rpeIn.value = entry.rpe;

  var form = el('form', { class: 'sheet' }, [
    el('h3', { text: ex.name }),
    el('p', { class: 'sheet-sub', text: 'Set ' + (i + 1) + ' of ' + ex.sets + ' — what actually happened' }),
    field('Load (kg)', loadIn),
    field('Reps', repsIn),
    field('RPE', rpeIn),
    el('div', { class: 'sheet-actions' }, [
      el('button', { type: 'button', class: 'btn btn-quiet', id: 'sheet-clear', text: 'Clear' }),
      el('button', { type: 'button', class: 'btn btn-quiet', id: 'sheet-cancel', text: 'Cancel' }),
      el('button', { type: 'submit', class: 'btn btn-go', text: 'Save' })
    ])
  ]);

  var backdrop = el('div', { class: 'sheet-backdrop' }, [form]);

  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  }

  function refresh() {
    paintChip(btn, getLog(session.id, ex.id, i));
    paintLogged(logged, ex, session);
    paintCount();
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);

  form.querySelector('#sheet-cancel').addEventListener('click', close);

  form.querySelector('#sheet-clear').addEventListener('click', function () {
    writeLog(session.id, ex.id, i, { loadKg: undefined, reps: undefined, rpe: undefined });
    refresh();
    close();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    writeLog(session.id, ex.id, i, {
      done: true,                                  /* you logged it, so you did it */
      loadKg: num(loadIn.value, 0, 500),
      reps: num(repsIn.value, 0, 999),
      rpe: num(rpeIn.value, 1, 10)
    });
    refresh();
    close();
  });

  document.body.appendChild(backdrop);
  loadIn.focus();
}

function field(label, input) {
  return el('label', { class: 'field', for: input.id }, [
    el('span', { text: label }),
    input
  ]);
}

/* Blank means "no change from the plan", not zero. */
function num(raw, min, max) {
  var s = String(raw == null ? '' : raw).trim().replace(',', '.');
  if (s === '') return undefined;
  var n = Number(s);
  if (!isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

/* --- toast ------------------------------------------------------------ */

function toast(msg) {
  var old = document.querySelector('.toast');
  if (old) old.remove();
  var node = el('div', { class: 'toast', role: 'status', text: msg });
  document.body.appendChild(node);
  setTimeout(function () { node.remove(); }, 5000);
}

/* --- Today --- */
/* Today's session, or the next one up. Logging only unlocks on the day
   itself — anything else is the plan browser, which is read-only. */

var DAY_NAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

function nextTrainingSession(afterDate) {
  return plan.sessions.filter(function (s) {
    return !isSkipped(s) && sessionDate(s) > afterDate && s.tag !== 'rest';
  })[0] || null;
}

function renderToday() {
  var today = todayISO();
  var scheduled = plan.sessions.filter(function (s) { return !isSkipped(s) && sessionDate(s) === today; })[0] || null;
  var s = scheduled || nextSession();

  todaySession = null;

  if (!s) {
    setView('Today', '', [
      el('p', { class: 'empty', text: 'The block is finished. Nothing left on the schedule.' }),
      el('p', { class: 'buildline', text: 'Build ' + BUILD })
    ]);
    window.scrollTo(0, 0);
    return;
  }

  /* A rest day shows what is coming and nothing else. */
  if (scheduled && s.tag === 'rest') {
    var after = nextTrainingSession(today);
    setView('Today', s.weekLabel || '', [
      el('div', { class: 'callout' }, [
        el('strong', { text: 'Rest day · ' + fmtDateShort(today) }),
        document.createTextNode(s.exercises[0] && s.exercises[0].cue ? s.exercises[0].cue : 'Complete rest.')
      ]),
      after ? el('p', { class: 'section-label', text: 'Next session · ' + (DAY_NAME[after.day] || after.day) }) : null,
      after ? sessionLinkCard(after) : null,
      el('p', { class: 'buildline', text: 'Build ' + BUILD })
    ].filter(Boolean));
    window.scrollTo(0, 0);
    return;
  }

  var live = !!scheduled;
  var nodes = [];

  if (!live) {
    nodes.push(el('p', { class: 'section-label', text: 'Next session · ' + (DAY_NAME[s.day] || s.day) }));
  }

  nodes.push(el('div', { class: 'session-head' }, [
    el('div', { class: 'badges', style: 'justify-content:flex-start;margin:0 0 6px' }, [
      badge(TAG_LABEL[s.tag] || s.tag, tagClass('badge', s.tag)),
      s.deload ? badge('Deload') : null,
      badge(s.block),
      s.muPhase && s.muPhase !== '—' ? badge('Phase ' + s.muPhase) : null,
      moveBadges(s)
    ]),
    el('h2', { text: s.name }),
    el('div', { class: 'meta', text: s.day + ' ' + fmtDate(sessionDate(s)) + ' · ' + (s.weekLabel || s.week)
      + (isMoved(s) ? ' · planned for ' + fmtDateShort(s.date) : '') })
  ]));

  if (s.deload) {
    nodes.push(el('div', { class: 'callout' }, [
      el('strong', { text: 'Deload week' }),
      document.createTextNode('Reduced volume. Take it as written — it is part of the plan, not a concession.')
    ]));
  }

  checkpointsOn(s.date).forEach(function (c) {
    nodes.push(el('div', { class: 'callout callout-checkpoint' }, [
      el('strong', { text: c.label }),
      document.createTextNode(c.detail)
    ]));
  });

  if (live && s.exercises.length) {
    var start = el('a', { class: 'btn btn-go btn-block btn-start', href: '#/run/' + s.id + '/0',
      text: doneSets(s) ? '▶ Resume session' : '▶ Start session' });
    nodes.push(start);
  }

  var swap = el('button', { class: 'btn btn-block btn-move', type: 'button', text: 'Do a different session' });
  swap.addEventListener('click', function () { movePicker(todayISO()); });
  nodes.push(swap);

  nodes.push(el('p', { class: 'hint', text: live
    ? 'Or tap a set to tick it off by hand. Long-press to record what actually happened.'
    : 'Logging opens on the day.' }));

  var gate = sessionGate(s);
  if (gate.redAreas.length) nodes.push(redBanner(s, gate));
  var hb = holdBanner(s, gate);
  if (hb) nodes.push(hb);

  var mode = live ? 'live' : (sessionHasLogs(s) ? 'review' : 'plain');
  s.exercises.forEach(function (ex) {
    if (ex.track && gate.suppressed[ex.track]) return;    /* red: off the page entirely */
    nodes.push(exerciseCard(ex, s, mode, gate));
  });

  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));

  setView('Today', '', nodes);
  if (live) {
    todaySession = s;
    paintCount();
  }
  window.scrollTo(0, 0);
}

function sessionLinkCard(s) {
  return el('a', { class: 'card is-now', href: '#/session/' + s.id }, [
    el('div', { class: 'card-top' }, [
      el('span', { class: 'dot ' + tagClass('dot', s.tag) }),
      el('span', { class: 'card-title', text: s.day + ' ' + fmtDateShort(sessionDate(s)) }),
      el('span', { class: 'chev', text: '›' })
    ]),
    el('div', { class: 'card-sub', text: s.name })
  ]);
}

/* ---------------------------------------------------------------- backup */
/* localStorage is one Android storage-pressure event away from empty, and
   eight weeks of logs is not something to re-key from memory. Export is the
   whole safety net, so it is deliberately two taps and one file. */

var settings = {};

function loadSettings() {
  var stored = lsGet(LS_SETTINGS);
  settings = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {};
  if (!settings.installedAt) {
    settings.installedAt = todayISO();
    saveSettings();
  }
}

function saveSettings() {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
    return true;
  } catch (err) {
    console.warn('settings write failed', err);
    return false;
  }
}

/* Whole days between two YYYY-MM-DD strings. Anchored at UTC midnight so a
   clock change cannot turn 7 days into 6. */
function daysBetween(fromISO, toISO) {
  function utc(s) {
    return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  }
  return Math.round((utc(toISO) - utc(fromISO)) / 86400000);
}

function hasDataWorthLosing() {
  return baselines.length > 0 || setLogs.length > 0;
}

function daysSinceExport() {
  if (!settings.lastExport) return null;
  return daysBetween(String(settings.lastExport).slice(0, 10), todayISO());
}

function exportOverdue() {
  if (!hasDataWorthLosing()) return false;
  var d = daysSinceExport();
  return d === null || d >= EXPORT_NAG_DAYS;
}

function exportPayload() {
  var out = {
    app: 'integrated-plan',
    version: 1,
    build: BUILD,
    exportedAt: new Date().toISOString()
  };
  COLLECTIONS.forEach(function (key) {
    var v = lsGet(key);
    if (v !== null) out[key] = v;
  });
  return out;
}

function exportData() {
  var payload;
  try {
    payload = exportPayload();
  } catch (err) {
    toast('Could not read the data to export.');
    return;
  }

  var name = 'integrated-plan-' + todayISO() + '.json';
  var url;

  try {
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.warn('export failed', err);
    toast('Could not save the file.');
    return;
  } finally {
    if (url) setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  settings.lastExport = new Date().toISOString();
  saveSettings();
  renderProgress();
  paintTabBadge();
  toast('Saved ' + name + ' to your downloads.');
}

/* What a file claims to hold, or a reason it cannot be used. */
function inspectBackup(raw) {
  var data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { error: 'That file is not valid JSON.' };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'That file is not a backup.' };
  }
  if (data.app && data.app !== 'integrated-plan') {
    return { error: 'That backup belongs to a different app.' };
  }

  var found = {};
  var any = false;

  for (var i = 0; i < COLLECTIONS.length; i++) {
    var key = COLLECTIONS[i];
    if (!(key in data)) continue;
    var v = data[key];
    var wantArray = [LS_SETTINGS, LS_SCHEDULE, LS_DAYPLANS, LS_AREADAYS].indexOf(key) < 0;

    if (wantArray ? !Array.isArray(v) : (typeof v !== 'object' || v === null || Array.isArray(v))) {
      return { error: '“' + key + '” is the wrong shape in that file.' };
    }
    found[key] = v;
    any = true;
  }

  if (!any) return { error: 'That file has none of this app\'s data in it.' };

  return { data: found, exportedAt: data.exportedAt || null };
}

function describeBackup(found) {
  var bits = [];
  if (found[LS_BASELINES]) bits.push(found[LS_BASELINES].length + ' baseline ' + (found[LS_BASELINES].length === 1 ? 'entry' : 'entries'));
  if (found[LS_LOGS]) bits.push(found[LS_LOGS].length + ' logged ' + (found[LS_LOGS].length === 1 ? 'set' : 'sets'));
  if (found[LS_CHECKINS]) bits.push(found[LS_CHECKINS].length + ' check-' + (found[LS_CHECKINS].length === 1 ? 'in' : 'ins'));
  if (found[LS_DAYPLANS]) {
    var planned = Object.keys(found[LS_DAYPLANS]).length;
    bits.push(planned + ' planned ' + (planned === 1 ? 'day' : 'days'));
  }
  if (!bits.length) return 'no records';
  return bits.every(function (b) { return b.indexOf('0 ') === 0; }) ? 'nothing yet' : bits.join(', ');
}

/* Write a checked backup to storage. Menus and what each day contained hang off
   the logs, so when a file brings logs but not them (it predates them) they are
   cleared: a restore must never leave a menu pointing at sets that are gone. */
function writeBackup(data) {
  COLLECTIONS.forEach(function (key) {
    if (key in data) localStorage.setItem(key, JSON.stringify(data[key]));
  });
  if (LS_LOGS in data) {
    [LS_DAYPLANS, LS_AREADAYS].forEach(function (key) {
      if (!(key in data)) localStorage.removeItem(key);
    });
  }
}

/* Restore replaces what is on the phone. Say so plainly, with both sides of
   the trade in front of you, before anything is written. */
function importData(file) {
  if (!file) return;

  var reader = new FileReader();

  reader.onerror = function () { toast('Could not read that file.'); };

  reader.onload = function () {
    var result = inspectBackup(String(reader.result || ''));
    if (result.error) { toast(result.error); return; }

    var incoming = describeBackup(result.data);
    var onPhone = describeBackup({
      baselines: baselines,
      setLogs: setLogs,
      checkIns: lsGet(LS_CHECKINS) || []
    });

    var when = result.exportedAt ? '\nExported ' + fmtDate(String(result.exportedAt).slice(0, 10)) + '.' : '';
    var ok = confirm(
      'Restore from this backup?' + when +
      '\n\nThe file holds ' + incoming + '.' +
      '\nThis phone currently has ' + onPhone + '.' +
      '\n\nEverything on the phone is replaced. This cannot be undone.'
    );
    if (!ok) return;

    try {
      writeBackup(result.data);
    } catch (err) {
      console.warn('import write failed', err);
      toast('Could not write the restored data — storage is full or blocked.');
      return;
    }

    loadBaselines();
    loadLogs();
    loadCheckIns();
    loadSchedule();
    loadSettings();
    loadDayPlans();
    loadFrozenDays();
    renderProgress();
    paintTabBadge();
    toast('Restored ' + incoming + '.');
  };

  reader.readAsText(file);
}

function backupSection() {
  var wrap = el('div', {}, [el('p', { class: 'section-label', text: 'Backup' })]);

  var d = daysSinceExport();
  var line = settings.lastExport
    ? (d === 0 ? 'Last exported today.' : d === 1 ? 'Last exported yesterday.' : 'Last exported ' + d + ' days ago.')
    : 'Never exported.';

  wrap.appendChild(el('div', { class: 'kv' }, [
    el('div', { class: 'kv-row' }, [
      el('span', { class: 'kv-key', text: 'On this phone' }),
      el('span', { class: 'kv-val', text: describeBackup({ baselines: baselines, setLogs: setLogs, checkIns: lsGet(LS_CHECKINS) || [] }) })
    ]),
    el('div', { class: 'kv-row' }, [
      el('span', { class: 'kv-key', text: 'Backup' }),
      el('span', { class: 'kv-val', text: line })
    ])
  ]));

  var fileIn = el('input', { type: 'file', accept: 'application/json,.json', id: 'import-file', class: 'visually-hidden' });
  fileIn.addEventListener('change', function () {
    importData(fileIn.files && fileIn.files[0]);
    fileIn.value = '';            /* so re-picking the same file fires again */
  });

  var exportBtn = el('button', { class: 'btn btn-go', type: 'button', text: 'Export' });
  exportBtn.addEventListener('click', exportData);

  var importBtn = el('button', { class: 'btn', type: 'button', text: 'Import' });
  importBtn.addEventListener('click', function () { fileIn.click(); });

  wrap.appendChild(el('div', { class: 'sheet-actions', style: 'margin-top:0' }, [exportBtn, importBtn]));
  wrap.appendChild(fileIn);
  wrap.appendChild(el('p', { class: 'hint', text: 'Export writes one JSON file to your downloads. Keep a copy somewhere off the phone — that file is the only thing standing between you and re-keying the block from memory.' }));

  return wrap;
}

/* ---------------------------------------------------------------- runner */
/* Full-screen, one exercise at a time. The phone is on a bench, you have one
   hand, and the only thing that should be readable from two metres away is
   the number and the button.

   Rest starts on its own; the next work set always waits for a tap. Nothing
   should ever start counting a hold while you are still chalking up. */

var runner = null;   /* { sessionId, exIdx, setIdx, phase, side, endAt, secs, startedAt } */
var runTick = null;

/* "20 s" / "15 min" / "35–45 s" → seconds. Ranges take the low end; you can
   edit it up before starting. Anything else is a rep-counted set. */
function timedSeconds(ex) {
  var m = String(ex.reps || '').match(/^(\d+)(?:\s*[–-]\s*\d+)?\s*(s|min)\b/);
  if (!m) return null;
  var n = Number(m[1]);
  return m[2] === 'min' ? n * 60 : n;
}

function isPerSide(ex) {
  return /\/\s*(side|arm|leg)/i.test(String(ex.reps || ''));
}

function stepFor(secs) {
  return secs >= 300 ? 60 : secs >= 60 ? 15 : 5;
}

/* The target for THIS set, not the whole exercise — "Set 1 of 4" is already
   on the line above, so repeating "4 × 5" here just reads as noise. */
function runRepsText(ex) {
  var reps = String(ex.reps || '').trim();
  if (!reps || reps === '—') return '';
  if (/^\d+$/.test(reps)) return reps + (reps === '1' ? ' rep' : ' reps');
  if (/^\d+\s*[–-]\s*\d+$/.test(reps)) return reps + ' reps';
  return reps;                       /* "8 / side", "30 m", "5 + max", "rounds" */
}

function runSession() {
  return runner ? sessionById(runner.sessionId) : null;
}

function runExercise() {
  var s = runSession();
  return s && s.exercises[runner.exIdx] ? s.exercises[runner.exIdx] : null;
}

/* Resume on the first set that is not already ticked off. */
function firstUndoneSet(session, ex) {
  var n = Number(ex.sets) || 0;
  for (var i = 0; i < n; i++) {
    var e = getLog(session.id, ex.id, i);
    if (!e || !e.done) return i;
  }
  return n;                       /* all done */
}

/* Indices of the exercises the runner will actually walk. The red light takes
   an exercise off Today and Plan; the runner has to agree, or one tap on
   "Start session" walks you straight back into what it just pulled. */
function runnableIndexes(session) {
  if (areaPaused(session)) return [];
  var suppressed = sessionGate(session).suppressed;
  var out = [];
  session.exercises.forEach(function (ex, i) {
    if (!(ex.track && suppressed[ex.track])) out.push(i);
  });
  return out;
}

/* The first runnable exercise at or after `from`, or -1 when none is left. */
function nextRunnable(session, from) {
  var list = runnableIndexes(session);
  for (var i = 0; i < list.length; i++) {
    if (list[i] >= from) return list[i];
  }
  return -1;
}

function enterRunner(sessionId, exIdx) {
  var s = sessionById(sessionId);
  if (!s) return renderNotFound('No session "' + sessionId + '".');

  exIdx = Math.max(0, Math.min(exIdx || 0, s.exercises.length - 1));

  /* A stale link can point at an exercise the red light has since pulled. */
  var first = nextRunnable(s, exIdx);
  if (first < 0) first = nextRunnable(s, 0);
  if (first < 0) {
    toast('Everything in this session is paused by the red light.');
    location.hash = '#/today';
    return;
  }
  exIdx = first;
  var ex = s.exercises[exIdx];

  var keepStart = runner && runner.sessionId === sessionId ? runner.startedAt : Date.now();

  runner = {
    sessionId: sessionId,
    exIdx: exIdx,
    setIdx: Math.min(firstUndoneSet(s, ex), (Number(ex.sets) || 1) - 1),
    phase: 'ready',
    side: 0,
    endAt: 0,
    secs: timedSeconds(ex),
    startedAt: keepStart
  };

  document.body.classList.add('in-run');
  acquireWakeLock();              /* hold the screen for the whole session */
  if (!runTick) runTick = setInterval(tickRunner, 250);
  paintRunner();
}

function leaveRunner() {
  runner = null;
  if (runTick) { clearInterval(runTick); runTick = null; }

  /* The root is position:fixed and full-bleed — leaving it in the DOM would
     cover the app with a blank sheet even once the body class is gone. */
  var root = document.getElementById('runner');
  if (root) root.remove();

  document.body.classList.remove('in-run');
  releaseWakeLock();
}

/* --- the state machine ------------------------------------------------ */

function runRemaining() {
  if (!runner || !runner.endAt) return 0;
  return Math.max(0, Math.round((runner.endAt - Date.now()) / 1000));
}

function startTimedSet() {
  runner.phase = 'working';
  runner.endAt = Date.now() + runner.secs * 1000;
  ensureAudio();
  scheduleBeep(runner.secs);
  paintRunner();
}

/* One set finished: log it, advance, and let the rest run itself. */
function completeSet() {
  var s = runSession();
  var ex = runExercise();
  if (!s || !ex) return;

  /* A timed per-side set is two efforts; the first only switches sides. */
  if (runner.phase !== 'resting' && isPerSide(ex) && timedSeconds(ex) !== null && runner.side === 0) {
    runner.side = 1;
    runner.phase = 'ready';
    runner.endAt = 0;
    cancelBeep();
    if (navigator.vibrate) navigator.vibrate(60);
    paintRunner();
    return;
  }

  writeLog(s.id, ex.id, runner.setIdx, { done: true });
  paintCount();
  cancelBeep();

  var lastSet = runner.setIdx >= (Number(ex.sets) || 1) - 1;
  var nextEx = nextRunnable(s, runner.exIdx + 1);
  var lastEx = nextEx < 0;

  runner.side = 0;
  runner.endAt = 0;

  if (lastSet && lastEx) {
    runner.phase = 'finished';
    stopRest();
    paintRunner();
    return;
  }

  if (lastSet) {
    runner.exIdx = nextEx;
    runner.setIdx = 0;
    runner.secs = timedSeconds(s.exercises[nextEx]);
  } else {
    runner.setIdx += 1;
  }

  /* Rest is the one thing that starts by itself. */
  if (Number(ex.restSec) > 0) {
    runner.phase = 'resting';
    startRest(ex);
  } else {
    runner.phase = 'ready';
  }

  paintRunner();
}

function skipRest() {
  stopRest();
  runner.phase = 'ready';
  paintRunner();
}

function skipSet() {
  var s = runSession();
  var ex = runExercise();
  if (!s || !ex) return;

  var lastSet = runner.setIdx >= (Number(ex.sets) || 1) - 1;
  var nextEx = nextRunnable(s, runner.exIdx + 1);
  var lastEx = nextEx < 0;

  cancelBeep();
  runner.endAt = 0;
  runner.side = 0;
  runner.phase = 'ready';

  if (lastSet && lastEx) { runner.phase = 'finished'; paintRunner(); return; }
  if (lastSet) { runner.exIdx = nextEx; runner.setIdx = 0; runner.secs = timedSeconds(s.exercises[nextEx]); }
  else runner.setIdx += 1;

  paintRunner();
}

function skipExercise() {
  var s = runSession();
  if (!s) return;
  cancelBeep();
  stopRest();

  var nextEx = nextRunnable(s, runner.exIdx + 1);
  if (nextEx < 0) { runner.phase = 'finished'; paintRunner(); return; }

  runner.exIdx = nextEx;
  runner.setIdx = firstUndoneSet(s, s.exercises[nextEx]);
  if (runner.setIdx >= (Number(s.exercises[nextEx].sets) || 1)) runner.setIdx = 0;
  runner.secs = timedSeconds(s.exercises[nextEx]);
  runner.side = 0;
  runner.endAt = 0;
  runner.phase = 'ready';
  paintRunner();
}

function adjustSecs(delta) {
  runner.secs = Math.max(5, runner.secs + delta);
  paintRunner();
}

/* --- the tick --------------------------------------------------------- */

function tickRunner() {
  if (!runner) return;

  if (runner.phase === 'working' && runRemaining() === 0) {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    completeSet();
    return;
  }

  if (runner.phase === 'resting' && restRemaining() === 0) {
    runner.phase = 'ready';
    paintRunner();
    return;
  }

  var big = document.getElementById('run-big');
  if (!big) return;
  if (runner.phase === 'working') big.textContent = fmtClock(runRemaining());
  else if (runner.phase === 'resting') big.textContent = fmtClock(restRemaining());
}

/* --- rendering -------------------------------------------------------- */

function runnerRoot() {
  var node = document.getElementById('runner');
  if (!node) {
    node = el('div', { class: 'runner', id: 'runner' });
    document.body.appendChild(node);
  }
  return node;
}

function paintRunner() {
  var root = runnerRoot();
  root.textContent = '';

  var s = runSession();
  if (!s) { leaveRunner(); return; }

  if (runner.phase === 'finished') { root.appendChild(runSummary(s)); return; }

  var ex = s.exercises[runner.exIdx];
  var sets = Number(ex.sets) || 1;
  var timed = timedSeconds(ex) !== null;
  var perSide = isPerSide(ex);
  var walk = runnableIndexes(s);       /* what the red light has not pulled */

  /* top bar */
  var back = el('button', { class: 'run-back', type: 'button', 'aria-label': 'Leave the runner', text: '‹' });
  back.addEventListener('click', function () { location.hash = '#/today'; });

  root.appendChild(el('div', { class: 'run-top' }, [
    back,
    el('div', { class: 'run-crumb' }, [
      el('div', { class: 'run-crumb-week', text: (s.weekLabel || s.week) + ' · ' + s.day }),
      el('div', { class: 'run-crumb-name', text: s.name })
    ]),
    el('div', { class: 'run-pos', text: (Math.max(0, walk.indexOf(runner.exIdx)) + 1) + '/' + walk.length })
  ]));

  var body = el('div', { class: 'run-body' });

  body.appendChild(el('div', { class: 'run-ex', text: ex.name }));
  body.appendChild(el('div', { class: 'run-setline', text: 'Set ' + (runner.setIdx + 1) + ' of ' + sets
    + (perSide && timed ? (runner.side === 0 ? ' · Left' : ' · Right') : '') }));

  /* the target: load, and either reps or an editable duration */
  var gate = sessionGate(s);
  var held = !!(ex.track && gate.holds[ex.track]);
  var load = held ? heldLoad(ex, s, gate.prevWeek) : null;
  if (!load) load = resolveLoad(ex.load, sessionDate(s));

  var target = el('div', { class: 'run-target' });
  if (load.text !== '—') target.appendChild(el('div', { class: 'run-load', text: load.text }));
  if (held) target.appendChild(badge('HOLD', 'badge-hold'));

  if (timed && runner.phase === 'ready') {
    var step = stepFor(runner.secs);
    var minus = el('button', { class: 'run-step', type: 'button', 'aria-label': 'Less time', text: '−' });
    var plus = el('button', { class: 'run-step', type: 'button', 'aria-label': 'More time', text: '+' });
    minus.addEventListener('click', function () { adjustSecs(-step); });
    plus.addEventListener('click', function () { adjustSecs(step); });

    target.appendChild(el('div', { class: 'run-dur' }, [
      minus,
      el('span', { class: 'run-dur-val', text: fmtClock(runner.secs) }),
      plus
    ]));
    target.appendChild(el('div', { class: 'run-hint', text: 'Adjust before you start' }));
  } else if (!timed) {
    target.appendChild(el('div', { class: 'run-reps', text: runRepsText(ex) }));
  }

  body.appendChild(target);

  /* the big number, when something is counting */
  if (runner.phase === 'working' || runner.phase === 'resting') {
    body.appendChild(el('div', {
      class: 'run-big' + (runner.phase === 'resting' ? ' is-rest' : ''),
      id: 'run-big',
      text: fmtClock(runner.phase === 'working' ? runRemaining() : restRemaining())
    }));
    body.appendChild(el('div', { class: 'run-hint', text: runner.phase === 'resting' ? 'Rest' : 'Hold' }));
  }

  /* the one button that matters */
  body.appendChild(primaryAction(ex, timed));

  /* set dots */
  var dots = el('div', { class: 'run-dots' });
  for (var i = 0; i < sets; i++) {
    var e = getLog(s.id, ex.id, i);
    dots.appendChild(el('span', {
      class: 'run-dot' + (e && e.done ? ' is-done' : '') + (i === runner.setIdx ? ' is-now' : '')
    }));
  }
  body.appendChild(dots);

  if (ex.tempo && ex.tempo !== '—') body.appendChild(el('div', { class: 'run-tempo', text: ex.tempo }));
  if (ex.cue) body.appendChild(el('div', { class: 'run-cue', text: ex.cue }));

  /* secondary actions */
  var logBtn = el('button', { class: 'run-link', type: 'button', text: 'Log actual' });
  logBtn.addEventListener('click', function () {
    openSetSheet(ex, s, runner.setIdx, el('button', {}), el('div', {}));
  });

  var skipS = el('button', { class: 'run-link', type: 'button', text: 'Skip set' });
  skipS.addEventListener('click', skipSet);

  var skipE = el('button', { class: 'run-link', type: 'button', text: 'Skip exercise' });
  skipE.addEventListener('click', skipExercise);

  body.appendChild(el('div', { class: 'run-links' }, [logBtn, skipS, skipE]));

  root.appendChild(body);
}

function primaryAction(ex, timed) {
  var btn = el('button', { class: 'run-action', type: 'button' });

  if (runner.phase === 'resting') {
    btn.textContent = 'Skip rest';
    btn.className = 'run-action is-quiet';
    btn.addEventListener('click', skipRest);
    return btn;
  }

  if (runner.phase === 'working') {
    btn.textContent = '✓ Done early';
    btn.className = 'run-action is-quiet';
    btn.addEventListener('click', function () { cancelBeep(); completeSet(); });
    return btn;
  }

  if (timed) {
    btn.textContent = '▶ Start set ' + (runner.setIdx + 1);
    btn.addEventListener('click', startTimedSet);
    return btn;
  }

  btn.textContent = '✓ Set ' + (runner.setIdx + 1) + ' done';
  btn.addEventListener('click', completeSet);
  return btn;
}

function runSummary(s) {
  var total = totalSets(s);
  var done = doneSets(s);
  var mins = Math.max(1, Math.round((Date.now() - runner.startedAt) / 60000));

  var finish = el('button', { class: 'run-action', type: 'button', text: 'Finish' });
  finish.addEventListener('click', function () { location.hash = '#/today'; });

  return el('div', { class: 'run-body run-done' }, [
    el('div', { class: 'run-ex', text: 'Session done' }),
    el('div', { class: 'run-setline', text: s.name }),
    el('div', { class: 'run-big', text: done + ' / ' + total }),
    el('div', { class: 'run-hint', text: 'sets logged · ' + mins + ' min' }),
    finish,
    el('div', { class: 'run-cue', text: done < total
      ? 'Some sets were skipped. You can still tick them off on the Today tab.'
      : 'Everything the plan asked for. Check in tomorrow morning.' })
  ]);
}

/* --- Check-in ---------------------------------------------------------- */
/* A separate event from the session log, with its own screen, because the
   plan autoregulates off next-morning stiffness rather than off how a set
   felt at the time. */

var AREA_LABEL = { elbow: 'Medial elbow', shoulder: 'Shoulder', achilles: 'Achilles', hamstring: 'Hamstring' };
var STATE_LABEL = { green: 'Green', amber: 'Amber', red: 'Red' };

/* The track keys are join keys, not English. */
var TRACK_LABEL = {
  pullup: 'pull-up', dips: 'dips', heelRaise: 'heel raise', pogo: 'pogo',
  nordic: 'Nordic', hinge: 'hinge', sprint: 'sprint', kbPress: 'KB press'
};

function trackNames(area) {
  return tracksForArea(area).map(function (t) { return TRACK_LABEL[t] || t; }).join(', ');
}

function renderCheckIn() {
  var today = todayISO();
  var existing = checkInOn(today);

  /* Editing today's entry rather than stacking a second one. */
  var draft = {
    date: today,
    pain: {
      elbow: existing ? painOf(existing, 'elbow') : 0,
      shoulder: existing ? painOf(existing, 'shoulder') : 0,
      achilles: existing ? painOf(existing, 'achilles') : 0,
      hamstring: existing ? painOf(existing, 'hamstring') : 0
    },
    stiffness: existing ? existing.stiffness : 'none',
    note: existing ? (existing.note || '') : ''
  };

  var verdictBox = el('div', { class: 'verdict', id: 'verdict' });

  function repaintVerdict() {
    verdictBox.textContent = '';
    var prior = priorTo(today);
    var states = areaStates(draft, prior);
    var overall = worstState(states);

    verdictBox.className = 'verdict verdict-' + overall;
    verdictBox.appendChild(el('div', { class: 'verdict-state', text: STATE_LABEL[overall] }));
    verdictBox.appendChild(el('div', { class: 'verdict-action', text: stateAction(overall) }));

    var rows = el('div', { class: 'verdict-areas' });
    areas().forEach(function (a) {
      var s = states[a];
      rows.appendChild(el('div', { class: 'verdict-row' }, [
        el('span', { class: 'dot dot-' + s }),
        el('span', { class: 'verdict-area', text: AREA_LABEL[a] }),
        el('span', { class: 'verdict-tracks', text: s === 'green' ? '' : trackNames(a) })
      ]));
    });
    verdictBox.appendChild(rows);

    /* The one hardcoded exception: the tendon that can end the attempt. */
    if (states.elbow === 'amber' || states.elbow === 'red') {
      verdictBox.appendChild(el('div', { class: 'verdict-flag', text: plan.trafficLight.elbowRule }));
    }

    var rising = areas().filter(function (a) { return risingThree(a, draft, prior); });
    if (rising.length) {
      verdictBox.appendChild(el('div', { class: 'verdict-flag', text: 'Rising three check-ins running: '
        + rising.map(function (a) { return AREA_LABEL[a]; }).join(', ') + '.' }));
    }
  }

  var nodes = [];

  nodes.push(el('p', { class: 'section-label', text: 'Morning check-in · ' + fmtDate(today) }));
  nodes.push(el('p', { class: 'hint', text: 'How it feels this morning, not how it felt during the session.' }));

  /* --- pain sliders --- */
  areas().forEach(function (a) {
    var out = el('span', { class: 'slider-val', text: String(draft.pain[a]) });
    var input = el('input', { type: 'range', min: '0', max: '10', step: '1', class: 'slider',
      id: 'pain-' + a, 'aria-label': AREA_LABEL[a] + ' pain, 0 to 10' });
    input.value = draft.pain[a];

    input.addEventListener('input', function () {
      draft.pain[a] = Number(input.value);
      out.textContent = input.value;
      repaintVerdict();
    });

    nodes.push(el('div', { class: 'slider-block' }, [
      el('div', { class: 'slider-head' }, [
        el('label', { class: 'slider-label', for: 'pain-' + a, text: AREA_LABEL[a] }),
        out
      ]),
      input
    ]));
  });

  /* --- stiffness --- */
  nodes.push(el('p', { class: 'section-label', text: 'Morning stiffness' }));
  var seg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Morning stiffness' });

  STIFFNESS.forEach(function (opt) {
    var b = el('button', {
      type: 'button',
      class: 'seg-btn' + (draft.stiffness === opt.value ? ' is-on' : ''),
      role: 'radio',
      'aria-checked': draft.stiffness === opt.value ? 'true' : 'false',
      text: opt.label
    });
    b.addEventListener('click', function () {
      draft.stiffness = opt.value;
      Array.prototype.forEach.call(seg.children, function (c) {
        c.classList.remove('is-on');
        c.setAttribute('aria-checked', 'false');
      });
      b.classList.add('is-on');
      b.setAttribute('aria-checked', 'true');
      repaintVerdict();
    });
    seg.appendChild(b);
  });
  nodes.push(seg);

  /* --- note --- */
  nodes.push(el('p', { class: 'section-label', text: 'Note' }));
  var note = el('textarea', { class: 'note', rows: '2', placeholder: 'Anything worth remembering', id: 'ci-note' });
  note.value = draft.note;
  note.addEventListener('input', function () { draft.note = note.value; });
  nodes.push(note);

  /* --- verdict, live --- */
  nodes.push(el('p', { class: 'section-label', text: 'Verdict' }));
  nodes.push(verdictBox);

  var save = el('button', { class: 'btn btn-go btn-block', type: 'button',
    text: existing ? 'Update check-in' : 'Save check-in' });
  save.addEventListener('click', function () {
    var entry = { date: today, pain: draft.pain, stiffness: draft.stiffness };
    if (draft.note.trim()) entry.note = draft.note.trim();

    checkIns = checkIns.filter(function (c) { return c.date !== today; });
    checkIns.push(entry);
    sortCheckIns();
    saveCheckIns();

    renderCheckIn();
    paintTabBadge();
    toast('Check-in saved.');
  });
  nodes.push(save);

  nodes.push(reminderBlock());

  /* --- history --- */
  if (checkIns.length) {
    nodes.push(el('p', { class: 'section-label', text: 'Recent check-ins' }));
    checkIns.slice(-10).reverse().forEach(function (c) { nodes.push(checkInRow(c)); });
  }

  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));

  setView('Check-in', existing ? 'logged today' : '', nodes);
  repaintVerdict();
  window.scrollTo(0, 0);
}

function checkInRow(c) {
  var overall = worstState(areaStates(c, priorTo(c.date)));
  var pains = areas().map(function (a) { return AREA_LABEL[a].split(' ').pop() + ' ' + painOf(c, a); }).join(' · ');
  var stiff = (STIFFNESS.filter(function (s) { return s.value === c.stiffness; })[0] || {}).label || '—';

  return el('div', { class: 'card hist' }, [
    el('div', { class: 'card-top' }, [
      el('span', { class: 'dot dot-' + overall }),
      el('span', { class: 'card-title', text: fmtDate(c.date) }),
      el('div', { class: 'badges' }, [badge(STATE_LABEL[overall], 'badge-' + overall)])
    ]),
    el('div', { class: 'card-sub', text: pains + ' · stiffness ' + stiff }),
    c.note ? el('div', { class: 'card-sub card-note', text: c.note }) : null
  ]);
}

/* --- the 08:00 prompt ------------------------------------------------- */
/* A PWA with no backend cannot wake itself, so this is honest about what it
   is: a real notification while the app is running or backgrounded, plus a
   badge that is still there whenever you next open it. Permission is asked
   after a session has been logged, from a tap — never on first launch. */

var reminderTimer = null;

function notifSupported() {
  return typeof Notification !== 'undefined';
}

function notifHour() {
  var h = Number(settings.notifHour);
  return isFinite(h) && h >= 0 && h <= 23 ? h : 8;
}

function checkInDueToday() {
  return !checkInOn(todayISO());
}

function hasLoggedASession() {
  return setLogs.length > 0;
}

function showCheckInNotification() {
  if (!notifSupported() || Notification.permission !== 'granted') return;

  var title = 'Morning check-in';
  var opts = { body: 'Pain and stiffness — it sets this week’s loads.', tag: 'checkin', icon: 'icons/icon-192.png' };

  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.showNotification) reg.showNotification(title, opts);
        else new Notification(title, opts);
      }).catch(function () { /* nothing useful to do */ });
    } else {
      new Notification(title, opts);
    }
  } catch (err) {
    console.warn('notification failed', err);
  }
}

function scheduleReminder() {
  if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = null; }
  if (!notifSupported() || Notification.permission !== 'granted') return;

  var now = new Date();
  var next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), notifHour(), 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);

  var wait = next.getTime() - now.getTime();
  if (wait > 2147483647) return;              /* beyond what setTimeout takes */

  reminderTimer = setTimeout(function () {
    if (checkInDueToday()) showCheckInNotification();
    scheduleReminder();
  }, wait);
}

function reminderBlock() {
  var wrap = el('div', {}, [el('p', { class: 'section-label', text: 'Morning reminder' })]);

  if (!notifSupported()) {
    wrap.appendChild(el('p', { class: 'hint', text: 'This browser cannot show notifications. The dot on the Check-in tab is the reminder.' }));
    return wrap;
  }

  if (Notification.permission === 'granted') {
    var sel = el('select', { id: 'notif-hour', 'aria-label': 'Reminder hour' });
    for (var h = 5; h <= 12; h++) {
      sel.appendChild(el('option', { value: String(h), text: String(h).padStart(2, '0') + ':00' }));
    }
    sel.value = String(notifHour());
    sel.addEventListener('change', function () {
      settings.notifHour = Number(sel.value);
      saveSettings();
      scheduleReminder();
      toast('Reminder set for ' + String(notifHour()).padStart(2, '0') + ':00.');
    });
    wrap.appendChild(el('div', { class: 'field' }, [el('span', { text: 'Remind me at' }), sel]));
    wrap.appendChild(el('p', { class: 'hint', text: 'Fires while the app is open or in the background. If Android has closed it entirely, the dot on the Check-in tab is what catches you.' }));
    return wrap;
  }

  if (Notification.permission === 'denied') {
    wrap.appendChild(el('p', { class: 'hint', text: 'Notifications are blocked for this site in Chrome’s settings. The dot on the Check-in tab still works.' }));
    return wrap;
  }

  if (!hasLoggedASession()) {
    wrap.appendChild(el('p', { class: 'hint', text: 'Once you have logged a session, you can turn on a morning reminder here.' }));
    return wrap;
  }

  var ask = el('button', { class: 'btn btn-block', type: 'button', text: 'Remind me at 08:00' });
  ask.addEventListener('click', function () {
    try {
      var p = Notification.requestPermission();
      if (p && p.then) {
        p.then(function (result) {
          settings.notifAsked = true;
          if (!settings.notifHour) settings.notifHour = 8;
          saveSettings();
          if (result === 'granted') scheduleReminder();
          renderCheckIn();
        });
      }
    } catch (err) {
      console.warn('permission request failed', err);
    }
  });
  wrap.appendChild(ask);
  return wrap;
}

/* ------------------------------------------------------------ hold gating */
/* What turns the document into a system: an amber week does not just advise
   against progressing, it stops the next week from showing the increase.

   All of it is derived from checkIns on demand — nothing here is stored, so
   correcting a pain entry re-gates the following week by itself. */

var RED_DAYS = 7;          /* the red protocol runs for seven days */

function addDays(iso, n) {
  var d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* A plan week is its start plus six days. */
function weekWindow(week) {
  return { from: week.start, to: addDays(week.start, 6) };
}

function previousWeek(weekId) {
  var all = allWeeks();
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === weekId) return i > 0 ? all[i - 1] : null;
  }
  return null;
}

function checkInsBetween(from, to) {
  return checkIns.filter(function (c) { return c.date >= from && c.date <= to; });
}

/* Areas that went amber or worse at any point in a week. Red counts: it is
   worse than amber, so it certainly does not license a progression. */
function heldAreasFromWeek(week) {
  var out = {};
  if (!week) return out;

  var win = weekWindow(week);
  checkInsBetween(win.from, win.to).forEach(function (c) {
    var states = areaStates(c, priorTo(c.date));
    areas().forEach(function (a) {
      if (states[a] === 'amber' || states[a] === 'red') out[a] = true;
    });
  });
  return out;
}

/* Areas under the red protocol on a given date, and when each one lifts. */
function redAreasOn(date) {
  var out = {};
  checkIns.forEach(function (c) {
    if (c.date > date) return;                       /* not yet happened */
    if (addDays(c.date, RED_DAYS - 1) < date) return; /* the seven days are up */

    var states = areaStates(c, priorTo(c.date));
    areas().forEach(function (a) {
      if (states[a] !== 'red') return;
      var until = addDays(c.date, RED_DAYS - 1);
      if (!out[a] || out[a] < until) out[a] = until;
    });
  });
  return out;
}

/* Hardcoded, and deliberately not folded into the week rule: the medial
   elbow holds the pull-up the moment it goes amber, without waiting for a
   week boundary. That tendon is the one thing that can end the attempt. */
function elbowHoldsPullup(date) {
  var recent = checkInsBetween(addDays(date, -RED_DAYS), date);
  return recent.some(function (c) {
    var s = areaState('elbow', c, priorTo(c.date));
    return s === 'amber' || s === 'red';
  });
}

function tracksOf(areaMap) {
  var out = {};
  Object.keys(areaMap).forEach(function (a) {
    tracksForArea(a).forEach(function (t) { out[t] = true; });
  });
  return out;
}

/* Everything the renderer needs for one session, worked out once. */
function sessionGate(session) {
  var prev = previousWeek(session.week);
  var heldAreas = heldAreasFromWeek(prev);
  var redAreas = redAreasOn(sessionDate(session));

  var holds = tracksOf(heldAreas);
  var suppressed = tracksOf(redAreas);

  if (elbowHoldsPullup(sessionDate(session))) holds.pullup = true;

  /* A suppressed track is already off the page; no need to badge it too. */
  Object.keys(suppressed).forEach(function (t) { delete holds[t]; });

  return {
    holds: holds,
    suppressed: suppressed,
    heldAreas: Object.keys(heldAreas),
    redAreas: Object.keys(redAreas),
    redUntil: redAreas,
    prevWeek: prev
  };
}

/* The load this track was at last week — what a HOLD shows instead of the
   scheduled increase. Resolved against last week's date, so it uses the
   baselines that were in force then. */
function heldLoad(ex, session, prevWeek) {
  if (!prevWeek) return null;

  var match = null;
  sessionsForWeek(prevWeek.id).forEach(function (s) {
    s.exercises.forEach(function (e) {
      if (!match && e.id === ex.id) match = { s: s, e: e };
    });
  });

  if (!match && ex.track) {
    sessionsForWeek(prevWeek.id).forEach(function (s) {
      s.exercises.forEach(function (e) {
        if (!match && e.track === ex.track) match = { s: s, e: e };
      });
    });
  }

  return match ? resolveLoad(match.e.load, sessionDate(match.s)) : null;
}

/* The red banner, naming what has been pulled and why. */
function redBanner(session, gate) {
  var names = [];
  session.exercises.forEach(function (ex) {
    if (ex.track && gate.suppressed[ex.track]) names.push(ex.name);
  });

  var areaNames = gate.redAreas.map(function (a) { return AREA_LABEL[a] || a; }).join(', ');
  var until = gate.redAreas.map(function (a) { return gate.redUntil[a]; }).sort().pop();

  var box = el('div', { class: 'callout callout-red' }, [
    el('strong', { text: 'Red · ' + areaNames }),
    document.createTextNode(stateAction('red'))
  ]);

  if (names.length) {
    box.appendChild(el('div', { class: 'callout-list', text: 'Pulled from today: ' + names.join(', ') + '.' }));
  }
  if (until) {
    box.appendChild(el('div', { class: 'callout-list', text: 'Back in on ' + fmtDate(addDays(until, 1)) + ' if it has settled.' }));
  }

  return box;
}

/* The amber banner: what is being held, and which areas caused it. */
function holdBanner(session, gate) {
  var tracks = {};
  session.exercises.forEach(function (ex) {
    if (ex.track && gate.holds[ex.track]) tracks[ex.track] = true;
  });
  if (!Object.keys(tracks).length) return null;

  var names = Object.keys(tracks).map(function (t) { return TRACK_LABEL[t] || t; }).join(', ');
  var from = gate.heldAreas.map(function (a) { return AREA_LABEL[a] || a; }).join(', ');

  var box = el('div', { class: 'callout' }, [
    el('strong', { text: 'Holding · ' + names }),
    document.createTextNode(stateAction('amber'))
  ]);

  if (from) {
    box.appendChild(el('div', { class: 'callout-list', text: 'From amber on ' + from
      + (gate.prevWeek ? ' during ' + gate.prevWeek.label : '') + '. Loads shown are last week’s.' }));
  } else {
    box.appendChild(el('div', { class: 'callout-list', text: 'Amber on the medial elbow holds the pull-up regardless of the schedule.' }));
  }

  return box;
}

/* ------------------------------------------------------------- install */
/* Chrome will not say why it is refusing to install a site, so this reports
   each condition separately. Everything here is read from the live page, on
   the phone, which is the only place that can answer the question. */

function installSection() {
  var wrap = el('div', {}, [el('p', { class: 'section-label', text: 'Install & offline' })]);

  var rows = el('div', { class: 'kv' });
  function row(key, id) {
    var val = el('span', { class: 'kv-val kv-quiet', id: id, text: 'checking…' });
    rows.appendChild(el('div', { class: 'kv-row' }, [el('span', { class: 'kv-key', text: key }), val]));
    return val;
  }

  var rMode = row('Running as', 'dg-mode');
  var rHttps = row('Served over', 'dg-https');
  var rSW = row('Service worker', 'dg-sw');
  var rCache = row('Offline cache', 'dg-cache');
  var rManifest = row('Manifest', 'dg-manifest');

  wrap.appendChild(rows);

  rMode.textContent = isInstalled() ? 'installed app' : 'browser tab';
  rMode.className = 'kv-val ' + (isInstalled() ? 'kv-ok' : 'kv-quiet');

  var secure = location.protocol === 'https:' || location.hostname === 'localhost';
  rHttps.textContent = location.protocol.replace(':', '') + (secure ? '' : ' — install needs https');
  rHttps.className = 'kv-val ' + (secure ? 'kv-ok' : 'kv-bad');

  /* service worker */
  if (!('serviceWorker' in navigator)) {
    rSW.textContent = 'not supported';
    rSW.className = 'kv-val kv-bad';
  } else {
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) {
        rSW.textContent = swError ? 'failed — ' + swError : 'not registered';
        rSW.className = 'kv-val kv-bad';
        return;
      }
      var w = reg.active ? 'active' : reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'registered';
      rSW.textContent = w + ' · scope ' + reg.scope.replace(location.origin, '');
      rSW.className = 'kv-val ' + (reg.active ? 'kv-ok' : 'kv-quiet');
    }).catch(function (err) {
      rSW.textContent = 'error — ' + err.message;
      rSW.className = 'kv-val kv-bad';
    });
  }

  /* what is actually cached */
  if (!('caches' in window)) {
    rCache.textContent = 'not supported';
    rCache.className = 'kv-val kv-bad';
  } else {
    caches.keys().then(function (keys) {
      if (!keys.length) { rCache.textContent = 'empty'; rCache.className = 'kv-val kv-bad'; return; }
      return caches.open(keys[keys.length - 1]).then(function (c) {
        return c.keys().then(function (items) {
          rCache.textContent = items.length + ' files · ' + keys[keys.length - 1];
          rCache.className = 'kv-val ' + (items.length ? 'kv-ok' : 'kv-bad');
        });
      });
    }).catch(function () {
      rCache.textContent = 'unreadable';
      rCache.className = 'kv-val kv-bad';
    });
  }

  /* the manifest has to actually resolve from wherever this is hosted */
  var link = document.querySelector('link[rel="manifest"]');
  if (!link) {
    rManifest.textContent = 'not linked';
    rManifest.className = 'kv-val kv-bad';
  } else {
    fetch(link.href).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (m) {
      var icons = (m.icons || []).length;
      rManifest.textContent = 'ok · ' + icons + ' icons';
      rManifest.className = 'kv-val kv-ok';
    }).catch(function (err) {
      rManifest.textContent = 'failed — ' + err.message;
      rManifest.className = 'kv-val kv-bad';
    });
  }

  if (isInstalled()) {
    wrap.appendChild(el('p', { class: 'hint', text: 'This is the installed app. It runs offline and keeps its data on this phone.' }));
    return wrap;
  }

  if (installPrompt) {
    var btn = el('button', { class: 'btn btn-go btn-block', type: 'button', text: 'Install on this phone' });
    btn.addEventListener('click', function () {
      installPrompt.prompt();
      installPrompt.userChoice.then(function (choice) {
        if (choice.outcome === 'accepted') installPrompt = null;
        renderProgress();
      });
    });
    wrap.appendChild(btn);
    wrap.appendChild(el('p', { class: 'hint', text: 'Chrome has confirmed this site is installable.' }));
  } else {
    wrap.appendChild(el('p', { class: 'hint', text: 'No install button yet. If every row above is green, use Chrome’s ⋮ menu → Install app (or Add to Home screen). If a row is red, that is what is blocking it. Chrome sometimes only offers installation on a second visit — reload once and come back.' }));
  }

  return wrap;
}

/* ---------------------------------------------------------------- charts */
/* Load by week, per track. Inline SVG, no library.

   Only the tracks the plan actually prescribes in kilos can be charted:
   the rest are written as bodyweight, bands or RPE and have no number to
   plot. Those say so rather than rendering an empty box. */

var SVGNS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs, children) {
  var node = document.createElementNS(SVGNS, tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) return;
      if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
  }
  (children || []).forEach(function (c) { if (c) node.appendChild(c); });
  return node;
}

/* The top numeric load this track reaches in each week. A week can touch a
   track more than once; the heaviest is the one that marks the progression. */
function trackSeries(track) {
  var points = [];

  allWeeks().forEach(function (w) {
    var best = null;
    sessionsForWeek(w.id).forEach(function (s) {
      s.exercises.forEach(function (e) {
        if (e.track !== track) return;
        var r = resolveLoad(e.load, sessionDate(s));
        if (r.kg === null || r.missing) return;
        if (!best || r.kg > best.kg) best = { kg: r.kg, date: sessionDate(s), exId: e.id, exName: e.name };
      });
    });
    if (best) points.push({ week: w.id, label: w.label, kg: best.kg, date: best.date,
                            exId: best.exId, exName: best.exName });
  });

  return points;
}

/* What you actually put on the bar, from the long-press entries. */
function actualByWeek(track) {
  var out = {};

  setLogs.forEach(function (l) {
    if (l.loadKg === undefined) return;
    var s = sessionById(l.sessionId);
    if (!s) return;
    var ex = s.exercises.filter(function (e) { return e.id === l.exerciseId; })[0];
    if (!ex || ex.track !== track) return;
    if (out[s.week] === undefined || l.loadKg > out[s.week]) out[s.week] = l.loadKg;
  });

  return out;
}

/* Does this track carry any numeric load at all, anywhere in the block? */
function trackIsNumeric(track) {
  var found = false;
  plan.sessions.forEach(function (s) {
    s.exercises.forEach(function (e) {
      if (e.track !== track) return;
      var t = e.load && e.load.type;
      if (t === 'pct5RM' || t === 'pctBW' || t === 'fixedKg') found = true;
    });
  });
  return found;
}

/* How a non-numeric track is actually written, so the note is specific. */
function trackPrescription(track) {
  var types = {};
  plan.sessions.forEach(function (s) {
    s.exercises.forEach(function (e) {
      if (e.track === track && e.load && e.load.type) types[e.load.type] = true;
    });
  });

  if (types.bodyweight && !types.text) return 'bodyweight throughout';
  if (types.text && !types.bodyweight) return 'bands and RPE, not kilos';
  if (types.text && types.bodyweight) return 'bodyweight and bands, not kilos';
  if (types.none) return 'no load prescribed';
  return 'no numeric load';
}

/* Split a series into runs of the same movement, keeping each point's index
   so the x positions stay on the shared week axis.

   Split on the NAME, not the id: the plan reuses id "heel-raise" either
   side of the double-leg to single-leg switch, so the id would miss the one
   break that matters most. */
function segmentsOf(series) {
  var segs = [];
  var cur = null;

  series.forEach(function (p, i) {
    if (!cur || cur.name !== p.exName) {
      cur = { name: p.exName, points: [] };
      segs.push(cur);
    }
    cur.points.push({ p: p, i: i });
  });

  return segs.map(function (s) { return s.points; });
}

/* The block's actual progression for this track — the longest run of one
   movement. A one-session test day at the end is not the headline. */
function mainSegment(segs) {
  var best = segs[0];
  segs.forEach(function (s) { if (s.length >= best.length) best = s; });
  return best;
}

var CHART_W = 320;
var CHART_H = 118;
var PAD = { l: 34, r: 8, t: 10, b: 20 };

function lineChart(series, actual, track) {
  var plotW = CHART_W - PAD.l - PAD.r;
  var plotH = CHART_H - PAD.t - PAD.b;

  var values = series.map(function (p) { return p.kg; });
  Object.keys(actual).forEach(function (k) { values.push(actual[k]); });

  var lo = Math.min.apply(null, values);
  var hi = Math.max.apply(null, values);
  if (hi === lo) { hi = lo + 1.25; lo = Math.max(0, lo - 1.25); }

  var span = hi - lo;
  lo = Math.max(0, lo - span * 0.12);
  hi = hi + span * 0.12;

  function x(i) {
    return PAD.l + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  }
  function y(kg) {
    return PAD.t + plotH - ((kg - lo) / (hi - lo)) * plotH;
  }

  var g = [];

  /* frame: just the two values that matter, top and bottom */
  [hi, lo].forEach(function (v) {
    g.push(svgEl('line', { x1: PAD.l, y1: y(v), x2: CHART_W - PAD.r, y2: y(v), class: 'ch-grid' }));
    g.push(svgEl('text', { x: PAD.l - 5, y: y(v) + 3.5, class: 'ch-ytick', 'text-anchor': 'end',
      text: fmtKg(Math.round(v / PLATE) * PLATE) }));
  });

  /* where the 5RM was retested — the reason for any step in the line */
  recalibrationCheckpoints().forEach(function (c) {
    for (var i = 0; i < series.length; i++) {
      if (series[i].date >= c.date) {
        g.push(svgEl('line', { x1: x(i), y1: PAD.t, x2: x(i), y2: PAD.t + plotH, class: 'ch-recal' }));
        break;
      }
    }
  });

  /* A track can swap movement mid-block — the heel raise goes from
     double-leg at 40% BW to single-leg at 10%. Joining those with one line
     would draw a progression as a collapse, so break at every change. */
  segmentsOf(series).forEach(function (seg) {
    g.push(svgEl('polyline', {
      class: 'ch-line',
      points: seg.map(function (s) { return x(s.i) + ',' + y(s.p.kg); }).join(' ')
    }));
  });

  series.forEach(function (p, i) {
    g.push(svgEl('circle', { cx: x(i), cy: y(p.kg), r: 2.6, class: 'ch-dot' }, [
      svgEl('title', { text: p.label + ': ' + fmtKg(p.kg) + ' kg' })
    ]));
  });

  /* what actually went on the bar, where it was logged */
  series.forEach(function (p, i) {
    if (actual[p.week] === undefined) return;
    g.push(svgEl('circle', { cx: x(i), cy: y(actual[p.week]), r: 3.2, class: 'ch-actual' }, [
      svgEl('title', { text: p.label + ' actual: ' + fmtKg(actual[p.week]) + ' kg' })
    ]));
  });

  /* first and last week only — anything more is unreadable at this size */
  g.push(svgEl('text', { x: PAD.l, y: CHART_H - 6, class: 'ch-xtick', 'text-anchor': 'start',
    text: series[0].label.replace('Week ', 'W') }));
  if (series.length > 1) {
    g.push(svgEl('text', { x: CHART_W - PAD.r, y: CHART_H - 6, class: 'ch-xtick', 'text-anchor': 'end',
      text: series[series.length - 1].label.replace('Week ', 'W') }));
  }

  var main = mainSegment(segmentsOf(series));
  var summary = (TRACK_LABEL[track] || track) + ': ' + main[0].p.exName + ', '
    + fmtKg(main[0].p.kg) + ' kg in ' + main[0].p.label + ' to '
    + fmtKg(main[main.length - 1].p.kg) + ' kg in ' + main[main.length - 1].p.label + '.';

  return svgEl('svg', {
    viewBox: '0 0 ' + CHART_W + ' ' + CHART_H,
    class: 'chart',
    role: 'img',
    'aria-label': summary
  }, [svgEl('title', { text: summary })].concat(g));
}

function chartsSection() {
  var wrap = el('div', {}, [el('p', { class: 'section-label', text: 'Load by week' })]);

  if (!baselines.length) {
    wrap.appendChild(el('p', { class: 'hint', text: 'Set your baselines and the progression charts appear here.' }));
    return wrap;
  }

  var tracks = Object.keys(plan.trafficLight.areaToTracks).reduce(function (acc, area) {
    tracksForArea(area).forEach(function (t) { if (acc.indexOf(t) < 0) acc.push(t); });
    return acc;
  }, []);

  var charted = 0;
  var unplottable = [];

  tracks.forEach(function (track) {
    if (!trackIsNumeric(track)) {
      unplottable.push((TRACK_LABEL[track] || track) + ' — ' + trackPrescription(track));
      return;
    }

    var series = trackSeries(track);
    if (!series.length) return;

    charted++;
    var actual = actualByWeek(track);
    var segs = segmentsOf(series);
    var main = mainSegment(segs);
    var delta = main[main.length - 1].p.kg - main[0].p.kg;

    var names = [];
    segs.forEach(function (s) {
      var n = s[0].p.exName;
      if (names.indexOf(n) < 0) names.push(n);
    });

    wrap.appendChild(el('div', { class: 'chart-card' }, [
      el('div', { class: 'chart-head' }, [
        el('span', { class: 'chart-title', text: TRACK_LABEL[track] || track }),
        el('span', { class: 'chart-delta', text: (delta >= 0 ? '+' : '−') + fmtKg(Math.abs(delta)) + ' kg' })
      ]),
      el('div', { class: 'chart-sub', text: names.join(' → ') }),
      lineChart(series, actual, track),
      el('div', { class: 'chart-key', text: (segs.length > 1 ? 'Line breaks where the movement changes' : 'Line is the planned load')
        + (Object.keys(actual).length ? ' · filled dots are what you logged' : '') })
    ]));
  });

  if (!charted) {
    wrap.appendChild(el('p', { class: 'hint', text: 'Nothing to chart yet.' }));
  }

  if (unplottable.length) {
    wrap.appendChild(el('div', { class: 'kv' }, unplottable.map(function (line) {
      var bits = line.split(' — ');
      return el('div', { class: 'kv-row' }, [
        el('span', { class: 'kv-key', text: bits[0] }),
        el('span', { class: 'kv-val kv-quiet', text: bits[1] })
      ]);
    })));
    wrap.appendChild(el('p', { class: 'hint', text: 'These tracks progress by reps, band or tempo rather than by load, so there is no weight to plot.' }));
  }

  return wrap;
}

/* --- rescheduling, the screen side ------------------------------------- */

function movePicker(targetDate) {
  var occupant = sessionOn(targetDate, null);

  var list = el('div', { class: 'picklist' });
  /* A week back and a fortnight forward. Wider than that and the thing you
     actually want — usually a day or two either side — is buried. Sessions
     you have already finished are not offered: you do not move those. */
  var candidates = sessionsByDate().filter(function (s) {
    if (isSkipped(s) || s.tag === 'rest') return false;
    if (occupant && s.id === occupant.id) return false;
    if (doneSets(s) >= totalSets(s)) return false;
    var d = sessionDate(s);
    return d >= addDays(targetDate, -7) && d <= addDays(targetDate, 14);
  });

  if (!candidates.length) {
    list.appendChild(el('p', { class: 'hint', text: 'Nothing nearby to move.' }));
  }

  candidates.forEach(function (s) {
    var btn = el('button', { class: 'card pick', type: 'button' }, [
      el('div', { class: 'card-top' }, [
        el('span', { class: 'dot ' + tagClass('dot', s.tag) }),
        el('span', { class: 'card-title', text: s.day + ' ' + fmtDateShort(sessionDate(s)) }),
        el('div', { class: 'badges' }, [
          sessionDate(s) < targetDate ? badge('Missed', 'badge-test') : null,
          badge(s.weekLabel || s.week)
        ])
      ]),
      el('div', { class: 'card-sub', text: s.name })
    ]);
    btn.addEventListener('click', function () {
      closeSheet();
      chooseMove(s, targetDate, occupant);
    });
    list.appendChild(btn);
  });

  openSheet('Do a different session', 'Pick what you want to train on ' + fmtDate(targetDate) + '.', [list]);
}

/* With a session already in the slot there are three honest answers, and
   which one is right depends on why you are moving it. */
function chooseMove(src, targetDate, occupant) {
  if (!occupant) {
    rescheduleSwap(src.id, targetDate);       /* nothing to displace */
    afterMove(src, targetDate);
    return;
  }

  function opt(label, detail, fn) {
    var b = el('button', { class: 'card pick', type: 'button' }, [
      el('div', { class: 'card-top' }, [el('span', { class: 'card-title', text: label })]),
      el('div', { class: 'card-sub', text: detail })
    ]);
    b.addEventListener('click', function () { closeSheet(); fn(); afterMove(src, targetDate); });
    return b;
  }

  var srcWhen = fmtDateShort(sessionDate(src));

  openSheet(src.name, fmtDate(targetDate) + ' already has “' + occupant.name + '”. What happens to it?', [
    el('div', { class: 'picklist' }, [
      opt('Swap them', 'It moves to ' + srcWhen + '. Nothing else in the block changes.',
        function () { rescheduleSwap(src.id, targetDate); }),
      opt('Push everything back', 'It and everything after it slide one slot later.',
        function () { reschedulePush(src.id, targetDate); }),
      opt('Skip it', 'It is abandoned unlogged. Nothing else moves.',
        function () { rescheduleSkip(src.id, targetDate); })
    ])
  ]);
}

function afterMove(src, targetDate) {
  route();
  paintTabBadge();
  toast(src.name.split('—')[0].trim() + ' moved to ' + fmtDateShort(targetDate) + '.');
}

/* A small generic sheet, so the picker and the three-way choice share one. */
function openSheet(title, sub, nodes) {
  closeSheet();

  var form = el('div', { class: 'sheet' }, [
    el('h3', { text: title }),
    el('p', { class: 'sheet-sub', text: sub })
  ].concat(nodes));

  var cancel = el('button', { type: 'button', class: 'btn btn-quiet btn-block', text: 'Cancel' });
  cancel.addEventListener('click', closeSheet);
  form.appendChild(cancel);

  var backdrop = el('div', { class: 'sheet-backdrop', id: 'move-sheet' }, [form]);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeSheet(); });
  document.addEventListener('keydown', sheetEsc);
  document.body.appendChild(backdrop);
}

function sheetEsc(e) { if (e.key === 'Escape') closeSheet(); }

function closeSheet() {
  var s = document.getElementById('move-sheet');
  if (s) s.remove();
  document.removeEventListener('keydown', sheetEsc);
}

/* Shown wherever a session is listed, so a moved block is never a mystery. */
function moveBadges(s) {
  if (isSkipped(s)) return badge('Skipped', 'badge-test');
  if (isMoved(s)) return badge('Moved', 'badge-now');
  return null;
}

function scheduleSection() {
  var n = movedCount();
  var wrap = el('div', {}, [el('p', { class: 'section-label', text: 'Schedule' })]);

  if (!n) {
    wrap.appendChild(el('p', { class: 'hint', text: 'Running exactly as planned. Move a session from the Today tab if a day goes sideways.' }));
    return wrap;
  }

  var rows = el('div', { class: 'kv' });
  plan.sessions.forEach(function (s) {
    if (!isMoved(s) && !isSkipped(s)) return;
    rows.appendChild(el('div', { class: 'kv-row' }, [
      el('span', { class: 'kv-key', text: s.day + ' · ' + s.name.split('—')[0].trim() }),
      el('span', { class: 'kv-val kv-quiet', text: isSkipped(s)
        ? 'skipped (' + fmtDateShort(s.date) + ')'
        : fmtDateShort(s.date) + ' → ' + fmtDateShort(sessionDate(s)) })
    ]));
  });
  wrap.appendChild(rows);

  var reset = el('button', { class: 'btn btn-block', type: 'button', text: 'Reset to the original plan' });
  reset.addEventListener('click', function () {
    if (!confirm('Put all ' + n + ' moved sessions back where the plan had them?\n\nLogged sets are not affected.')) return;
    resetSchedule();
    renderProgress();
    toast('Schedule reset.');
  });
  wrap.appendChild(reset);

  return wrap;
}

/* --- Progress: baselines --- */
/* Recalibrate appends a dated row. It never edits an old one: the history
   is precisely what lets a session from six weeks ago still resolve to the
   load it was actually done at. */

function recalibrationCheckpoints() {
  return plan.checkpoints.filter(function (c) {
    return /RECALIBRATE/i.test(c.label) || /retest pull-up 5RM/i.test(c.detail || '');
  });
}

/* Due when the date has arrived and nothing has been calibrated since. */
function dueRecalibrations() {
  var today = todayISO();
  return recalibrationCheckpoints().filter(function (c) {
    if (c.date > today) return false;
    return !baselines.some(function (b) { return b.date >= c.date; });
  });
}

function renderProgress() {
  var nodes = [];
  var current = latestBaselines();

  if (exportOverdue()) {
    var since = daysSinceExport();
    nodes.push(el('div', { class: 'callout callout-due' }, [
      el('strong', { text: 'Back this up' }),
      document.createTextNode(since === null
        ? 'Nothing has ever been exported. If Android clears this app\'s storage, everything logged so far is gone.'
        : 'Last exported ' + since + ' days ago. If Android clears this app\'s storage, anything since then is gone.')
    ]));
  }

  dueRecalibrations().forEach(function (c) {
    nodes.push(el('div', { class: 'callout callout-due' }, [
      el('strong', { text: 'Recalibration due · ' + c.label + ' · ' + fmtDateShort(c.date) }),
      document.createTextNode(c.detail)
    ]));
  });

  if (!current) {
    nodes.push(el('div', { class: 'stub' }, [
      el('h2', { text: 'No baselines yet' }),
      el('p', { text: 'Every weighted load in the plan is a percentage of these five numbers. Until they are set, loads show as “set baselines”.' })
    ]));
    nodes.push(el('button', { class: 'btn btn-go btn-block', type: 'button', id: 'btn-recal', text: 'Set baselines' }));
  } else {
    nodes.push(el('p', { class: 'section-label', text: 'Current baselines · ' + fmtDate(current.date) }));
    nodes.push(baselineTable(current));
    nodes.push(el('button', { class: 'btn btn-go btn-block', type: 'button', id: 'btn-recal', text: 'Recalibrate' }));
    nodes.push(el('p', { class: 'hint', text: 'Recalibrating adds a new dated row. Earlier sessions keep resolving against the numbers that were current when you did them.' }));
    nodes.push(loadPreview(current));
  }

  if (baselines.length > 1) {
    nodes.push(el('p', { class: 'section-label', text: 'History' }));
    baselines.slice().reverse().forEach(function (b) {
      nodes.push(baselineHistoryRow(b));
    });
  }

  nodes.push(scheduleSection());
  nodes.push(installSection());
  nodes.push(chartsSection());
  nodes.push(backupSection());
  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));

  setView('Progress', baselines.length ? baselines.length + (baselines.length === 1 ? ' entry' : ' entries') : '', nodes);

  var btn = document.getElementById('btn-recal');
  if (btn) btn.addEventListener('click', function () { openBaselineSheet(); });

  window.scrollTo(0, 0);
}

function baselineTable(b) {
  var table = el('div', { class: 'kv' });
  plan.baselineFields.forEach(function (f) {
    var v = b[f.key];
    var shown = (v === undefined || v === null || v === '')
      ? '—'
      : (f.unit ? v + ' ' + f.unit : String(v));
    table.appendChild(el('div', { class: 'kv-row' }, [
      el('span', { class: 'kv-key', text: f.label }),
      el('span', { class: 'kv-val', text: shown })
    ]));
  });
  return table;
}

/* The whole conversion table, resolved. This is the thing you would
   otherwise be working out on a gym floor. Resolved against this entry's
   own date so it previews the row being shown, not an older one. */
function loadPreview(b) {
  var rules = { pct5RM: {}, pctBW: {} };

  plan.sessions.forEach(function (s) {
    s.exercises.forEach(function (ex) {
      var t = ex.load && ex.load.type;
      if (t !== 'pct5RM' && t !== 'pctBW') return;
      rules[t][ex.load.value] = true;
    });
  });

  function table(type, label) {
    var values = Object.keys(rules[type]).map(Number).sort(function (a, c) { return a - c; });
    if (!values.length) return null;

    var box = el('div', { class: 'kv kv-preview' });
    values.forEach(function (v) {
      box.appendChild(el('div', { class: 'kv-row' }, [
        el('span', { class: 'kv-key', text: pct(v) + '%' }),
        el('span', { class: 'kv-val', text: resolveLoad({ type: type, value: v }, b.date).text })
      ]));
    });

    return el('div', {}, [el('p', { class: 'section-label', text: label }), box]);
  }

  return el('div', {}, [
    table('pct5RM', 'Pull-up loads · % of 5RM added'),
    table('pctBW', 'Bodyweight loads · % of BW')
  ].filter(Boolean));
}

function baselineHistoryRow(b) {
  var bits = [];
  if (b.bodyweightKg !== undefined) bits.push(b.bodyweightKg + ' kg BW');
  if (b.pullup5RMAddedKg !== undefined) bits.push('+' + b.pullup5RMAddedKg + ' kg 5RM');
  if (b.maxCleanDips !== undefined) bits.push(b.maxCleanDips + ' dips');
  if (b.maxSLHeelRaises !== undefined) bits.push(b.maxSLHeelRaises + ' heel raises');
  if (b.nordicBreakPoint) bits.push(b.nordicBreakPoint);

  var row = el('div', { class: 'card hist' }, [
    el('div', { class: 'card-top' }, [
      el('span', { class: 'card-title', text: fmtDate(b.date) }),
      el('button', { class: 'linkbtn', type: 'button', text: 'Remove' })
    ]),
    el('div', { class: 'card-sub', text: bits.join(' · ') || '—' })
  ]);

  row.querySelector('.linkbtn').addEventListener('click', function () {
    if (!confirm('Remove the baselines from ' + fmtDate(b.date) + '?\n\nLoads for sessions on or after that date will fall back to the previous entry.')) return;
    baselines = baselines.filter(function (x) { return x !== b; });
    saveBaselines();
    renderProgress();
  });

  return row;
}

/* --- the recalibrate sheet --- */

function openBaselineSheet() {
  var prev = latestBaselines();
  var inputs = {};

  var dateIn = el('input', { type: 'date', id: 'f-date' });
  dateIn.value = todayISO();

  var form = el('form', { class: 'sheet' }, [
    el('h3', { text: prev ? 'Recalibrate' : 'Set baselines' }),
    el('p', { class: 'sheet-sub', text: prev ? 'A new dated row. The previous one stays exactly as it is.' : 'The five numbers every load keys off.' }),
    field('Date', dateIn)
  ]);

  plan.baselineFields.forEach(function (f) {
    var input;
    if (f.type === 'select') {
      input = el('select', { id: 'f-' + f.key }, [el('option', { value: '', text: '—' })].concat(
        f.options.map(function (o) { return el('option', { value: o, text: o }); })
      ));
    } else {
      input = el('input', { type: 'text', inputmode: 'decimal', id: 'f-' + f.key });
    }
    if (prev && prev[f.key] !== undefined && prev[f.key] !== null) input.value = prev[f.key];
    inputs[f.key] = input;
    form.appendChild(field(f.label + (f.unit ? ' (' + f.unit + ')' : ''), input));
  });

  form.appendChild(el('div', { class: 'sheet-actions' }, [
    el('button', { type: 'button', class: 'btn btn-quiet', id: 'sheet-cancel', text: 'Cancel' }),
    el('button', { type: 'submit', class: 'btn btn-go', text: 'Save' })
  ]));

  var backdrop = el('div', { class: 'sheet-backdrop' }, [form]);

  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  form.querySelector('#sheet-cancel').addEventListener('click', close);

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var date = String(dateIn.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a date.'); return; }

    var entry = { date: date };
    plan.baselineFields.forEach(function (f) {
      var raw = String(inputs[f.key].value || '').trim();
      if (raw === '') return;
      entry[f.key] = f.type === 'select' ? raw : num(raw, 0, 100000);
    });

    if (usableNumber(entry.bodyweightKg) === null) { toast('Bodyweight is needed — the heel raise and pogo loads key off it.'); return; }
    if (entry.pullup5RMAddedKg === undefined) { toast('Pull-up 5RM added load is needed — every pull-up load keys off it.'); return; }

    /* Same day = correcting what you just entered, not rewriting history. */
    baselines = baselines.filter(function (b) { return b.date !== date; });
    baselines.push(entry);
    sortBaselines();
    saveBaselines();

    close();
    renderProgress();
    toast('Baselines saved. Loads recalculated from ' + fmtDateShort(date) + '.');
  });

  document.body.appendChild(backdrop);
}

/* --- placeholders for the tabs that arrive in later milestones --- */

function renderStub(title, milestone, lines) {
  var body = [el('h2', { text: title })];
  lines.forEach(function (l) { body.push(el('p', { text: l })); });
  body.push(el('span', { class: 'ms', text: 'Milestone ' + milestone }));

  var nodes = [el('div', { class: 'stub' }, body)];

  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));
  setView(title, '', nodes);
  window.scrollTo(0, 0);
}

function renderNotFound(msg) {
  setView('Not found', '', [
    el('p', { class: 'empty', text: msg }),
    el('p', { class: 'stub' }, [el('a', { class: 'back', href: '#/plan', text: '‹ Back to the plan' })])
  ]);
}

function renderError(msg) {
  setView('Problem', '', [
    el('p', { class: 'empty', text: msg }),
    el('p', { class: 'buildline', text: 'Build ' + BUILD })
  ]);
}

/* --------------------------------------------------------- areas, on screen */
/* Read-only for now: the week grid and each area's ladder. Nothing here
   changes how you train — sessions still come from the plan. */

var areaLoad = 'loading';                    /* loading | ready | failed */
var areasView = { week: null, day: null };   /* the week and day the tab is showing */

var STATE_TEXT = { full: 'done', partial: 'partial', none: 'not trained', future: 'not yet' };

/* One glyph per state. Shape carries the meaning, colour only reinforces it. */
function stateGlyph(state) {
  var svg = svgEl('svg', { class: 'g', viewBox: '0 0 20 20', 'aria-hidden': 'true' });
  if (state === 'full') {
    svg.appendChild(svgEl('circle', { class: 'g-done', cx: 10, cy: 10, r: 7.5 }));
  } else if (state === 'partial') {
    svg.appendChild(svgEl('circle', { class: 'g-ring', cx: 10, cy: 10, r: 7.5 }));
    svg.appendChild(svgEl('path', { class: 'g-part', d: 'M10 2.5 A7.5 7.5 0 0 0 10 17.5 Z' }));
  } else if (state === 'none') {
    svg.appendChild(svgEl('circle', { class: 'g-dot', cx: 10, cy: 10, r: 1.9 }));
  }
  return svg;
}

function statusTag(status) {
  return status.label ? el('span', { class: 'st st-' + status.key, text: status.label }) : null;
}

function areasLoading() {
  setView('Areas', '', [el('p', { class: 'empty', text: areaLoad === 'failed'
    ? 'Could not load the areas. Connect once so they can be cached, then they work offline.'
    : 'Loading areas…' })]);
}

/* Re-draw in place, keeping the scroll — a tap on a day should not jump the page. */
function repaintAreas() {
  var y = window.scrollY;
  renderAreas();
  window.scrollTo(0, y);
}

/* Areas down the side, Monday to Sunday across. Tap a day to see it. */
function weekGrid(start, today, days) {
  var grid = el('div', { class: 'wk-grid', role: 'grid', 'aria-label': 'Areas by day' });
  var LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function pickDay(date) { areasView.day = date; repaintAreas(); }

  grid.appendChild(el('div'));
  LETTER.forEach(function (letter, i) {
    var date = addDays(start, i);
    var b = el('button', {
      class: 'wk-day' + (date === today ? ' is-today' : '') + (date === areasView.day ? ' is-sel' : ''),
      type: 'button',
      'aria-label': fmtDateShort(date) + (date === today ? ', today' : '')
    }, [letter, el('b', { text: String(Number(date.slice(8, 10))) })]);
    b.addEventListener('click', function () { pickDay(date); });
    grid.appendChild(b);
  });

  areaList().forEach(function (area) {
    var w = areaWeek(area, start, today, days);
    grid.appendChild(el('div', { class: 'wk-lab' }, [
      el('div', { class: 'n', text: area.short }),
      el('div', { class: 's', text: currentStage(area).id + ' · ' + w.touched + '/' + w.target }),
      statusTag(w.status)
    ]));

    w.cells.forEach(function (c) {
      var cell = el('button', {
        class: 'wk-cell' + (c.isToday ? ' is-today' : '') + (c.state === 'future' ? ' is-future' : '')
          + (c.date === areasView.day ? ' is-sel' : ''),
        type: 'button',
        'aria-label': area.name + ', ' + fmtDateShort(c.date) + ': ' + STATE_TEXT[c.state]
      }, [c.state === 'future' ? null : stateGlyph(c.state)]);
      cell.addEventListener('click', function () { pickDay(c.date); });
      grid.appendChild(cell);
    });
  });

  return grid;
}

function weekLegend() {
  var wrap = el('div', { class: 'wk-legend' });
  [['full', 'Done'], ['partial', 'Partial'], ['none', 'Not trained']].forEach(function (p) {
    wrap.appendChild(el('span', {}, [stateGlyph(p[0]), p[1]]));
  });
  return wrap;
}

function dayDetail(date, today, days) {
  var recs = days.filter(function (r) { return r.date === date; });
  var card = el('div', { class: 'card' }, [
    el('div', { class: 'card-top' }, [
      el('span', { class: 'card-title', text: fmtDate(date) }),
      el('div', { class: 'badges' }, [date === today ? badge('Today', 'badge-now') : null])
    ])
  ]);

  if (!recs.length) {
    card.appendChild(el('div', { class: 'card-sub', text: date > today ? 'Nothing yet.' : 'Nothing logged for any area.' }));
    return card;
  }

  recs.forEach(function (r) {
    var area = areaById(r.area);
    card.appendChild(el('div', { class: 'wk-item' }, [
      stateGlyph(r.full ? 'full' : 'partial'),
      el('span', { text: area ? area.name : r.area }),
      el('span', { class: 'wk-note', text: r.done + ' of ' + r.total + ' sets' + (r.full ? '' : ' · partial') })
    ]));
  });
  return card;
}

function weekCard(start, today, days) {
  var current = weekStartOf(today);
  var first = firstWeekStart(days);
  var end = addDays(start, 6);

  var prev = el('button', { class: 'wk-nav', type: 'button', 'aria-label': 'Previous week', text: '‹', disabled: start <= first });
  var next = el('button', { class: 'wk-nav', type: 'button', 'aria-label': 'Next week', text: '›', disabled: start >= current });
  prev.addEventListener('click', function () { areasView.week = addDays(start, -7); areasView.day = null; repaintAreas(); });
  next.addEventListener('click', function () { areasView.week = addDays(start, 7); areasView.day = null; repaintAreas(); });

  var full = 0, partial = 0;
  areaList().forEach(function (a) {
    areaWeek(a, start, today, days).cells.forEach(function (c) {
      if (c.state === 'full') full++;
      else if (c.state === 'partial') partial++;
    });
  });

  return el('div', { class: 'card wk-card' }, [
    el('div', { class: 'wk-head' }, [
      prev,
      el('div', { class: 'wk-title' }, [
        el('span', { class: 'card-title', text: fmtDateShort(start) + ' – ' + fmtDateShort(end) }),
        el('span', { class: 'card-sub', text: start === current ? 'This week' : 'Week of ' + fmtDateShort(start) })
      ]),
      next
    ]),
    weekGrid(start, today, days),
    weekLegend(),
    el('p', { class: 'wk-sum', text: 'Done ' + full + ' · Partial ' + partial })
  ]);
}

/* The ladder as a row of stage chips, with where you are marked. */
function ladderRow(area, here) {
  return el('div', { class: 'ladder', 'aria-label': area.name + ' stages' }, area.stages.map(function (s) {
    return el('span', {
      class: 'rung' + (s.id === here ? ' is-here' : '') + (s.goal ? ' is-goal' : '') + (s.optional ? ' is-optional' : ''),
      title: s.id + ' ' + s.name,
      text: s.id
    });
  }));
}

function areaCard(area, days) {
  var prog = stageProgress(area, days);
  return el('a', { class: 'card', href: '#/areas/' + area.id }, [
    el('div', { class: 'card-top' }, [
      el('span', { class: 'card-title', text: area.name }),
      el('span', { class: 'chev', text: '›' })
    ]),
    el('div', { class: 'card-sub', text: area.goal }),
    ladderRow(area, prog.stage.id),
    el('div', { class: 'card-sub', text: 'Stage ' + prog.stage.id + ' · ' + prog.stage.name + ' · '
      + prog.full + ' of ' + prog.askAfter + ' full days' })
  ]);
}

function renderAreas() {
  if (!areaData) return areasLoading();

  var today = todayISO();
  var days = areaDays();
  var current = weekStartOf(today);
  var first = firstWeekStart(days);

  var start = areasView.week || current;
  if (start > current) start = current;
  if (start < first) start = first;
  areasView.week = start;

  var end = addDays(start, 6);
  if (!areasView.day || areasView.day < start || areasView.day > end) {
    areasView.day = (today >= start && today <= end) ? today : start;
  }

  var nodes = [
    weekCard(start, today, days),
    dayDetail(areasView.day, today, days),
    el('p', { class: 'section-label', text: 'Areas' })
  ];
  areaList().forEach(function (a) { nodes.push(areaCard(a, days)); });

  nodes.push(el('p', { class: 'hint', text: 'History from before the areas (weighted pull-ups, sprints, hinge, kettlebell press and a few prehab exercises) is kept but not counted here. Skipped days arrive with the daily menu.' }));
  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));

  setView('Areas', areaList().length + ' areas', nodes);
}

/* Which stage of an area, by position — for "you are at P1, this needs P4". */
function stageIndex(area, stageId) {
  for (var i = 0; i < area.stages.length; i++) {
    if (area.stages[i].id === stageId) return i;
  }
  return -1;
}

function stageCard(area, stage, prog) {
  var here = stage.id === prog.stage.id;
  var per = stageWeek(area, stage);
  var card = el('div', { class: 'card' + (here ? ' is-now' : '') }, [
    el('div', { class: 'card-top' }, [
      el('span', { class: 'card-title', text: stage.id + ' · ' + stage.name }),
      el('div', { class: 'badges' }, [
        here ? badge('You are here', 'badge-now') : null,
        stage.goal ? badge('Goal', 'badge-test') : null,
        stage.milestone ? badge('Milestone') : null,
        stage.optional ? badge('Optional') : null
      ])
    ]),
    el('div', { class: 'card-sub', text: stage.work })
  ]);

  if (stage.ready.length) {
    card.appendChild(el('div', { class: 'stage-ready' }, [
      el('strong', { text: 'Ready when' }),
      el('ul', {}, stage.ready.map(function (r) { return el('li', { text: r }); }))
    ]));
  }
  if (stage.note) card.appendChild(el('div', { class: 'card-sub', text: stage.note }));

  var facts = [];
  if (stage.askAfter) facts.push('Review after ' + stage.askAfter + ' full days' + (here ? ' · ' + prog.full + ' so far' : ''));
  if (stage.bells) facts.push('Bell: ' + stage.bells.map(function (b) { return b.lb + ' lb · ' + b.kg + ' kg'; }).join(' and '));
  if (stage.maxContacts) facts.push('Up to ' + stage.maxContacts + ' foot contacts');
  if (stage.perWeek || stage.minGapDays) {
    facts.push('This stage runs ' + per.min + ' · ' + per.target + ' · ' + per.max + ' days a week, '
      + stageGap(area, stage) + ' days apart');
  }
  facts.forEach(function (f) { card.appendChild(el('div', { class: 'stage-fact', text: f })); });

  (stage.requires || []).forEach(function (r) {
    var other = areaById(r.area);
    if (!other) return;
    var at = currentStage(other);
    var met = stageIndex(other, at.id) >= stageIndex(other, r.stage);
    card.appendChild(el('div', { class: 'stage-fact' + (met ? '' : ' is-unmet'), text:
      'Advisory: ' + other.name + ' ' + r.stage + ' first — you are at ' + at.id + (met ? ', met' : ', not yet') }));
  });

  return card;
}

function ruleLines(area) {
  var out = [];
  var rules = areaData.rules;
  function name(id) { var a = areaById(id); return a ? a.name : id; }

  rules.conflicts.forEach(function (c) {
    if (c.areas.indexOf(area.id) < 0) return;
    var other = name(c.areas[0] === area.id ? c.areas[1] : c.areas[0]);
    out.push((c.soft ? 'Avoid the same day as ' : 'Never the same day as ') + other + ' — ' + c.why + '.');
  });
  rules.budgets.forEach(function (b) {
    if (b.areas.indexOf(area.id) < 0) return;
    out.push('Shares a weekly cap of ' + b.maxPerWeek + ' days with ' + b.areas.filter(function (x) { return x !== area.id; }).map(name).join(', ') + ' — ' + b.why + '.');
  });
  return out;
}

function renderAreaDetail(id) {
  if (!areaData) return areasLoading();
  var area = areaById(id);
  if (!area) return renderNotFound('No area "' + id + '".');

  var today = todayISO();
  var days = areaDays();
  var start = weekStartOf(today);
  var w = areaWeek(area, start, today, days);
  var prog = stageProgress(area, days);
  var recent = recentWeekCounts(area, start, 3, days, firstWeekStart(days));

  var nodes = [
    el('a', { class: 'back', href: '#/areas', text: '‹ Areas' }),
    el('div', { class: 'session-head' }, [
      el('h2', { text: area.name }),
      el('div', { class: 'meta', text: area.goal })
    ])
  ];

  var rows = [
    ['This week', w.touched + ' of ' + w.target + (w.status.label ? ' · ' + w.status.label : '')],
    ['Last 3 weeks', recent.map(function (n) { return n === null ? '–' : n; }).join('  ')],
    ['Days a week', w.min + ' · ' + w.target + ' · ' + w.max + '  (min · target · max)'],
    ['Days apart', 'at least ' + w.gap],
    ['A session takes', 'about ' + area.minutes + ' min'],
    ['Load', area.load],
    ['Guarded by', area.guardedBy.map(bodyLabel).join(', ')]
  ];
  if (area.perWeek.nominalTarget) rows.splice(3, 0, ['Nominal target', area.perWeek.nominalTarget + ' days, trimmed to fit your time']);

  var kv = el('div', { class: 'kv kv-text' });
  rows.forEach(function (r) {
    kv.appendChild(el('div', { class: 'kv-row' }, [
      el('span', { class: 'kv-key', text: r[0] }),
      el('span', { class: 'kv-val', text: r[1] })
    ]));
  });
  nodes.push(el('p', { class: 'section-label', text: 'How it runs' }), kv);

  (area.tests || []).forEach(function (t) {
    nodes.push(el('p', { class: 'hint', text: t.name + ' — baseline in ' + t.baselineStage + ', retested every ' + t.retestEveryWeeks + ' weeks. ' + t.note }));
  });

  var rules = ruleLines(area);
  if (rules.length) {
    nodes.push(el('p', { class: 'section-label', text: 'Rules' }));
    rules.forEach(function (line) { nodes.push(el('p', { class: 'hint', text: line })); });
  }

  nodes.push(el('p', { class: 'section-label', text: 'Ladder' }));
  nodes.push(ladderRow(area, prog.stage.id));
  area.stages.forEach(function (s) { nodes.push(stageCard(area, s, prog)); });

  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));
  setView(area.short, 'Stage ' + prog.stage.id, nodes);
  window.scrollTo(0, 0);
}

/* ----------------------------------------------------------------- router */

function route() {
  if (!plan) return;

  var hash = location.hash.replace(/^#\/?/, '');
  var parts = hash.split('/').filter(Boolean);
  var tab = parts[0] || 'today';

  /* The runner owns the whole screen; leaving it is a route change. */
  if (tab !== 'run' && runner) leaveRunner();

  if (tab === 'run') {
    enterRunner(parts[1], Number(parts[2] || 0));
    markTab('today');
    return;
  }

  if (tab === 'plan' && parts[1]) renderWeek(parts[1]);
  else if (tab === 'plan') renderWeekList();
  else if (tab === 'areas' && parts[1]) renderAreaDetail(parts[1]);
  else if (tab === 'areas') renderAreas();
  else if (tab === 'session') renderSession(parts[1]);
  else if (tab === 'today') renderToday();
  else if (tab === 'checkin') renderCheckIn();
  else if (tab === 'progress') renderProgress();
  else {
    renderNotFound('Nothing at "' + hash + '".');
  }

  markTab(tab === 'session' ? 'plan' : tab);
  paintTabBadge();
  view().focus({ preventScroll: true });
}

/* A dot on the Progress tab when a backup is overdue — the nag has to be
   visible from the screens you actually use, not only from the one it is on. */
function paintTabBadge() {
  mark('progress', exportOverdue());
  /* Only nag for a check-in once there is a session behind you. */
  mark('checkin', hasLoggedASession() && checkInDueToday());

  function mark(tab, on) {
    var link = document.querySelector('.tabbar a[data-tab="' + tab + '"]');
    if (!link) return;
    if (on) link.setAttribute('data-badge', '1');
    else link.removeAttribute('data-badge');
  }
}

function markTab(tab) {
  var links = document.querySelectorAll('.tabbar a');
  for (var i = 0; i < links.length; i++) {
    if (links[i].getAttribute('data-tab') === tab) links[i].setAttribute('aria-current', 'page');
    else links[i].removeAttribute('aria-current');
  }
}

/* Keep the week list where you left it when you come back from a session. */
window.addEventListener('scroll', function () {
  if (location.hash === '#/plan' || location.hash === '') planScroll = window.scrollY;
}, { passive: true });

/* ------------------------------------------------------------------- boot */

function loadPlan() {
  return fetch(PLAN_URL, { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (json) {
      cachePlan(json);                 /* backup for a cold offline start */
      return json;
    })
    .catch(function (err) {
      console.warn('plan fetch failed, trying cache', err);
      var cached = lsGet(LS_PLAN);
      if (cached) return cached;
      throw err;
    });
}

/* The service worker caches plan.json too; this is the belt to its braces,
   for the first load before the worker has installed. Only rewrite when the
   plan actually changed — it is 130 kB and this runs on every launch. */
function cachePlan(json) {
  try {
    var next = JSON.stringify(json);
    if (localStorage.getItem(LS_PLAN) !== next) localStorage.setItem(LS_PLAN, next);
  } catch (err) {
    console.warn('plan cache write failed', err);
  }
}

var swError = null;

function registerSW() {
  if (!('serviceWorker' in navigator)) { swError = 'not supported by this browser'; return; }
  if (location.protocol === 'file:') { swError = 'opened as a local file — needs https'; return; }

  navigator.serviceWorker.register('sw.js').catch(function (err) {
    swError = String(err && err.message ? err.message : err);
    console.warn('service worker registration failed', err);
  });
}

/* Chrome fires this only when the site genuinely qualifies for installation.
   Holding on to it turns "Install" into a button we control, rather than
   hoping the user finds the right item in the browser menu. */
var installPrompt = null;

window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  installPrompt = e;
  if (location.hash === '#/progress') renderProgress();
});

window.addEventListener('appinstalled', function () {
  installPrompt = null;
  toast('Installed. Open it from your home screen from now on.');
});

function isInstalled() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || navigator.standalone === true;
}

/* Registered up front, not inside the plan fetch: if plan.json ever fails
   the app must still install and still work offline next time. */
registerSW();

/* The areas load alongside the plan and never hold it up: if they fail, Today
   and Plan still work and the Areas tab says so. */
loadAreaData().then(function (data) {
  areaData = data;
  areaLoad = 'ready';
}).catch(function () {
  areaLoad = 'failed';
}).then(function () {
  if (plan && /^#\/areas/.test(location.hash)) route();
});

loadPlan().then(function (json) {
  plan = json;
  loadLogs();
  loadBaselines();
  loadSettings();
  loadCheckIns();
  loadSchedule();
  loadDayPlans();
  loadFrozenDays();
  restoreTimer();
  scheduleReminder();
  if (!location.hash) location.replace('#/today');
  window.addEventListener('hashchange', route);
  route();
}).catch(function () {
  renderError('Could not load the plan. Connect once so it can be cached, then it works offline.');
});
