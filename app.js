/* The Integrated Plan — Milestones 1-8, complete; M9-M10 runner and rescheduling;
   M11 workout areas, M12 the daily menu, M13 the recommender, M14 stages and level-up, M15 weekly feedback
   Shell + PWA + plan browser + today's session with set logging
   + dated baselines and the load calculator + rest timer + JSON backup
   + morning check-in, the traffic light, HOLD gating and progression charts.
   Vanilla JS, no build step. */

'use strict';

var BUILD = '1.16.0-sound';
var PLAN_URL = 'data/plan.json';
var LS_PLAN = 'plan.cache.v1';
var LS_LOGS = 'setLogs';
var LS_BASELINES = 'baselines';
var LS_CHECKINS = 'checkIns';
var LS_SETTINGS = 'settings';
var LS_SCHEDULE = 'schedule';
var LS_DAYPLANS = 'dayPlans';      /* the menu of each day, so the week can say what was skipped */
var LS_AREADAYS = 'areaDays';      /* what each area-day contained, fixed when it was first planned */
var LS_PROGRESS = 'progress';      /* which stage each area is at, and since when */
var LS_DECISIONS = 'decisions';    /* every move up, step back and "not yet", with the day and the numbers */
var LS_CUSTOMAREAS = 'customAreas'; /* areas you added: things you track, and packs you imported */
var LS_WEEKFITS = 'weekFits';      /* each week's targets, fitted to your time and saved when the week is first looked at */

/* Everything the app owns, in one list. Export walks it, import restores it,
   and Milestone 5 gets checkIns backed up without touching this file. */
var COLLECTIONS = [LS_BASELINES, LS_LOGS, LS_CHECKINS, LS_SCHEDULE, LS_SETTINGS, LS_DAYPLANS, LS_AREADAYS, LS_WEEKFITS, LS_PROGRESS, LS_DECISIONS, LS_CUSTOMAREAS];

var EXPORT_NAG_DAYS = 7;
var LS_TIMER = 'restTimer';

var plan = null;
var planScroll = 0;     /* remember where the week list was scrolled to */

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

/* The body areas the check-in asks about. Once the area data is in, the rules say
   which (seven: elbow, shoulder, wrist, lower back, knee, hamstring, Achilles);
   until then, and if it never loads, the old plan's four. */
function areas() {
  if (areaData) {
    return areaData.rules.bodyAreas.filter(function (b) { return b.collected; }).map(function (b) { return b.id; });
  }
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

/* Weights are stored in kg, always. The switch only changes what is shown. */
var LB_PER_KG = 2.20462;

function usesLb() { return settings.units === 'lb'; }

/* A weight as you read it: "5 kg", or "11 lb" (to the nearest half pound). */
function fmtWeight(kg) {
  return usesLb() ? fmtKg(Math.round(kg * LB_PER_KG * 2) / 2) + ' lb' : fmtKg(kg) + ' kg';
}

/* The number for an input, in your unit; and back to kg for storage. */
function toDisplayWeight(kg) { return usesLb() ? Math.round(kg * LB_PER_KG * 2) / 2 : kg; }
function fromDisplayWeight(n) { return usesLb() ? Math.round(n / LB_PER_KG * 100) / 100 : n; }
function unitName() { return usesLb() ? 'lb' : 'kg'; }

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
      return { text: '+' + fmtWeight(fixed), kg: fixed, missing: false };
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
      return { text: '+' + fmtWeight(kg), kg: kg, missing: false };
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
    case 'fixedKg':    return '+' + fmtWeight(Number(load.value));
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

/* --- areas of your own ------------------------------------------------------------ */
/* Two ways to add to the eight: something you only want to track (a run, climbing,
   mobility), which has a target and a time but no ladder, and a whole ladder
   written as a pack (one JSON file). Either is checked before it is accepted, kept
   with your data, and joins the menu, the week grid and the verdicts like any other
   area. Nothing here knows an area by name. */

var customAreas = [];     /* as added: a track-only area carries `track: true` and no stages */

var PACK_AREA_KEYS = ['id', 'name', 'short', 'priority', 'goal', 'perWeek', 'minGapDays', 'minutes', 'load', 'order',
  'guardedBy', 'sessionTypes', 'tests', 'stages', 'track'];
var PACK_STAGE_KEYS = ['id', 'name', 'askAfter', 'optional', 'work', 'maxContacts', 'maxDepthContacts', 'goal',
  'milestone', 'ready', 'note', 'requires', 'bells', 'perWeek', 'minGapDays', 'draft', 'exercises', 'equipment', 'types'];
var PACK_TEST_KEYS = ['id', 'name', 'unit', 'baselineStage', 'retestEveryWeeks', 'note'];
var PACK_EXERCISE_KEYS = ['id', 'name', 'sets', 'reps', 'tempo', 'restSec', 'load', 'type', 'cue', 'note', 'contacts'];
var PACK_LOAD_TYPES = ['pct5RM', 'pctBW', 'fixedKg', 'bodyweight', 'text', 'none'];

function isWhole(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
function isText(s, min, max) { return typeof s === 'string' && s.trim().length >= min && s.length <= max; }

/* { min, target, max } in days: whole numbers, 1 <= min <= target <= max <= 7. */
function perWeekOk(per) {
  return !!per && typeof per === 'object' && isWhole(per.min) && isWhole(per.target) && isWhole(per.max)
    && per.min >= 1 && per.min <= per.target && per.target <= per.max && per.max <= 7;
}

function loadCustomAreas() {
  var stored = lsGet(LS_CUSTOMAREAS);
  customAreas = (Array.isArray(stored) ? stored : []).filter(function (a) { return a && typeof a === 'object' && !Array.isArray(a) && typeof a.id === 'string'; });
}

function saveCustomAreas() { return saveCollection(LS_CUSTOMAREAS, customAreas); }

/* A short name that fits a grid label. */
function shortNameOf(name) {
  var first = String(name || '').trim().split(/\s+/)[0] || '';
  return first.length > 13 ? first.slice(0, 13) : first;
}

function slugOf(name) {
  var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (/^[a-z]/.test(s) ? s : 'area-' + s).slice(0, 24).replace(/-+$/, '');
}

/* An area that is only tracked has one stage with one thing to do: do it. */
function trackStage(area) {
  return {
    id: 'T1', name: 'Tracked', work: 'Log it when you have done it.', ready: [],
    exercises: [{ id: 'done', name: area.name, sets: 1, reps: '1', restSec: 0, load: { type: 'none' }, cue: 'Mark it done when you have done it.' }],
    equipment: []
  };
}

/* Check one area, written by you or imported, against the same rules the built-in
   eight meet. Returns the problems in plain words, anything worth a second look
   (warnings), and the area ready to use. `taken` are ids that already exist. */
function validateAreaPack(input, opts) {
  opts = opts || {};
  var rules = opts.rules || (areaData && areaData.rules);
  var errors = [], warnings = [];
  var raw = input && typeof input === 'object' && !Array.isArray(input) && input.area && typeof input.area === 'object' ? input.area : input;

  function bad(msg) { errors.push(msg); }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['That is not an area: expected an object.'], warnings: [], area: null };

  Object.keys(raw).forEach(function (k) { if (PACK_AREA_KEYS.indexOf(k) < 0) bad('Unknown field "' + k + '".'); });

  var track = raw.track === true;
  var bodyIds = rules.bodyAreas.filter(function (b) { return b.collected; }).map(function (b) { return b.id; });

  if (typeof raw.id !== 'string' || !/^[a-z][a-z0-9-]{1,23}$/.test(raw.id)) bad('"id" must be 2 to 24 lowercase letters, digits or dashes, starting with a letter.');
  else if ((opts.taken || []).indexOf(raw.id) >= 0) bad('There is already an area with the id "' + raw.id + '".');
  if (!isText(raw.name, 2, 40) || !/[A-Za-z0-9]/.test(raw.name)) bad('"name" must be 2 to 40 characters, with at least one letter or digit.');
  if (raw.short !== undefined && !isText(raw.short, 1, 13)) bad('"short" must be 1 to 13 characters, so it fits a grid label.');
  if (raw.goal !== undefined && !isText(raw.goal, 1, 200)) bad('"goal" must be a sentence of up to 200 characters.');

  var per = raw.perWeek;
  if (!perWeekOk(per)) {
    bad('"perWeek" needs whole numbers with 1 <= min <= target <= max <= 7.');
  } else if (per.nominalTarget !== undefined && !(isWhole(per.nominalTarget) && per.nominalTarget >= per.target && per.nominalTarget <= 7)) {
    bad('"perWeek.nominalTarget" must be a whole number from the target up to 7.');
  }
  if (!isWhole(raw.minGapDays) || raw.minGapDays < 1 || raw.minGapDays > 7) bad('"minGapDays" must be a whole number from 1 to 7.');
  if (!isWhole(raw.minutes) || raw.minutes < 5 || raw.minutes > 180) bad('"minutes" must be a whole number from 5 to 180.');
  if (['low', 'medium', 'high'].indexOf(raw.load) < 0) bad('"load" must be low, medium or high.');
  if (rules.dayOrder.indexOf(raw.order) < 0) bad('"order" must be one of: ' + rules.dayOrder.join(', ') + '.');
  if (raw.priority !== undefined && !isWhole(raw.priority)) bad('"priority" must be a whole number.');
  if (raw.tests !== undefined && !Array.isArray(raw.tests)) bad('"tests" must be a list.');
  else if (track && (raw.tests || []).length) bad('A tracked area has no ladder, so no baseline tests.');

  if (raw.guardedBy !== undefined) {
    if (!Array.isArray(raw.guardedBy) || raw.guardedBy.some(function (b) { return bodyIds.indexOf(b) < 0; })) {
      bad('"guardedBy" must list body areas from: ' + bodyIds.join(', ') + '.');
    }
  }
  if (raw.sessionTypes !== undefined && (!Array.isArray(raw.sessionTypes) || raw.sessionTypes.some(function (s) { return typeof s !== 'string' || !s; }))) {
    bad('"sessionTypes" must be a list of names.');
  }

  /* the ladder */
  var stages = raw.stages;
  if (track) {
    if (stages !== undefined && !(Array.isArray(stages) && stages.length === 0)) bad('A tracked area has no stages.');
  } else if (!Array.isArray(stages) || !stages.length || stages.length > 12) {
    bad('"stages" must be a list of 1 to 12 stages.');
  } else {
    var seen = {}, goals = 0;
    stages.forEach(function (s, i) {
      var at = 'Stage ' + (s && s.id ? s.id : '#' + (i + 1)) + ': ';
      if (!s || typeof s !== 'object' || Array.isArray(s)) { bad(at + 'expected an object.'); return; }
      Object.keys(s).forEach(function (k) { if (PACK_STAGE_KEYS.indexOf(k) < 0) bad(at + 'unknown field "' + k + '".'); });
      if (typeof s.id !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,7}$/.test(s.id)) bad(at + '"id" must be up to 8 letters or digits, starting with a letter.');
      else if (seen[s.id]) bad(at + 'the id is used twice.');
      else seen[s.id] = true;
      if (!isText(s.name, 2, 40)) bad(at + '"name" must be 2 to 40 characters.');
      if (!isText(s.work, 3, 400)) bad(at + '"work" must say what the stage trains.');
      if (!Array.isArray(s.ready) || (!s.optional && !s.ready.length) || s.ready.some(function (r) { return !isText(r, 9, 160); })) {
        bad(at + '"ready" must list the standard(s) to attest to, each a clear sentence.');
      }
      if (s.askAfter !== undefined && (!isWhole(s.askAfter) || s.askAfter < 1)) bad(at + '"askAfter" must be a whole number of full days.');
      else if (s.askAfter !== undefined && per && isWhole(per.target) && s.askAfter < per.target) bad(at + '"askAfter" is under one week of the area (' + per.target + ' days).');
      if (s.goal) goals++;
      ['draft', 'goal', 'optional', 'milestone'].forEach(function (k) {
        if (s[k] !== undefined && typeof s[k] !== 'boolean') bad(at + '"' + k + '" must be true or false.');
      });
      if (s.perWeek !== undefined && !perWeekOk(s.perWeek)) bad(at + '"perWeek" needs whole numbers with 1 <= min <= target <= max <= 7.');
      if (s.minGapDays !== undefined && (!isWhole(s.minGapDays) || s.minGapDays < 1 || s.minGapDays > 7)) bad(at + '"minGapDays" must be a whole number from 1 to 7.');
      ['maxContacts', 'maxDepthContacts'].forEach(function (k) {
        if (s[k] !== undefined && (!isWhole(s[k]) || s[k] < 1 || s[k] > 500)) bad(at + '"' + k + '" must be a whole number from 1 to 500.');
      });
      if (s.note !== undefined && !isText(s.note, 1, 400)) bad(at + '"note" must be text of up to 400 characters.');
      if (s.types !== undefined && (!Array.isArray(s.types) || s.types.some(function (x) { return typeof x !== 'string' || !x; }))) bad(at + '"types" must be a list of names.');
      if (s.equipment !== undefined) {
        if (!Array.isArray(s.equipment)) bad(at + '"equipment" must be a list.');
        else s.equipment.forEach(function (q) {
          if (!rules.equipment.some(function (x) { return x.id === q; })) bad(at + 'unknown equipment "' + q + '". Known: ' + rules.equipment.map(function (x) { return x.id; }).join(', ') + '.');
        });
      }
      if (s.bells !== undefined && (!Array.isArray(s.bells) || s.bells.some(function (b) { return !b || typeof b.kg !== 'number' || typeof b.lb !== 'number'; }))) bad(at + '"bells" must list { "kg", "lb" } pairs.');
      if (s.requires !== undefined && !Array.isArray(s.requires)) bad(at + '"requires" must be a list of { "area", "stage" }.');
      else (s.requires || []).forEach(function (r) {
        if (!r || typeof r !== 'object' || typeof r.area !== 'string' || typeof r.stage !== 'string') { bad(at + 'each "requires" entry needs an "area" and a "stage".'); return; }
        var other = areaData && areaById(r.area);
        if (!other) warnings.push(at + 'asks for ' + r.area + ' first, which is not installed. It will show as not met.');
        else if (!stageById(other, r.stage)) bad(at + 'asks for ' + r.area + ' ' + r.stage + ', which does not exist.');
      });

      var ex = s.exercises;
      if (!Array.isArray(ex) || !ex.length) { bad(at + 'needs at least one exercise, so a level-up never lands on an empty stage.'); return; }
      var ids = {};
      ex.forEach(function (e, k) {
        var ea = at + 'exercise ' + (e && e.id ? '"' + e.id + '"' : '#' + (k + 1)) + ': ';
        if (!e || typeof e !== 'object' || Array.isArray(e)) { bad(ea + 'expected an object.'); return; }
        Object.keys(e).forEach(function (key) { if (PACK_EXERCISE_KEYS.indexOf(key) < 0) bad(ea + 'unknown field "' + key + '".'); });
        if (typeof e.id !== 'string' || !/^[a-z0-9-]+$/.test(e.id)) bad(ea + '"id" must be a lowercase slug.');
        else if (ids[e.id]) bad(ea + 'the id is used twice in this stage.');
        else ids[e.id] = true;
        if (!isText(e.name, 3, 60)) bad(ea + '"name" must be 3 to 60 characters.');
        if (!isWhole(e.sets) || e.sets < 1 || e.sets > 30) bad(ea + '"sets" must be a whole number from 1 to 30.');
        if (typeof e.reps !== 'string' || !e.reps) bad(ea + '"reps" must be text, such as "5" or "30 s".');
        if (!isWhole(e.restSec) || e.restSec < 0 || e.restSec > 900) bad(ea + '"restSec" must be a whole number of seconds from 0 to 900.');
        if (!e.load || PACK_LOAD_TYPES.indexOf(e.load.type) < 0) bad(ea + '"load.type" must be one of: ' + PACK_LOAD_TYPES.join(', ') + '.');
        if (e.type !== undefined && (raw.sessionTypes || []).indexOf(e.type) < 0) bad(ea + '"type" must be one of the area’s sessionTypes.');
      });
      if (ex.every(function (e) { return e && e.type; }) === false && ex.some(function (e) { return e && e.type; })) bad(at + 'either every exercise has a "type" or none does.');

      /* A rough clock, as a heads-up and nothing more. */
      var secs = function (r) { var m = String(r).match(/^(\d+)(?:\s*[–-]\s*\d+)?\s*(s|min)\b/); return m ? Number(m[1]) * (m[2] === 'min' ? 60 : 1) : 45; };
      var minutes = ex.reduce(function (n, e) { return n + (isWhole(e && e.sets) ? e.sets * (secs(e.reps) + (isWhole(e.restSec) ? e.restSec : 0)) : 0); }, 0) / 60;
      if (isWhole(raw.minutes) && !ex.some(function (e) { return e && e.type; }) && (minutes < raw.minutes * 0.4 || minutes > raw.minutes * 1.6)) {
        warnings.push(at + 'the exercises add up to about ' + Math.round(minutes) + ' min, against the ' + raw.minutes + ' you gave for the area.');
      }
    });
    if (goals > 1) bad('Only one stage can be the goal.');

    /* a retest is anchored to a stage, so it can only be checked once the stages are known */
    if (Array.isArray(raw.tests)) raw.tests.slice(0, 10).forEach(function (x, i) {
      var tt = 'Test ' + (x && x.id ? '"' + x.id + '"' : '#' + (i + 1)) + ': ';
      if (!x || typeof x !== 'object' || Array.isArray(x)) { bad(tt + 'expected an object.'); return; }
      Object.keys(x).forEach(function (k) { if (PACK_TEST_KEYS.indexOf(k) < 0) bad(tt + 'unknown field "' + k + '".'); });
      if (typeof x.id !== 'string' || !/^[a-z0-9-]+$/.test(x.id)) bad(tt + '"id" must be a lowercase slug.');
      if (!isText(x.name, 2, 60)) bad(tt + '"name" must be 2 to 60 characters.');
      if (x.unit !== undefined && !isText(x.unit, 1, 8)) bad(tt + '"unit" must be up to 8 characters, such as cm or reps.');
      if (typeof x.baselineStage !== 'string' || !seen[x.baselineStage]) bad(tt + '"baselineStage" must be the id of one of the stages.');
      if (!isWhole(x.retestEveryWeeks) || x.retestEveryWeeks < 1 || x.retestEveryWeeks > 52) bad(tt + '"retestEveryWeeks" must be a whole number from 1 to 52.');
      if (x.note !== undefined && !isText(x.note, 1, 300)) bad(tt + '"note" must be text of up to 300 characters.');
    });
    if (Array.isArray(raw.tests) && raw.tests.length > 10) bad('"tests" can list up to 10.');
  }

  if (errors.length) return { ok: false, errors: errors, warnings: warnings, area: null };

  var area = JSON.parse(JSON.stringify(raw));
  if (!area.short) area.short = shortNameOf(area.name);
  if (!area.goal) area.goal = track ? 'Do it ' + area.perWeek.target + ' days a week.' : area.name;
  area.guardedBy = area.guardedBy || [];
  area.sessionTypes = area.sessionTypes || [];
  area.tests = area.tests || [];
  return { ok: true, errors: [], warnings: warnings, area: area };
}

/* Put what you added alongside the eight, after them, in the order you added them
   (or the order a pack asks for). One that no longer passes is skipped, not lost. */
function mergeCustomAreas() {
  if (!areaData) return;
  var base = areaData.list.filter(function (a) { return !a.custom; });
  var top = base.reduce(function (n, a) { return Math.max(n, a.priority); }, 0);
  var taken = base.map(function (a) { return a.id; });
  var added = [];
  areaData.skipped = [];

  customAreas.forEach(function (raw, i) {
    var r = validateAreaPack(raw, { taken: taken, rules: areaData.rules });
    if (!r.ok) { areaData.skipped.push({ id: raw.id, errors: r.errors }); return; }
    var a = r.area;
    if (a.track) a.stages = [trackStage(a)];
    a.custom = true;
    a.asked = raw.priority === undefined ? 1000 + i : raw.priority;
    taken.push(a.id);
    added.push(a);
  });

  added.sort(function (x, y) { return x.asked - y.asked; });
  added.forEach(function (a, i) { a.priority = top + 1 + i; delete a.asked; });
  areaData.list = base.concat(added);
}

/* Add one (a tracked area, or a pack's area), if it passes. */
function addCustomArea(input) {
  if (!areaData) return { ok: false, errors: ['The areas have not loaded yet.'], warnings: [] };
  var taken = areaList().map(function (a) { return a.id; });
  var r = validateAreaPack(input, { taken: taken });
  if (!r.ok) return r;
  var stored = JSON.parse(JSON.stringify(r.area));
  delete stored.custom;
  customAreas.push(stored);
  saveCustomAreas();
  mergeCustomAreas();
  return { ok: true, errors: [], warnings: r.warnings, area: areaById(stored.id) };
}

/* Take one away. What was logged stays in your history; adding the same area back
   brings it with it. */
function removeCustomArea(id) {
  var before = customAreas.length;
  customAreas = customAreas.filter(function (a) { return a.id !== id; });
  if (customAreas.length === before) return false;
  saveCustomAreas();
  mergeCustomAreas();
  return true;
}

/* A new tracked area from the little form: name, days a week, minutes, what kind of
   work it is, and what it could hurt. */
function trackedAreaFrom(form) {
  var target = Number(form.perWeek);
  var minutes = Number(form.minutes);
  return {
    id: freeId(form.name), name: String(form.name || '').trim(), track: true,
    perWeek: { min: Math.max(1, target - 1), target: target, max: Math.min(7, target + 1) },
    minGapDays: target <= 3 ? 2 : 1, minutes: minutes,
    load: form.load || 'medium', order: form.order || 'strength', guardedBy: form.guardedBy || []
  };
}

/* The id for a name, kept clear of every id that exists. */
function freeId(name) {
  var base = slugOf(name) || 'area', id = base, n = 2;
  var taken = areaList().map(function (a) { return a.id; });
  while (taken.indexOf(id) >= 0) {
    var suffix = '-' + n++;                    /* cut the name, never the suffix, or a 24-letter id never changes */
    id = base.slice(0, 24 - suffix.length).replace(/-+$/, '') + suffix;
  }
  return id;
}

/* Monday = 0. Read from the calendar fields, never from a local Date. */
function isoDow(iso) {
  var d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
  return (d.getUTCDay() + 6) % 7;
}

function weekStartOf(iso) { return addDays(iso, -isoDow(iso)); }

/* A stage may override its area's weekly targets and spacing (Nordic does,
   in the banded stages, where lower load allows more often). */
function currentStage(area) {
  var p = progress[area.id];
  return (p && stageById(area, p.stage)) || area.stages[0];
}
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

var dayPlans = {};    /* date -> { sittings: [{ minutes, areas }], suggested: [id], removed: { id: reason }, why: { id: why it was suggested } } */
var frozenDays = {};  /* "date:area" -> { stage, type, deload } */
var progress = {};    /* area -> { stage, since, nextAsk }: where each area is on its ladder */
var decisions = [];   /* what you decided at each review, oldest first */

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
  var why = {};
  if (raw.why && typeof raw.why === 'object' && !Array.isArray(raw.why)) {
    Object.keys(raw.why).forEach(function (id) { if (typeof raw.why[id] === 'string' && raw.why[id]) why[id] = raw.why[id]; });
  }
  return { sittings: sittings, suggested: uniqueStrings(raw.suggested), removed: removed, why: why };
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
    if (f.deload === true) frozenDays[key].deload = true;
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
  if (areaDayPhase(area, date, areaDays()) === 'deload') f.deload = true;     /* the easy end of the stage */
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
  var deload = !!(f && f.deload);
  if (deload) exercises = exercises.map(function (e) { var c = Object.assign({}, e); c.sets = deloadSets(e.sets); return c; });

  return {
    id: areaDayId(date, areaId),
    areaId: areaId,
    date: date,
    week: null,                                  /* weeks here are Mon–Sun, not plan weeks */
    weekLabel: fmtDateShort(date),
    day: DAY_SHORT[isoDow(date)],
    name: area.name + ' · ' + stage.id + (type ? ' · ' + type : '') + (deload ? ' · deload' : ''),
    stageId: stage.id,
    type: type,
    deload: deload,
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

/* --- stages and level-up -------------------------------------------------- */
/* Each area is on one rung of its ladder. Full area-days are counted in the
   current stage only, from the day you moved there. Near the end of a stage the
   work eases off for a block (the deload), then the app asks whether you are
   ready. You always decide: it never moves you on its own. Moving up waits while
   a body area that guards the area is amber or red; "not yet" and stepping back
   never wait. Everything here is a plain function of progress, the logs and the
   area files. */

var DECISION_ACTIONS = ['up', 'stay', 'back', 'set'];

function cleanProgress(raw) {
  var out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(function (id) {
    var p = raw[id];
    if (!p || typeof p.stage !== 'string' || !p.stage) return;
    var na = p.nextAsk === null || p.nextAsk === undefined ? NaN : Number(p.nextAsk);
    out[id] = {
      stage: p.stage,
      since: typeof p.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.since) ? p.since : null,
      nextAsk: isFinite(na) && na >= 0 ? Math.round(na) : null
    };
  });
  return out;
}

function cleanDecisions(raw) {
  var out = [];
  (Array.isArray(raw) ? raw : []).forEach(function (d) {
    if (!d || typeof d.area !== 'string' || typeof d.to !== 'string' || DECISION_ACTIONS.indexOf(d.action) < 0) return;
    if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return;
    var full = Number(d.full);
    var e = { date: d.date, area: d.area, from: typeof d.from === 'string' ? d.from : d.to, to: d.to, action: d.action, full: isFinite(full) && full >= 0 ? Math.round(full) : 0 };
    if (typeof d.note === 'string' && d.note) e.note = d.note;
    out.push(e);
  });
  return out;
}

function loadProgress() { progress = cleanProgress(lsGet(LS_PROGRESS)); }
function loadDecisions() { decisions = cleanDecisions(lsGet(LS_DECISIONS)); }
function saveProgress() { return saveCollection(LS_PROGRESS, progress); }
function saveDecisions() { return saveCollection(LS_DECISIONS, decisions); }

/* Sets in an easy block: about 60% of the usual, never fewer than one. */
function deloadSets(sets) {
  var factor = areaData ? areaData.rules.defaults.deloadFactor : 0.6;
  return Math.max(1, Math.round((Number(sets) || 0) * factor));
}

/* A week's worth of days is the easy block at the end of a stage. */
function deloadDays(area, stage) { return stageWeek(area, stage).target; }

/* The stage an area was at on a date, replaying what you decided: before the first
   move it was where that move started from, and "not yet" changes nothing. An area
   that never moved is where it is now. */
function stageAtDate(area, date) {
  var moves = decisions.filter(function (d) { return d.area === area.id && d.action !== 'stay'; });
  if (!moves.length) return currentStage(area);
  var at = null;
  moves.forEach(function (d) { if (d.date <= date) at = d; });         /* oldest first, so the last one wins */
  return stageById(area, at ? at.to : moves[0].from) || currentStage(area);
}

/* The stage a day was done in: what it was fixed to when first planned, and the
   first stage for anything from the old plan. */
function stageOfDay(area, date) {
  var f = frozenDays[areaDayId(date, area.id)];
  return f ? f.stage : area.stages[0].id;
}

/* Full area-days in a stage, since the day you moved there. */
function stageFullDays(area, stage, days, beforeDate) {
  var since = (progress[area.id] || {}).since;
  return days.filter(function (r) {
    return r.area === area.id && r.full && (!beforeDate || r.date < beforeDate)
      && (!since || r.date >= since) && stageOfDay(area, r.date) === stage.id;
  }).length;
}

/* Where a stage is, from plain numbers:
     top     nothing above it, so nothing to ask
     build   the full prescription
     deload  the easy block before the review
     ask     ready for a review
   After "not yet" (nextAsk set) the stage stays at its top prescription, with no
   easy block, until that many full area-days. */
function stagePhase(stage, full, deload, nextAsk) {
  if (!stage.askAfter) return 'top';
  if (nextAsk !== null && nextAsk !== undefined) return full >= nextAsk ? 'ask' : 'build';
  if (full >= stage.askAfter) return 'ask';
  var easyFrom = Math.max(stage.askAfter - deload, Math.ceil(stage.askAfter / 2));
  return full >= easyFrom ? 'deload' : 'build';
}

function nextAskOf(area) {
  var p = progress[area.id];
  return p && p.nextAsk !== null && p.nextAsk !== undefined ? p.nextAsk : null;
}

/* The phase a new area-day on `date` falls in: judged by the full days before it. */
function areaDayPhase(area, date, days) {
  var stage = currentStage(area);
  return stagePhase(stage, stageFullDays(area, stage, days, date), deloadDays(area, stage), nextAskOf(area));
}

/* Where an area stands on its ladder. */
function stageProgress(area, days) {
  var stage = currentStage(area);
  var full = stageFullDays(area, stage, days);
  var deload = deloadDays(area, stage);
  var phase = stagePhase(stage, full, deload, nextAskOf(area));
  var index = stageIndex(area, stage.id);
  return {
    stage: stage, full: full, askAfter: stage.askAfter, deload: deload, phase: phase,
    nextAsk: nextAskOf(area), index: index, top: index === area.stages.length - 1, due: phase === 'ask'
  };
}

/* Why moving up has to wait, or null. Amber and red on a guarding body area. */
function levelUpBlock(area, date) {
  return heldReason(area, date) || holdReason(area, date);
}

/* The other areas a stage asks for first. Advisory: they are shown, never enforced. */
function prereqStatus(stage) {
  return (stage.requires || []).map(function (r) {
    var a = areaById(r.area);
    if (!a) return { area: r.area, stage: r.stage, name: r.area, have: null, met: false };
    var have = currentStage(a);
    return { area: r.area, stage: r.stage, name: a.name, have: have.id, met: stageIndex(a, have.id) >= stageIndex(a, r.stage) };
  });
}

/* --- equipment you own --- */

var DEFAULT_BELLS_LB = [15, 25];

function equipmentList() { return areaData ? areaData.rules.equipment : []; }

function equipmentOwned(id) {
  if (settings.equipment && typeof settings.equipment[id] === 'boolean') return settings.equipment[id];
  var q = equipmentList().filter(function (x) { return x.id === id; })[0];
  return !!(q && q.owned);
}

function setEquipment(id, owned) {
  settings.equipment = settings.equipment || {};
  settings.equipment[id] = !!owned;
  saveSettings();
}

function bellsOwned() {
  var b = settings.bellsLb;
  return Array.isArray(b) ? b.slice() : DEFAULT_BELLS_LB.slice();
}

function setBells(list) {
  var seen = {}, out = [];
  (Array.isArray(list) ? list : []).forEach(function (x) {
    var n = Math.round(Number(x));
    if (isFinite(n) && n > 0 && n <= 200 && !seen[n]) { seen[n] = true; out.push(n); }
  });
  settings.bellsLb = out.sort(function (a, b) { return a - b; });
  saveSettings();
}

/* What a stage needs, and what of that you have. */
function stageNeeds(stage) {
  var equipment = (stage.equipment || []).map(function (id) {
    var q = equipmentList().filter(function (x) { return x.id === id; })[0];
    return { id: id, label: q ? q.label : id, owned: equipmentOwned(id) };
  });
  var have = bellsOwned();
  var bells = (stage.bells || []).map(function (b) { return { kg: b.kg, lb: b.lb, owned: have.indexOf(b.lb) >= 0 }; });
  var missing = equipment.filter(function (x) { return !x.owned; }).map(function (x) { return x.label; })
    .concat(bells.filter(function (b) { return !b.owned; }).map(function (b) { return 'a ' + b.lb + ' lb (' + b.kg + ' kg) bell'; }));
  return { equipment: equipment, bells: bells, missing: missing };
}

/* --- deciding --- */

/* Enter a stage: the full-day count starts again from today. */
function enterStage(area, stage, action, date, full) {
  var from = currentStage(area).id;
  progress[area.id] = { stage: stage.id, since: date, nextAsk: null };
  decisions.push({ date: date, area: area.id, from: from, to: stage.id, action: action, full: full });
  saveProgress(); saveDecisions();

  /* A stage can change how often the area is done (Nordic does, N2 to N3). The
     week's saved fit knows only the old stage, so work it out again. */
  var start = weekStartOf(date);
  if (weekFits[start]) {
    delete weekFits[start];
    if (!ensureWeekFit(start, areaDays())) saveWeekFits();
  }
  refreshAreaDay(area.id, date);
  return { ok: true, stage: stage };
}

/* If today's menu has this area and nothing is done yet, plan it again at the
   stage you are now in. */
function refreshAreaDay(areaId, date) {
  var plan = dayPlans[date];
  if (!plan || plannedAreaIds(plan).indexOf(areaId) < 0) return;
  if (doneByAreaDay()[areaDayId(date, areaId)]) return;
  delete frozenDays[areaDayId(date, areaId)];
  freezeAreaDay(date, areaId);
}

function moveUp(areaId, days, date) {
  var area = areaById(areaId);
  if (!area) return { ok: false, why: 'No such area.' };
  var stage = currentStage(area), next = area.stages[stageIndex(area, stage.id) + 1];
  if (!next) return { ok: false, why: 'This is the top of the ladder.' };
  var block = levelUpBlock(area, date);
  if (block) return { ok: false, why: 'Waiting: ' + block + '.' };
  if (!next.exercises || !next.exercises.length) return { ok: false, why: next.id + ' has nothing written yet.' };
  return enterStage(area, next, 'up', date, stageFullDays(area, stage, days));
}

/* Not yet: stay at the top prescription, and ask again after a few more days. */
function notYet(areaId, days, date) {
  var area = areaById(areaId);
  if (!area) return { ok: false, why: 'No such area.' };
  var stage = currentStage(area), full = stageFullDays(area, stage, days);
  var every = areaData.rules.defaults.repeatEvery;
  var p = progress[area.id] || { stage: stage.id, since: null };
  p.nextAsk = full + every;
  progress[area.id] = p;
  decisions.push({ date: date, area: area.id, from: stage.id, to: stage.id, action: 'stay', full: full });
  saveProgress(); saveDecisions();
  return { ok: true, nextAsk: p.nextAsk };
}

function stepBack(areaId, days, date) {
  var area = areaById(areaId);
  if (!area) return { ok: false, why: 'No such area.' };
  var stage = currentStage(area), prev = area.stages[stageIndex(area, stage.id) - 1];
  if (!prev) return { ok: false, why: 'This is the first stage.' };
  return enterStage(area, prev, 'back', date, stageFullDays(area, stage, days));
}

/* Set the stage yourself: where you start, or somewhere other than the next rung. */
function placeAt(areaId, stageId, days, date) {
  var area = areaById(areaId);
  var stage = area && stageById(area, stageId);
  if (!stage) return { ok: false, why: 'No such stage.' };
  if (stage.id === currentStage(area).id) return { ok: false, why: 'Already at ' + stage.id + '.' };
  if (!stage.exercises || !stage.exercises.length) return { ok: false, why: stage.id + ' has nothing written yet.' };
  return enterStage(area, stage, 'set', date, stageFullDays(area, currentStage(area), days));
}

/* --- the daily menu ----------------------------------------------------- */
/* A day has one to three sittings, each with its own minutes and its own list
   of areas. The menu is saved the first time the day is shown, so the week can
   later say what was planned and what never happened. Everything that decides
   something is a plain function of the plan, the logs and the rules. */

function plannedAreaIds(plan) {
  var out = [];
  plan.sittings.forEach(function (st) {
    st.areas.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
  });
  return out;
}

/* The order to do things in, from the rules: power, skill, strength, mobility,
   kettlebell, then your priority. */
function doOrder(areaIds) {
  var order = areaData.rules.dayOrder;
  return areaIds.slice().sort(function (a, b) {
    var A = areaById(a), B = areaById(b);
    return (order.indexOf(A.order) - order.indexOf(B.order)) || (A.priority - B.priority);
  });
}

/* Most recent day before `date` this area was trained, or null. */
function lastTrainedBefore(areaId, date, days) {
  var last = null;
  days.forEach(function (r) { if (r.area === areaId && r.date < date && (!last || r.date > last)) last = r.date; });
  return last;
}

function agoText(n) {
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
}

/* Why this area is where it is on the list. */
function areaReason(area, date, days, week) {
  var last = lastTrainedBefore(area.id, date, days);
  var text = week.touched + '/' + week.target + ' this week, '
    + (last ? daysBetween(last, date) + ' d since last' : 'not trained yet');
  return text;
}

/* Held means a guarding body area is red. It is the one thing the menu will not
   let you override: the red protocol is not advice. */
function heldReason(area, date) {
  var red = redGuards(area, date);
  return red.length ? bodyLabel(red[0]).toLowerCase() + ' red' : null;
}

/* Things worth knowing before you add an area. They warn; they never block. */
function menuWarnings(area, date, plan, days) {
  var out = [];
  var wk = areaWeek(area, weekStartOf(date), date, days);
  var rules = areaData.rules;
  var last = lastTrainedBefore(area.id, date, days);
  var today = days.some(function (r) { return r.area === area.id && r.date === date; });

  if (today) out.push('Already trained today. This adds to the same day.');
  else if (wk.touched >= wk.max) out.push('Already at its weekly max of ' + wk.max + '.');
  if (last && daysBetween(last, date) < wk.gap) {
    out.push('Trained ' + agoText(daysBetween(last, date)) + '. It usually wants ' + wk.gap + '+ days between.');
  }

  /* Everything on today's menu, plus anything already done today. */
  var onToday = plannedAreaIds(plan).concat(days.filter(function (r) { return r.date === date; }).map(function (r) { return r.area; }));
  rules.conflicts.forEach(function (c) {
    if (c.areas.indexOf(area.id) < 0) return;
    var other = c.areas[0] === area.id ? c.areas[1] : c.areas[0];
    if (onToday.indexOf(other) < 0) return;
    out.push((c.soft ? 'Best not the same day as ' : 'Not usually with ') + areaById(other).name + ': ' + c.why + '.');
  });

  rules.budgets.forEach(function (b) {
    if (b.areas.indexOf(area.id) < 0) return;
    var used = 0, start = weekStartOf(date);
    b.areas.forEach(function (id) { used += areaWeek(areaById(id), start, date, days).touched; });
    if (used >= b.maxPerWeek) out.push('This week\'s ' + b.why + ' cap is used: ' + used + ' of ' + b.maxPerWeek + ' days.');
  });
  return out;
}

/* --- the recommender ------------------------------------------------------ */
/* Which areas to do today. A pure function of what it is handed (the areas with
   their week so far, the rules, the minutes), so it can be tested without the
   app, and it explains itself: every area gets a line saying why it is on the
   menu or why it is not. No learning, so you can always see why.

   1. Rule out what cannot be done: held by a red body area, taken off or already
      on the menu, at its weekly max, too soon after the last time, or its shared
      weekly budget used up. An area that has hit its target is not recommended
      either, though it can still be added.
   2. Value what is left. Highest when its weekly minimum is about to become
      impossible, then when the spacing to its target is tight, then how long it
      has been, all weighted by your priority order.
   3. Take the best combination that fits: the highest total value that packs
      into the day's sittings, within the area and high-load limits and with no
      conflicting pair. A soft conflict is allowed when one of the two would
      otherwise miss its week. A day has few areas, so this is a handful of
      subsets, not a search.

   input = { date, slots: [minutes], areas: [{ id, name, priority, minutes, load,
             per: {min, target, max}, gap, days: [dates logged], held, hold, excluded }],
             conflicts, budgets, limits: {maxAreas, maxHigh}, weights, already: [ids] }
   `already` are areas planned or done in an earlier sitting today: they use up
   room under the limits and count in conflicts, but are not minutes to fill. */
function recommendDay(input) {
  var date = input.date, slots = input.slots, W = input.weights, L = input.limits;
  var total = slots.reduce(function (n, x) { return n + x; }, 0);
  var start = weekStartOf(date);
  var daysLeft = 7 - isoDow(date);                      /* counting today */
  var byId = {}, lines = {}, pool = [], wkOf = {};

  input.areas.forEach(function (a) { byId[a.id] = a; });
  var already = (input.already || []).filter(function (id) { return byId[id]; });
  var maxPri = input.areas.reduce(function (n, a) { return Math.max(n, a.priority); }, 0);

  function areaName(id) { return byId[id] ? byId[id].name : id; }

  input.areas.forEach(function (a) {
    wkOf[a.id] = a.days.filter(function (d) { return d >= start && d <= date; }).length;
  });

  function conflictBetween(x, y) {
    return input.conflicts.filter(function (c) { return c.areas.indexOf(x) >= 0 && c.areas.indexOf(y) >= 0 && x !== y; })[0];
  }
  function other(c, id) { return c.areas[0] === id ? c.areas[1] : c.areas[0]; }

  input.areas.forEach(function (a) {
    var wk = wkOf[a.id], per = a.per;
    var last = null;
    a.days.forEach(function (d) { if (d <= date && (!last || d > last)) last = d; });
    var ago = last ? daysBetween(last, date) : null;
    var line = lines[a.id] = { picked: false, kind: '', why: '', hold: a.hold || null };

    function out(kind, why) { line.kind = kind; line.why = why; }

    if (a.held) return out('held', 'Held: ' + a.held + '.');
    if (a.excluded) return out('excluded', a.excluded);
    if (wk >= per.max) return out('max', 'At its weekly max of ' + per.max + '.');
    if (last && ago < a.gap) {
      return out('soon', ago === 0 ? 'Already trained today.'
        : 'Too soon: trained ' + agoText(ago) + ', wants ' + a.gap + '+ days between.');
    }
    if (already.indexOf(a.id) >= 0) return out('excluded', 'Already on today\u2019s menu.');
    var capped = input.budgets.filter(function (b) {
      if (b.areas.indexOf(a.id) < 0) return false;
      var used = b.areas.reduce(function (n, id) { return n + (wkOf[id] || 0); }, 0);
      line.budgetUsed = used;
      return used >= b.maxPerWeek;
    })[0];
    if (capped) return out('budget', 'This week’s ' + capped.why + ' cap is used: ' + line.budgetUsed + ' of ' + capped.maxPerWeek + ' days.');

    var need = per.target - wk;
    if (need <= 0) return out('met', 'Target met this week (' + wk + '/' + per.target + '). You can still add it.');

    var needMin = Math.max(0, per.min - wk);
    var span = (need - 1) * a.gap + 1;
    var spanMin = needMin > 0 ? (needMin - 1) * a.gap + 1 : 0;
    var c = {
      area: a, id: a.id, need: need,
      pressure: need * a.gap / daysLeft,
      stale: last ? ago / (7 / per.target) : 9,
      must: span >= daysLeft,
      mustMin: needMin > 0 && spanMin >= daysLeft
    };
    c.urgent = c.must || c.mustMin;
    c.value = (1 + (maxPri + 1 - a.priority) * W.priorityStep) *
      (W.mustMinWeight * c.mustMin + W.mustWeight * c.must + W.pressureWeight * c.pressure + W.staleWeight * Math.min(c.stale, W.staleCap));
    pool.push(c);
  });

  /* The most urgent first, so the cap on the pool keeps the ones that matter. */
  pool.sort(function (x, y) {
    return (y.mustMin - x.mustMin) || (y.must - x.must) || (y.value - x.value) || (x.area.priority - y.area.priority);
  });
  pool = pool.slice(0, W.maxPool);

  function clashOf(c, others) {
    for (var i = 0; i < others.length; i++) {
      var k = conflictBetween(c.id, others[i].id || others[i]);
      if (k) return { k: k, with: others[i].id || others[i], soft: !!k.soft };
    }
    return null;
  }

  /* Can these sit in the sittings? Biggest first, trying each sitting in turn. */
  function pack(ids) {
    var left = slots.slice(), out = slots.map(function () { return []; });
    var order = ids.slice().sort(function (x, y) { return byId[y].minutes - byId[x].minutes; });
    function go(i) {
      if (i === order.length) return true;
      for (var k = 0; k < left.length; k++) {
        if (left[k] >= byId[order[i]].minutes) {
          left[k] -= byId[order[i]].minutes; out[k].push(order[i]);
          if (go(i + 1)) return true;
          left[k] += byId[order[i]].minutes; out[k].pop();
        }
      }
      return false;
    }
    return go(0) ? out : null;
  }

  var baseHigh = already.filter(function (id) { return byId[id].load === 'high'; }).length;
  var best = null;

  for (var m = 1; m < (1 << pool.length); m++) {
    var set = [], mins = 0, high = baseHigh, v = 0, fits = true;
    for (var b = 0; b < pool.length && fits; b++) {
      if (!(m & (1 << b))) continue;
      var c2 = pool[b];
      set.push(c2); mins += c2.area.minutes; v += c2.value;
      if (c2.area.load === 'high') high++;
      if (already.length + set.length > L.maxAreas || mins > total || high > L.maxHigh) fits = false;
    }
    if (!fits) continue;

    for (var i = 0; i < set.length && fits; i++) {
      var hit = clashOf(set[i], already);
      if (hit && !(hit.soft && set[i].urgent)) fits = false;
      for (var j = i + 1; j < set.length && fits; j++) {
        var k2 = conflictBetween(set[i].id, set[j].id);
        if (k2 && !(k2.soft && (set[i].urgent || set[j].urgent))) fits = false;
      }
    }
    if (!fits) continue;
    if (slots.length > 1 && !pack(set.map(function (x) { return x.id; }))) continue;
    if (!best || v > best.v + 1e-9 || (Math.abs(v - best.v) < 1e-9 && mins < best.mins)) best = { set: set, v: v, mins: mins };
  }

  var picked = [], used = 0;
  if (best) {
    best.set.sort(function (x, y) { return x.area.priority - y.area.priority; });
    picked = best.set.map(function (c) { return c.id; });
    used = best.mins;
  }
  var pickedAndAlready = picked.concat(already);

  best && best.set.forEach(function (c) {
    var line = lines[c.id];
    line.picked = true;
    line.kind = c.mustMin ? 'minimum' : c.must ? 'target' : 'fit';
    line.why = c.mustMin ? 'Needs today to keep its minimum for the week.'
      : c.must ? 'Needs today to reach its target for the week.'
      : 'Still needs ' + c.need + ' more this week.';
    var shared = clashOf(c, pickedAndAlready.filter(function (id) { return id !== c.id; }));
    if (shared) line.why += ' Shares the day with ' + areaName(shared.with) + ' (' + shared.k.why + ').';
  });

  /* The ones that were wanted but did not make it, and why. */
  pool.forEach(function (c) {
    if (lines[c.id].picked) return;
    var line = lines[c.id];
    var hard = clashOf(c, pickedAndAlready);
    var high = pickedAndAlready.filter(function (id) { return byId[id].load === 'high'; }).length;
    var left = total - used;

    if (hard && !(hard.soft && c.urgent)) {
      line.kind = 'conflict';
      line.why = 'Not with ' + areaName(hard.with) + ': ' + hard.k.why + '.';
    } else if (c.area.load === 'high' && high >= L.maxHigh) {
      line.kind = 'limit';
      line.why = 'Already ' + L.maxHigh + ' high-load areas today.';
    } else if (pickedAndAlready.length >= L.maxAreas) {
      line.kind = 'limit';
      line.why = 'Already ' + L.maxAreas + ' areas today.';
    } else {
      line.kind = 'time';
      line.why = 'Needs about ' + c.area.minutes + ' min; ' + (left > 0 ? left + ' left today.' : 'today has no room.');
    }
  });

  return {
    picked: picked,
    sittings: slots.length > 1 && picked.length ? (pack(picked) || slots.map(function () { return []; })) : [picked],
    minutes: used,
    lines: lines,
    skipped: input.areas.filter(function (a) { return !lines[a.id].picked; })
      .map(function (a) { return { area: a.id, why: lines[a.id].why }; })
  };
}

/* The body areas that are amber for an area, from the last week of check-ins.
   Amber keeps the area on the menu but holds the load where it is. Red is the
   hard stop and is handled by heldReason. */
function holdReason(area, date) {
  var recent = checkInsBetween(addDays(date, -(RED_DAYS - 1)), date);
  var amber = area.guardedBy.filter(function (b) {
    return recent.some(function (c) { return areaState(b, c, priorTo(c.date)) === 'amber'; });
  });
  return amber.length ? bodyLabel(amber[0]).toLowerCase() + ' amber' : null;
}

/* The app's state, handed over as plain data. */
function recommendInput(date, slots, days, opts) {
  var start = weekStartOf(date);
  ensureWeekFit(start, days);

  var plan = opts && opts.fresh ? null : dayPlans[date];      /* fresh: ask as if the menu were empty */
  var onMenu = plan ? plannedAreaIds(plan) : [];

  /* What is already taking up room today: what is on the menu, and what was done.
     An area that a check-in has since turned red cannot be trained, so it takes up
     no room unless sets were actually logged. */
  var doneToday = days.filter(function (r) { return r.date === date; }).map(function (r) { return r.area; });
  var already = onMenu.filter(function (id) {
    var a = areaById(id);
    return doneToday.indexOf(id) >= 0 || !(a && heldReason(a, date));
  });
  doneToday.forEach(function (id) { if (already.indexOf(id) < 0) already.push(id); });

  var rules = areaData.rules;
  return {
    date: date, slots: slots, already: already,
    areas: areaList().map(function (a) {
      var w = areaWeek(a, start, date, days);
      var excluded = null;
      if (plan && onMenu.indexOf(a.id) >= 0) excluded = 'Already on today’s menu.';
      else if (plan && a.id in plan.removed) excluded = 'Taken off today’s menu' + (plan.removed[a.id] ? ' (' + plan.removed[a.id] + ')' : '') + '.';
      return {
        id: a.id, name: a.name, priority: a.priority, minutes: a.minutes, load: a.load,
        per: { min: w.min, target: w.target, max: w.max }, gap: w.gap,
        days: days.filter(function (r) { return r.area === a.id; }).map(function (r) { return r.date; }),
        held: heldReason(a, date), hold: holdReason(a, date), excluded: excluded
      };
    }),
    conflicts: rules.conflicts, budgets: rules.budgets,
    limits: { maxAreas: rules.defaults.maxAreas, maxHigh: rules.defaults.maxHigh },
    weights: rules.recommender
  };
}

/* Today's recommendation in the order to do things, sitting by sitting. */
function recommendFor(date, slots, days, opts) {
  var out = recommendDay(recommendInput(date, slots, days, opts));
  out.picked = doOrder(out.picked);
  out.sittings = out.sittings.map(doOrder);
  return out;
}

/* Which areas to start the day with. */
function suggestAreas(date, minutes, days) {
  return recommendFor(date, [minutes], days).picked;
}

/* The reason each pick was made, kept with the menu so it still reads the same
   once the day has moved on. */
function whyOf(rec, ids) {
  var out = {};
  ids.forEach(function (id) { if (rec.lines[id] && rec.lines[id].why) out[id] = rec.lines[id].why; });
  return out;
}

/* The menu is made the first time the day is shown. */
function ensureDayPlan(date, days) {
  if (dayPlans[date]) return dayPlans[date];

  var minutes = defaultMinutes(date);
  var rec = recommendFor(date, [minutes], days);
  var picks = rec.picked;
  dayPlans[date] = { sittings: [{ minutes: minutes, areas: picks.slice() }], suggested: picks.slice(), removed: {}, why: whyOf(rec, picks) };
  picks.forEach(function (id) { freezeAreaDay(date, id); });

  if (!settings.menuSince) { settings.menuSince = date; saveSettings(); }
  saveDayPlans();
  return dayPlans[date];
}

/* A new sitting is a new question: what is still worth doing, given what is on
   the menu and what is already done today? Fills an empty sitting from that. */
function fillSitting(date, sittingIdx, days) {
  var plan = dayPlans[date], st = plan && plan.sittings[sittingIdx];
  if (!st || st.areas.length) return [];

  var rec = recommendFor(date, [st.minutes], days);
  st.areas = rec.picked.slice();
  plan.why = plan.why || {};
  rec.picked.forEach(function (id) {
    freezeAreaDay(date, id);
    if (plan.suggested.indexOf(id) < 0) plan.suggested.push(id);
    if (rec.lines[id].why) plan.why[id] = rec.lines[id].why;
  });
  saveDayPlans();
  return rec.picked;
}

/* Changing the time on a day nobody has touched is a new question too. Only when
   the menu is exactly what was suggested (one sitting, nothing added, nothing
   taken off, nothing started); otherwise it is yours and is left alone. */
function resuggest(date, days) {
  var plan = dayPlans[date];
  if (!plan || plan.sittings.length !== 1 || Object.keys(plan.removed).length) return false;

  var now = plan.sittings[0].areas;
  if (now.slice().sort().join() !== plan.suggested.slice().sort().join()) return false;
  var done = doneByAreaDay();
  if (now.some(function (id) { return done[areaDayId(date, id)]; })) return false;

  var rec = recommendFor(date, [plan.sittings[0].minutes], days, { fresh: true });
  now.forEach(function (id) { if (rec.picked.indexOf(id) < 0) unfreezeAreaDay(date, id); });
  rec.picked.forEach(function (id) { freezeAreaDay(date, id); });
  plan.sittings[0].areas = rec.picked.slice();
  plan.suggested = rec.picked.slice();
  plan.why = whyOf(rec, rec.picked);
  saveDayPlans();
  return true;
}

function addAreaToDay(date, sittingIdx, areaId) {
  var plan = dayPlans[date], area = areaById(areaId);
  if (!plan || !plan.sittings[sittingIdx] || !area) return { ok: false, why: 'No such sitting.' };

  var held = heldReason(area, date);
  if (held) return { ok: false, why: area.name + ' is held: ' + held + '.' };

  var sitting = plan.sittings[sittingIdx];
  if (sitting.areas.indexOf(areaId) >= 0) return { ok: true };

  sitting.areas = doOrder(sitting.areas.concat([areaId]));
  delete plan.removed[areaId];
  freezeAreaDay(date, areaId);
  saveDayPlans();
  return { ok: true };
}

/* Taking an area off. If the app had suggested it, that is a skip and is
   remembered (with your reason, if you gave one); if you had added it yourself
   it just goes. Once sets are logged it cannot be taken off. */
function removeAreaFromDay(date, sittingIdx, areaId, reason) {
  var plan = dayPlans[date];
  if (!plan || !plan.sittings[sittingIdx]) return { ok: false, why: 'No such sitting.' };

  var sitting = plan.sittings[sittingIdx];
  var at = sitting.areas.indexOf(areaId);
  if (at < 0) return { ok: true };

  var elsewhere = plan.sittings.some(function (st, i) { return i !== sittingIdx && st.areas.indexOf(areaId) >= 0; });
  if (!elsewhere && doneByAreaDay()[areaDayId(date, areaId)]) {
    return { ok: false, why: 'Already started, so it stays on the day.' };
  }

  sitting.areas.splice(at, 1);
  if (!elsewhere) {
    if (plan.suggested.indexOf(areaId) >= 0) plan.removed[areaId] = reason || '';
    unfreezeAreaDay(date, areaId);
  }
  saveDayPlans();
  return { ok: true };
}

function addSitting(date, minutes) {
  var plan = dayPlans[date];
  if (!plan || plan.sittings.length >= MAX_SITTINGS) return -1;
  plan.sittings.push({ minutes: minutes || 30, areas: [] });
  saveDayPlans();
  return plan.sittings.length - 1;
}

function removeSitting(date, sittingIdx) {
  var plan = dayPlans[date];
  if (!plan || plan.sittings.length < 2 || !plan.sittings[sittingIdx] || plan.sittings[sittingIdx].areas.length) return false;
  plan.sittings.splice(sittingIdx, 1);
  saveDayPlans();
  return true;
}

function setSittingMinutes(date, sittingIdx, minutes) {
  var plan = dayPlans[date];
  if (!plan || !plan.sittings[sittingIdx] || !(minutes > 0)) return;
  plan.sittings[sittingIdx].minutes = minutes;
  if (sittingIdx === 0) rememberMinutes(date, minutes);
  saveDayPlans();
}

/* The time chip on Today: remembers it, and asks again what fits if the day is
   still exactly as it was suggested. */
function changeSittingMinutes(date, sittingIdx, minutes, days) {
  setSittingMinutes(date, sittingIdx, minutes);
  return sittingIdx === 0 ? resuggest(date, days) : false;
}

/* Minutes planned in a sitting against the minutes it has. */
function sittingLoad(sitting) {
  var planned = 0;
  sitting.areas.forEach(function (id) { var a = areaById(id); if (a) planned += a.minutes; });
  return { planned: planned, over: Math.max(0, planned - sitting.minutes) };
}

/* Mark every set of an area's block done for a date, for something you did
   without the app. Held areas are refused like anywhere else. */
function logAreaBlock(date, areaId) {
  var area = areaById(areaId);
  if (!area) return { ok: false, why: 'No such area.' };
  var held = heldReason(area, date);
  if (held) return { ok: false, why: area.name + ' is held: ' + held + '.' };
  if (!freezeAreaDay(date, areaId)) return { ok: false, why: 'There is nothing to log for ' + area.name + ' yet.' };

  var session = areaDaySession(date, areaId);
  session.exercises.forEach(function (ex) {
    for (var i = 0; i < (Number(ex.sets) || 0); i++) {
      var e = getLog(session.id, ex.id, i);
      if (!e || !e.done) writeLog(session.id, ex.id, i, { done: true });
    }
  });
  return { ok: true };
}

/* Where to start in an area-day: the first exercise that still has sets to do. */
function firstOpenExercise(session) {
  var list = runnableIndexes(session);
  for (var i = 0; i < list.length; i++) {
    var ex = session.exercises[list[i]];
    if (firstUndoneSet(session, ex) < (Number(ex.sets) || 0)) return list[i];
  }
  return list.length ? list[0] : 0;
}

/* After one area-day in the runner: the next one on the same sitting that still
   has sets to do, so a sitting runs as one go. */
function nextAreaDay(session) {
  var plan = session && session.areaId ? dayPlans[session.date] : null;
  if (!plan) return null;

  for (var i = 0; i < plan.sittings.length; i++) {
    var ids = plan.sittings[i].areas;
    var at = ids.indexOf(session.areaId);
    if (at < 0) continue;
    for (var j = at + 1; j < ids.length; j++) {
      var next = areaDaySession(session.date, ids[j]);
      if (next && !areaPaused(next) && doneSets(next) < totalSets(next)) return next;
    }
    return null;
  }
  return null;
}

/* What the menu shows for one sitting: every area, most urgent first. */
var URGENCY = { due: 0, behind: 1, risk: 2, track: 3, done: 4, held: 5, ahead: 6 };

function menuRows(date, sittingIdx, days) {
  var plan = dayPlans[date];
  var start = weekStartOf(date);

  /* What the recommender would add to this sitting, in the minutes it has left. */
  var sitting = plan.sittings[sittingIdx];
  var rec = recommendFor(date, [Math.max(0, sitting.minutes - sittingLoad(sitting).planned)], days);

  return areaList().map(function (area) {
    var week = areaWeek(area, start, date, days);
    var trained = days.filter(function (r) { return r.area === area.id && r.date === date; })[0] || null;
    var inThis = plan.sittings[sittingIdx].areas.indexOf(area.id) >= 0;
    var elsewhere = plan.sittings.some(function (st, i) { return i !== sittingIdx && st.areas.indexOf(area.id) >= 0; });
    return {
      area: area, week: week, record: trained,
      selected: inThis, elsewhere: elsewhere,
      held: heldReason(area, date),
      hold: holdReason(area, date),
      reason: areaReason(area, date, days, week),
      advice: rec.lines[area.id],
      recommended: !inThis && !!rec.lines[area.id].picked,
      warnings: inThis ? [] : menuWarnings(area, date, plan, days)
    };
  }).sort(function (a, b) {
    return (b.selected - a.selected) || (b.recommended - a.recommended)
      || (URGENCY[a.week.status.key] - URGENCY[b.week.status.key]) || (a.area.priority - b.area.priority);
  });
}

/* How a cell of the week reads, in one word. Shapes in the grid are drawn from this.
     full / partial   something logged
     skipped          planned (or taken off the menu by you) and nothing logged
     planned          on today's menu, not done yet
     noplan           a day since menus began that was never opened, so unknown
     none / future    nothing to say */
function dayCellState(date, areaId, today, rec) {
  if (rec) return rec.full ? 'full' : 'partial';
  if (date > today) return 'future';

  var plan = dayPlans[date];
  if (plan) {
    var removed = areaId in plan.removed;
    if (plannedAreaIds(plan).indexOf(areaId) >= 0 && !removed) return date === today ? 'planned' : 'skipped';
    if (removed) return 'skipped';
    return 'none';
  }
  return settings.menuSince && date >= settings.menuSince && date < today ? 'noplan' : 'none';
}

/* The week in numbers, and what was skipped. */
function weekSummary(start, today, days) {
  var out = { done: 0, partial: 0, skipped: 0, planned: 0, skippedItems: [] };
  areaList().forEach(function (a) {
    areaWeek(a, start, today, days).cells.forEach(function (c) {
      if (c.state === 'full') out.done++;
      else if (c.state === 'partial') out.partial++;
      else if (c.state === 'planned') out.planned++;
      else if (c.state === 'skipped') {
        out.skipped++;
        var plan = dayPlans[c.date];
        out.skippedItems.push({ area: a, date: c.date, reason: plan && plan.removed[a.id] || '' });
      }
    });
  });
  out.skippedItems.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : a.area.priority - b.area.priority;
  });
  return out;
}

/* A day, sitting by sitting, for the detail panel. Anything logged that was not
   on the menu comes last, as "added". */
function dayDetailItems(date, today, days) {
  var plan = dayPlans[date];
  var recs = days.filter(function (r) { return r.date === date; });
  var out = { noPlan: !plan, sittings: [], extras: [] };
  var listed = {};

  if (plan) {
    plan.sittings.forEach(function (st, i) {
      out.sittings.push({
        index: i, minutes: st.minutes,
        items: st.areas.map(function (id) {
          listed[id] = true;
          var rec = recs.filter(function (r) { return r.area === id; })[0] || null;
          return { area: areaById(id), state: dayCellState(date, id, today, rec), record: rec, reason: '' };
        })
      });
    });
    Object.keys(plan.removed).forEach(function (id) {
      if (listed[id]) return;
      listed[id] = true;
      var rec = recs.filter(function (r) { return r.area === id; })[0] || null;
      out.extras.push({ area: areaById(id), state: dayCellState(date, id, today, rec), record: rec, reason: plan.removed[id], removed: true });
    });
  }
  recs.forEach(function (r) {
    if (listed[r.area]) return;
    out.extras.push({ area: areaById(r.area), state: r.full ? 'full' : 'partial', record: r, reason: '' });
  });
  return out;
}

/* (where an area stands on its ladder: see the stage engine, above the daily menu) */

/* --- the week's time budget ----------------------------------------------- */
/* Each area asks for a number of days a week. Whether they all fit depends on the
   minutes you actually have, so each week the targets are fitted to that time:
   from the lowest priority up, a target gives up one day at a time, never below
   its minimum, until the week's cost fits the minutes. A new area runs at its
   minimum for its first weeks. The fit is saved the first time the week is looked
   at, so a week is judged against what it was planned as, not against what you
   later said about your time. */

var weekFits = {};    /* week start -> { budget, cost, minCost, startCost, verdict, targets, trimmed, ramp } */

function cleanWeekFit(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  var n = function (v) { v = Number(v); return isFinite(v) && v >= 0 ? v : null; };

  var out = { budget: n(raw.budget), cost: n(raw.cost), minCost: n(raw.minCost), startCost: n(raw.startCost), targets: {}, trimmed: [], ramp: uniqueStrings(raw.ramp) };
  if (out.budget === null || out.cost === null || out.minCost === null) return null;
  out.noTime = n(raw.noTime) || 0;
  out.stated = n(raw.stated) !== null ? n(raw.stated) : out.budget + out.noTime;
  if (out.startCost === null) out.startCost = out.cost;
  out.verdict = ['fits', 'tight', 'over'].indexOf(raw.verdict) >= 0 ? raw.verdict : 'fits';

  if (!raw.targets || typeof raw.targets !== 'object' || Array.isArray(raw.targets)) return null;
  Object.keys(raw.targets).forEach(function (id) {
    var t = n(raw.targets[id]);
    if (t !== null) out.targets[id] = Math.round(t);
  });
  (Array.isArray(raw.trimmed) ? raw.trimmed : []).forEach(function (t) {
    if (t && typeof t.id === 'string' && n(t.from) !== null && n(t.to) !== null) out.trimmed.push({ id: t.id, from: Math.round(t.from), to: Math.round(t.to) });
  });
  return out;
}

function loadWeekFits() {
  var stored = lsGet(LS_WEEKFITS);
  weekFits = {};
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
  Object.keys(stored).forEach(function (start) {
    var fit = /^\d{4}-\d{2}-\d{2}$/.test(start) ? cleanWeekFit(stored[start]) : null;
    if (fit) weekFits[start] = fit;
  });
}

function saveWeekFits() { return saveCollection(LS_WEEKFITS, weekFits); }

/* The minutes you have in the week starting `start`: your usual time on each day. */
function weekMinutes(start) {
  var total = 0;
  for (var i = 0; i < 7; i++) total += defaultMinutes(addDays(start, i));
  return total;
}

/* Which week an area was first trained in, or null if it never has been. */
function firstTouchWeek(areaId, days) {
  var first = null;
  days.forEach(function (r) { if (r.area === areaId && (!first || r.date < first)) first = r.date; });
  return first ? weekStartOf(first) : null;
}

/* The first weeks of an area run at its minimum. An area that has not been
   trained yet is in its first week. */
function inRamp(areaId, start, days) {
  var weeks = areaData.rules.defaults.rampWeeks;
  if (!(weeks > 0)) return false;
  var first = firstTouchWeek(areaId, days);
  if (!first || first >= start) return true;
  return daysBetween(first, start) / 7 < weeks;
}

/* The fit itself, from plain numbers.
     items   [{ id, priority, minutes, min, target, ramp }]  target is the nominal one
     budget  minutes in the week
   Everything is lowered from the lowest priority (the biggest number) up, one day
   at a time, and never below the minimum. */
function fitTargets(items, budget, tightRatio) {
  var targets = {}, start = {}, startCost = 0, cost = 0, minCost = 0;
  items.forEach(function (it) {
    start[it.id] = it.ramp ? it.min : it.target;
    targets[it.id] = start[it.id];
    cost += it.minutes * targets[it.id];
    minCost += it.minutes * it.min;
  });
  startCost = cost;

  var byPriority = items.slice().sort(function (a, b) { return b.priority - a.priority; });
  var guard = 0;
  while (cost > budget && guard++ < 1000) {
    var next = byPriority.filter(function (it) { return targets[it.id] > it.min; })[0];
    if (!next) break;
    targets[next.id]--;
    cost -= next.minutes;
  }

  var trimmed = items.filter(function (it) { return targets[it.id] < start[it.id]; })
    .sort(function (a, b) { return a.priority - b.priority; })
    .map(function (it) { return { id: it.id, from: start[it.id], to: targets[it.id] }; });

  var verdict = minCost > budget ? 'over' : (budget > 0 && minCost / budget >= tightRatio) ? 'tight' : 'fits';
  return {
    budget: budget, cost: cost, minCost: minCost, startCost: startCost, verdict: verdict,
    targets: targets, trimmed: trimmed,
    ramp: items.filter(function (it) { return it.ramp; }).map(function (it) { return it.id; })
  };
}

/* Things taken off the menu for "no time" say the minutes you gave were more than
   you had. Over the last few weeks, the minutes of what was taken off for that
   reason, on average a week, are cut from the week's time. A single time is not a
   pattern. */
function noTimeCut(start) {
  var N = areaData.rules.noTime;
  var from = addDays(start, -7 * N.weeks), skips = 0, minutes = 0;
  Object.keys(dayPlans).forEach(function (date) {
    if (date < from || date >= start) return;
    var removed = dayPlans[date].removed;
    Object.keys(removed).forEach(function (id) {
      var a = areaById(id);
      if (removed[id] === 'no time' && a) { skips++; minutes += a.minutes; }
    });
  });
  return skips >= N.minSkips ? Math.round(minutes / N.weeks) : 0;
}

function computeWeekFit(start, days) {
  var items = areaList().map(function (a) {
    var per = stageWeek(a, currentStage(a));
    return {
      id: a.id, priority: a.priority, minutes: a.minutes, min: per.min,
      target: Math.max(per.min, per.nominalTarget || per.target),
      ramp: inRamp(a.id, start, days)
    };
  });
  var stated = weekMinutes(start), cut = noTimeCut(start);
  var fit = fitTargets(items, Math.max(0, stated - cut), areaData.rules.defaults.tightRatio || 0.85);
  fit.stated = stated;
  fit.noTime = cut;
  return fit;
}

/* The fit for a week. A week already underway or finished uses what was saved;
   one that was never looked at while it was running has none, and is judged by
   the targets as authored. The coming week is worked out fresh. */
function weekFitFor(start, days, today) {
  if (weekFits[start]) return weekFits[start];
  return start >= weekStartOf(today) ? computeWeekFit(start, days) : null;
}

/* Save this week's fit the first time it is looked at while the week is running. */
function ensureWeekFit(start, days) {
  if (weekFits[start] || !areaData) return weekFits[start] || null;
  if (start !== weekStartOf(todayISO())) return null;
  weekFits[start] = computeWeekFit(start, days);
  saveWeekFits();
  return weekFits[start];
}

/* "Your minimums need 280 min a week; you have 330. Tight." */
function feasibilityLine(fit) {
  var tail = fit.verdict === 'over' ? 'That does not fit.' : fit.verdict === 'tight' ? 'Tight.' : 'Room to spare.';
  return 'Your minimums need ' + fit.minCost + ' min a week; you have ' + fit.budget + '. ' + tail;
}

/* What the fit changed, in words. Empty when nothing was trimmed. */
function trimmedLine(fit) {
  if (!fit.trimmed.length) return '';
  return 'Fitted to your time: ' + fit.trimmed.map(function (t) {
    var a = areaById(t.id);
    return (a ? a.name : t.id) + ' ' + t.from + '→' + t.to;
  }).join(', ') + '.';
}

/* When "no time" has been the reason lately, say how the week's minutes were worked out. */
function noTimeLine(fit) {
  if (!fit.noTime) return '';
  return 'You said ' + fit.stated + ' min, but things were taken off for no time lately, so this week plans for ' + fit.budget + '.';
}

function rampLine(fit) {
  if (!fit.ramp.length) return '';
  var names = fit.ramp.map(function (id) { var a = areaById(id); return a ? a.name : id; });
  return 'Ramp-in, minimum only for the first ' + areaData.rules.defaults.rampWeeks + ' weeks: ' + names.join(', ') + '.';
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
  /* A week that has finished is judged by the stage the area was in then, not the one
     it is in now: moving up must not change what an old week asked for. */
  var stage = end < today ? stageAtDate(area, start) : currentStage(area);
  var authored = stageWeek(area, stage);
  var gap = stageGap(area, stage);

  /* The target this week is the fitted one; min and max are the stage's own. */
  var fit = weekFitFor(start, days, today);
  var fitted = fit && area.id in fit.targets;
  var per = { min: authored.min, target: fitted ? Math.max(authored.min, fit.targets[area.id]) : authored.target, max: authored.max };

  var mine = days.filter(function (r) { return r.area === area.id; });
  var byDate = {};
  mine.forEach(function (r) { byDate[r.date] = r; });

  var cells = [], touched = 0, full = 0;
  for (var i = 0; i < 7; i++) {
    var date = addDays(start, i);
    var rec = byDate[date] || null;
    var state = dayCellState(date, area.id, today, rec);
    if (rec) { touched++; if (rec.full) full++; }
    cells.push({ date: date, state: state, isToday: date === today, record: rec });
  }

  return {
    area: area, start: start, end: end, cells: cells, touched: touched, full: full,
    min: per.min, target: per.target, max: per.max, gap: gap,
    nominal: authored.nominalTarget || authored.target, fitted: !!fitted,
    ramp: !!(fit && fit.ramp.indexOf(area.id) >= 0),
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

/* --- how an area is doing ---------------------------------------------------- */
/* Judged over the last few finished weeks, each against the target it was fitted
   to at the time (or as authored, for a week nobody looked at while it ran). The
   thresholds are data, in rules.json. */

var VERDICT_LABEL = {
  new: 'New', consistent: 'Consistent', building: 'Building', slipping: 'Slipping',
  dormant: 'Dormant', overreaching: 'Overreaching', mixed: 'Uneven'
};

/* Sets done against sets prescribed, over the days trained in a week, in per cent.
   Null for a week with no training. */
function weekCompletion(areaId, start, days) {
  var end = addDays(start, 6), done = 0, total = 0;
  days.forEach(function (r) {
    if (r.area === areaId && r.date >= start && r.date <= end) { done += r.done; total += r.total; }
  });
  return total ? Math.round(done * 100 / total) : null;
}

/* The verdict, from plain numbers.
     f  { weeks: [{ status }] finished weeks oldest first, firstTrained, lastTrained, today, intoLights }
   First match wins: too new to judge, gone quiet, pushing too hard, slipping,
   consistent, building, otherwise uneven. */
function verdictOf(f, T) {
  function count(list, keys) { return list.filter(function (w) { return keys.indexOf(w.status) >= 0; }).length; }
  var recent = f.weeks.slice(-T.window);
  var quiet = f.lastTrained ? daysBetween(f.lastTrained, f.today) : null;

  if (!f.firstTrained) return { key: 'new', why: 'Not trained yet.' };
  if (quiet !== null && quiet >= T.dormantDays) return { key: 'dormant', why: 'Nothing for ' + quiet + ' days.' };

  /* The warnings come before anything about history: pushing too hard is no less
     worth saying in the first week. */
  if (count(f.weeks.slice(-2), ['over'])) return { key: 'overreaching', why: 'Went over its weekly maximum recently.' };
  if (f.intoLights >= 2) {
    return { key: 'overreaching', why: 'Trained ' + f.intoLights + ' times in the last two weeks with a guarding body area amber or red.' };
  }

  if (daysBetween(f.firstTrained, f.today) < T.newWeeks * 7) {
    return { key: 'new', why: 'Under ' + T.newWeeks + ' weeks of history, so too early to judge.' };
  }

  /* One finished week is not a pattern: say so rather than judge it. The warnings above
     (gone quiet, pushing too hard) do not wait for one. */
  if (f.weeks.length < 2) {
    return { key: 'new', why: f.weeks.length ? 'Only one finished week so far.' : 'No finished week to judge yet.' };
  }

  /* With fewer finished weeks than the rule looks at, it is all of the weeks you have. */
  var lately = f.weeks.slice(-T.slippingWindow);
  var misses = count(lately, ['missed']);
  if (misses >= Math.min(T.slippingMisses, lately.length)) {
    return { key: 'slipping', why: 'Missed its minimum in ' + misses + ' of the last ' + lately.length + ' weeks.' };
  }
  var hits = count(recent, ['hit']);
  if (hits >= Math.min(T.consistentHits, recent.length)) return { key: 'consistent', why: 'Hit its target in ' + hits + ' of the last ' + recent.length + ' weeks.' };
  var met = count(recent, ['hit', 'met']);
  if (met >= Math.min(T.buildingHits, recent.length)) return { key: 'building', why: 'Met its minimum in ' + met + ' of the last ' + recent.length + ' weeks.' };
  return { key: 'mixed', why: 'Met its minimum in ' + met + ' of the last ' + recent.length + ' weeks.' };
}

/* Under the threshold for two finished weeks running, both with training in them. */
function isMostlyPartial(weeks, T) {
  var last = weeks.slice(-2);
  return last.length === 2 && last.every(function (w) { return w.completion !== null && w.completion < T.mostlyPartialPct; });
}

/* Times in the last two weeks this area was trained while a body area that
   guards it was amber or red. */
function daysIntoLights(area, today, days) {
  return days.filter(function (r) {
    return r.area === area.id && r.date <= today && daysBetween(r.date, today) < 14
      && !!(heldReason(area, r.date) || holdReason(area, r.date));
  }).length;
}

/* How an area is doing, from the app's state. */
function areaFeedback(area, today, days) {
  var T = areaData.rules.verdicts;
  var current = weekStartOf(today);
  var mine = days.filter(function (r) { return r.area === area.id && r.date <= today; });
  var firstTrained = null, lastTrained = null;
  mine.forEach(function (r) {
    if (!firstTrained || r.date < firstTrained) firstTrained = r.date;
    if (!lastTrained || r.date > lastTrained) lastTrained = r.date;
  });
  var firstWeek = firstTrained ? weekStartOf(firstTrained) : null;

  /* Weeks from before the areas existed were asked for something else, so they are
     history, not misses. */
  var era = settings.menuSince ? weekStartOf(settings.menuSince) : null;

  var weeks = [];
  for (var k = T.window; k >= 1; k--) {
    var s = addDays(current, -7 * k);
    if (!firstWeek || s < firstWeek || (era && s < era)) continue;      /* before it began: not a miss */
    var w = areaWeek(area, s, today, days);
    weeks.push({ start: s, touched: w.touched, min: w.min, target: w.target, max: w.max, status: w.status.key, completion: weekCompletion(area.id, s, days) });
  }

  var verdict = verdictOf({ weeks: weeks, firstTrained: firstTrained, lastTrained: lastTrained, today: today, intoLights: daysIntoLights(area, today, days) }, T);
  return {
    verdict: verdict.key, label: VERDICT_LABEL[verdict.key], why: verdict.why,
    mostlyPartial: isMostlyPartial(weeks, T), weeks: weeks, firstTrained: firstTrained, lastTrained: lastTrained
  };
}

/* --- the week at a glance, nudges and pace ------------------------------------ */

/* "5 of 8 areas on track". An area held by a red light cannot be on track or off
   it, so it is counted apart. */
function weekStrip(today, days) {
  var start = weekStartOf(today);
  var on = 0, total = 0, held = 0;
  areaList().forEach(function (a) {
    var key = areaWeek(a, start, today, days).status.key;
    if (key === 'held') { held++; return; }
    total++;
    if (key === 'done' || key === 'track' || key === 'due') on++;
  });
  return { onTrack: on, total: total, held: held,
    text: on + ' of ' + total + ' areas on track' + (held ? ' · ' + held + ' held' : '') };
}

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

/* A few gentle things worth knowing, most important first and at most a couple.
   Nothing here nags about an area a red light has paused. */
function nudgesFor(today, days) {
  var N = areaData.rules.nudges;
  var start = weekStartOf(today), end = addDays(start, 6);
  var left = daysBetween(today, end) + 1;
  var summary = weekSummary(start, today, days);
  var found = [];

  areaList().forEach(function (a) {
    var w = areaWeek(a, start, today, days);
    if (w.status.key === 'held') return;
    var fb = areaFeedback(a, today, days);
    var skipped = summary.skippedItems.filter(function (s) { return s.area.id === a.id; }).length;

    function add(rank, kind, text) { found.push({ area: a.id, kind: kind, rank: rank, priority: a.priority, text: text }); }

    if (w.status.key === 'risk') {
      var need = w.min - w.touched;
      add(1, 'risk', a.name + ': ' + plural(need, 'more day', 'more days') + ' needed for its minimum, and ' + plural(left, 'day', 'days') + ' left this week.');
    } else if (skipped >= N.skippedTimes) {
      add(2, 'skipped', a.name + ': skipped ' + (skipped === 2 ? 'twice' : skipped + ' times') + ' this week.');
    } else if (w.status.key === 'behind') {
      add(3, 'behind', a.name + ' is behind this week: ' + plural(w.target - w.touched, 'more day', 'more days') + ' for its target.');
    } else if (fb.verdict === 'slipping') {
      add(4, 'slipping', a.name + ': ' + fb.why.charAt(0).toLowerCase() + fb.why.slice(1));
    } else if (fb.mostlyPartial) {
      add(5, 'partial', a.name + ': finishing under ' + areaData.rules.verdicts.mostlyPartialPct + '% of its sets lately. A shorter day or more time may suit it.');
    } else if (fb.verdict === 'dormant') {
      add(6, 'dormant', a.name + ': ' + fb.why.charAt(0).toLowerCase() + fb.why.slice(1));
    }
  });

  var noTime = summary.skippedItems.filter(function (s) { return s.reason === 'no time'; }).length;
  if (noTime >= N.noTimeSkips) {
    found.push({ area: null, kind: 'noTime', rank: 2, priority: 0,
      text: plural(noTime, 'thing', 'things') + ' taken off for no time this week. Fewer areas, or a longer day, may fit better.' });
  }

  found.sort(function (x, y) { return (x.rank - y.rank) || (x.priority - y.priority); });
  return found.slice(0, N.maxShown);
}

/* When the next review is likely, from how often you have actually been doing full
   days of this area (not the target). */
function paceFor(area, today, days) {
  var P = areaData.rules.pace;
  var prog = stageProgress(area, days);
  var goal = prog.nextAsk !== null ? prog.nextAsk : prog.askAfter;
  if (!goal) return { kind: 'none' };
  var remaining = goal - prog.full;
  if (remaining <= 0) return { kind: 'due' };

  var mine = days.filter(function (r) { return r.area === area.id && r.date <= today; });
  var first = null;
  mine.forEach(function (r) { if (!first || r.date < first) first = r.date; });

  /* The window is the last few weeks ending today, or since the first day if that is later. */
  var windowStart = addDays(today, -(P.window * 7 - 1));
  var from = first && first > windowStart ? first : windowStart;
  var observed = first ? (daysBetween(from, today) + 1) / 7 : 0;
  if (observed < P.minWeeks) return { kind: 'early' };

  var recentFull = mine.filter(function (r) { return r.full && r.date >= from; }).length;
  if (!recentFull) return { kind: 'stalled', remaining: remaining };

  var perWeek = recentFull / observed;
  var weeks = Math.ceil(remaining / perWeek);
  return { kind: 'pace', remaining: remaining, perWeek: Math.round(perWeek * 10) / 10, weeks: weeks, date: addDays(today, weeks * 7) };
}

function paceText(p) {
  if (p.kind === 'due') return 'The review is due now.';
  if (p.kind === 'early') return 'Too early to say when the review will be.';
  if (p.kind === 'stalled') return plural(p.remaining, 'full day', 'full days') + ' to go, but none lately, so no date yet.';
  if (p.kind === 'pace') {
    return 'At your pace (' + p.perWeek + ' full days a week) the review is about ' + plural(p.weeks, 'week', 'weeks') + ' away, around ' + fmtDateShort(p.date) + '.';
  }
  return '';
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

    node.appendChild(el('div', { text: 'Set ' + (i + 1) + ' — ' + setBits(e).join(' · ') }));
  }
}

/* "20 kg", "5 reps", "RPE 8" — whatever was written down for the set. */
function setBits(e) {
  var bits = [];
  if (e.loadKg !== undefined) bits.push(fmtWeight(e.loadKg));
  if (e.reps !== undefined) bits.push(e.reps + (e.reps === 1 ? ' rep' : ' reps'));
  if (e.rpe !== undefined) bits.push('RPE ' + e.rpe);
  return bits;
}

function paintCount() {
  if (!todaySessions.length) return;
  var done = 0, total = 0;
  todaySessions.forEach(function (x) { done += doneSets(x); total += totalSets(x); });
  document.getElementById('appbar-sub').textContent = fmtDateShort(todayISO()) + ' · ' + done + ' of ' + total + ' sets';
}

/* --- rest timer -------------------------------------------------------- */
/* Rests run 3–4 minutes and you will not time them by feel.
   Everything is driven off a wall-clock end time rather than a counter, so
   a throttled or frozen tab comes back showing the truth instead of however
   far its interval happened to get. */

var restTimer = null;      /* { endAt, total, label, rang } */
var restTick = null;
var wakeLock = null;

/* --- sound ---------------------------------------------------------------- */
/* Four things you can hear, each different so you know without looking:
     a set (a timed hold) in its last seconds   fast, sharp ticks, twice a second
     a rest in its last seconds                 slow tick-tock, once a second, softer
     a set ending                               a double-dong, high then low
     a rest ending                              three beeps (or a double-dong, low then high)
   Everything is scheduled ahead on the audio clock, which keeps its own time, so a
   sound lands even if the page's tick is being throttled. Which of them play, and how
   loud, is yours to set (Progress tab, Sound). */

var SOUND_DEFAULTS = { volume: 'high', workTicks: true, restTicks: true, endWork: 'dong', endRest: 'beeps', tickFrom: 10 };
var SOUND_VOLUMES = { off: 0, low: 0.3, medium: 0.55, high: 0.8, max: 1 };
var SOUND_CHOICES = { volume: ['off', 'low', 'medium', 'high', 'max'], endWork: ['dong', 'off'], endRest: ['beeps', 'dong', 'off'], tickFrom: [5, 10, 15] };

var audioCtx = null;
var audioOut = null;                          /* { ctx, master }: every cue goes through one volume control */
var soundNodes = { work: [], rest: [], test: [] };

/* What you chose, with anything missing or odd replaced by the default. */
function cleanSound(s) {
  s = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  function pick(key) { return SOUND_CHOICES[key].indexOf(s[key]) >= 0 ? s[key] : SOUND_DEFAULTS[key]; }
  function flag(key) { return typeof s[key] === 'boolean' ? s[key] : SOUND_DEFAULTS[key]; }
  return { volume: pick('volume'), workTicks: flag('workTicks'), restTicks: flag('restTicks'),
    endWork: pick('endWork'), endRest: pick('endRest'), tickFrom: pick('tickFrom') };
}

function soundPrefs() { return cleanSound(settings.sound); }

/* Change one setting. Returns false, and changes nothing, for a value that is not allowed. */
function setSound(key, value) {
  if (!Object.prototype.hasOwnProperty.call(SOUND_DEFAULTS, key)) return false;
  var next = soundPrefs();
  next[key] = value;
  next = cleanSound(next);
  if (next[key] !== value) return false;
  settings.sound = next;
  if (key === 'volume') applyVolume();
  return saveSettings();
}

/* The volume is one control that every sound passes through, so turning it down (or
   off) silences what is already scheduled for a timer that is running. */
function applyVolume() {
  if (audioOut) audioOut.master.gain.value = SOUND_VOLUMES[soundPrefs().volume];
}

/* Ticking never fills more than the last half of a timer, and a timer too short
   to have a "last seconds" does not tick at all. */
function tickWindow(secs, from) {
  var w = Math.min(from, Math.floor(secs / 2));
  return w >= 2 ? w : 0;
}

/* What to play for a timer of `secs`, and when (seconds after it starts). Pure.
   role 'work' is a timed set; 'rest' is the rest between sets. */
function soundPlan(role, secs, prefs) {
  var plan = [];
  if (!(secs > 0) || prefs.volume === 'off') return plan;
  var win = tickWindow(secs, prefs.tickFrom);

  if (role === 'work') {
    if (prefs.workTicks && win) {
      for (var i = 0; i < win * 2; i++) plan.push({ at: secs - win + i * 0.5, kind: 'work-tick' });
    }
    if (prefs.endWork === 'dong') plan.push({ at: secs, kind: 'dong' });
  } else {
    if (prefs.restTicks && win) {
      for (var k = 0; k < win; k++) plan.push({ at: secs - win + k, kind: (win - k) % 2 === 1 ? 'rest-tock' : 'rest-tick' });
    }
    if (prefs.endRest === 'beeps') plan.push({ at: secs, kind: 'beeps' });
    else if (prefs.endRest === 'dong') plan.push({ at: secs, kind: 'dong-up' });
  }
  return plan;
}

/* Must be called from inside a user gesture or mobile browsers refuse. */
function ensureAudio() {
  try {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') {
      var r = audioCtx.resume();
      if (r && r.catch) r.catch(function () { /* still waiting for a gesture */ });
    }
    return audioCtx;
  } catch (err) {
    console.warn('audio unavailable', err);
    return null;
  }
}

/* One volume control and a limiter in front of the speaker, so the cues can be
   properly loud without ever clipping. */
function soundOut(ctx, prefs) {
  if (!audioOut || audioOut.ctx !== ctx) {
    var master = ctx.createGain();
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 10;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    audioOut = { ctx: ctx, master: master };
  }
  applyVolume();
  return audioOut.master;
}

/* One sound: an oscillator with a quick attack, an optional hold at full level, and a
   decay. A tick that dies away in a few milliseconds is barely heard on a phone speaker,
   so the ticks hold their level for a moment before they fade. */
function soundNote(ctx, out, channel, o) {
  try {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var attack = o.attack || 0.004, hold = o.hold || 0;
    var peakEnd = o.at + attack + hold, end = peakEnd + o.decay;
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, o.at);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, end);
    gain.gain.setValueAtTime(0.0001, o.at);
    gain.gain.exponentialRampToValueAtTime(o.peak, o.at + attack);
    if (hold) gain.gain.setValueAtTime(o.peak, peakEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(out);
    osc.start(o.at);
    osc.stop(end + 0.03);
    soundNodes[channel].push(osc);
  } catch (err) {
    console.warn('sound scheduling failed', err);
  }
}

/* A struck bell: a few partials that are not whole multiples of each other, the
   high ones dying away first. */
var BELL_PARTIALS = [[1, 0.55, 1.9], [2, 0.3, 1.2], [2.76, 0.22, 0.8], [5.4, 0.1, 0.4]];

function soundBell(ctx, out, channel, at, freq) {
  BELL_PARTIALS.forEach(function (p) {
    soundNote(ctx, out, channel, { type: 'sine', freq: freq * p[0], at: at, peak: p[1], decay: p[2] });
  });
}

function soundCue(ctx, out, channel, kind, at) {
  switch (kind) {
    case 'work-tick':
      soundNote(ctx, out, channel, { type: 'square', freq: 2600, freqEnd: 2100, at: at, peak: 0.95, attack: 0.002, hold: 0.04, decay: 0.04 });
      break;
    case 'rest-tick':
      soundNote(ctx, out, channel, { type: 'square', freq: 1250, at: at, peak: 0.7, attack: 0.003, hold: 0.05, decay: 0.1 });
      break;
    case 'rest-tock':
      soundNote(ctx, out, channel, { type: 'square', freq: 820, at: at, peak: 0.7, attack: 0.003, hold: 0.06, decay: 0.12 });
      break;
    case 'dong':                               /* high, then low: stop */
      soundBell(ctx, out, channel, at, 784);
      soundBell(ctx, out, channel, at + 0.55, 588);
      break;
    case 'dong-up':                            /* low, then high: go */
      soundBell(ctx, out, channel, at, 588);
      soundBell(ctx, out, channel, at + 0.55, 784);
      break;
    case 'beeps':
      [0, 0.22, 0.44].forEach(function (offset, i) {
        soundNote(ctx, out, channel, { type: 'square', freq: i === 2 ? 1320 : 880, at: at + offset, peak: 0.7, attack: 0.012, hold: 0.1, decay: 0.07 });
      });
      break;
  }
}

/* Schedule everything a timer of `secs` should play. `channel` is who owns the
   sounds, so a rest starting does not cancel the bell of the set that just ended. */
function scheduleSounds(role, secs, channel) {
  channel = channel || role;
  cancelSounds(channel);
  var prefs = soundPrefs();
  var plan = soundPlan(role, secs, prefs);
  if (!plan.length) return;
  var ctx = ensureAudio();
  if (!ctx) return;
  var out = soundOut(ctx, prefs);
  var base = ctx.currentTime;
  plan.forEach(function (ev) { soundCue(ctx, out, channel, ev.kind, base + ev.at); });
}

/* Stop what is waiting to play: one channel, or all of them. */
function cancelSounds(channel) {
  (channel ? [channel] : Object.keys(soundNodes)).forEach(function (c) {
    soundNodes[c].forEach(function (n) {
      try { n.stop(); n.disconnect(); } catch (err) { /* already finished */ }
    });
    soundNodes[c] = [];
  });
}

/* One cue, now, at the volume you have set: for hearing a change as you make it. */
function previewCue(kind) {
  var prefs = soundPrefs();
  if (prefs.volume === 'off') return;
  var ctx = ensureAudio();
  if (!ctx) return;
  cancelSounds('test');
  soundCue(ctx, soundOut(ctx, prefs), 'test', kind, ctx.currentTime + 0.02);
}

/* A few seconds of what it will sound like, with today's settings. */
function previewSound(role) {
  var prefs = soundPrefs();
  if (prefs.volume === 'off') { toast('Volume is off.'); return; }
  scheduleSounds(role, 8, 'test');
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

  restTimer = { endAt: Date.now() + secs * 1000, total: secs, label: ex.name, rang: false };
  persistTimer();

  scheduleSounds('rest', secs);   /* from a tap or a finished set, so the audio is allowed to start */
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

  scheduleSounds('rest', (restTimer.endAt - Date.now()) / 1000);
  paintTimer();
}

function stopRest() {
  cancelSounds('rest');
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

  if (entry.loadKg !== undefined) loadIn.value = toDisplayWeight(entry.loadKg);
  if (entry.reps !== undefined) repsIn.value = entry.reps;
  if (entry.rpe !== undefined) rpeIn.value = entry.rpe;

  var problem = el('p', { class: 'sheet-error', role: 'alert' });

  var form = el('form', { class: 'sheet' }, [
    el('h3', { text: ex.name }),
    el('p', { class: 'sheet-sub', text: 'Set ' + (i + 1) + ' of ' + ex.sets + ' — what actually happened' }),
    field('Load (' + unitName() + ')', loadIn),
    field('Reps', repsIn),
    field('RPE', rpeIn),
    problem,
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

  /* Out of range is refused, not trimmed to the limit: 999 reps trimmed to 300
     is still wrong, and nobody would see it. */
  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var checks = [
      checkSetValue(loadIn.value, loadLimitInUnit()),
      checkSetValue(repsIn.value, SET_LIMITS[1]),
      checkSetValue(rpeIn.value, SET_LIMITS[2])
    ];
    var inputs = [loadIn, repsIn, rpeIn];
    var firstBad = -1;
    checks.forEach(function (c, k) {
      if (c.error) {
        inputs[k].setAttribute('aria-invalid', 'true');
        if (firstBad < 0) firstBad = k;
      } else {
        inputs[k].removeAttribute('aria-invalid');
      }
    });

    if (firstBad >= 0) {
      problem.textContent = checks.filter(function (c) { return c.error; }).map(function (c) { return c.error; }).join(' ');
      inputs[firstBad].focus();
      return;
    }

    writeLog(session.id, ex.id, i, {
      done: true,                                  /* you logged it, so you did it */
      loadKg: loadKgFromInput(checks[0].value, entry.loadKg),
      reps: checks[1].value,
      rpe: checks[2].value
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

/* What one logged set can hold. Past these it is a typo, not a lift: the set
   sheet refuses them, and the Progress tab lists any already on the phone. */
var SET_LIMITS = [
  { key: 'loadKg', label: 'Load', unit: ' kg', min: 0, max: 250 },
  { key: 'reps',   label: 'Reps', unit: '',    min: 0, max: 300 },
  { key: 'rpe',    label: 'RPE',  unit: '',    min: 1, max: 10 }
];

/* What to store for the load you typed: kg, whatever the unit shown. A number you did
   not touch keeps the kg it came from, so opening a set in lb to fix the reps does not
   turn 20 kg into 19.96. */
function loadKgFromInput(value, storedKg) {
  if (value === undefined) return undefined;
  if (storedKg !== undefined && value === toDisplayWeight(storedKg)) return storedKg;
  return fromDisplayWeight(value);
}

/* The load limit as you type it: 250 kg is 551 lb. */
function loadLimitInUnit() {
  var l = SET_LIMITS[0];
  return usesLb() ? { key: l.key, label: l.label, unit: ' lb', min: 0, max: Math.floor(l.max * LB_PER_KG) } : l;
}

/* Blank is fine, it means "as planned". Anything else has to be a number in range. */
function checkSetValue(raw, limit) {
  var s = String(raw == null ? '' : raw).trim().replace(',', '.');
  if (s === '') return { value: undefined };
  var n = Number(s);
  if (!isFinite(n)) return { error: limit.label + ' has to be a number.' };
  if (n < limit.min || n > limit.max) {
    return { error: limit.label + ' has to be between ' + limit.min + ' and ' + limit.max + limit.unit + '.' };
  }
  return { value: n };
}

/* Sets already logged with a value outside those limits (a number that is not a
   number counts too), and which fields are the odd ones. */
function suspectSets() {
  var out = [];
  setLogs.forEach(function (e) {
    var bad = SET_LIMITS.filter(function (l) {
      var v = e[l.key];
      return v !== undefined && (typeof v !== 'number' || !isFinite(v) || v < l.min || v > l.max);
    });
    if (bad.length) out.push({ entry: e, bad: bad });
  });
  return out;
}

/* Remove only the odd numbers. The set stays done, and keeps the time it was
   logged at. */
function clearSuspect(item) {
  var e = item.entry;
  var ts = e.ts;
  var patch = {};
  item.bad.forEach(function (l) { patch[l.key] = undefined; });

  var kept = writeLog(e.sessionId, e.exerciseId, e.setIdx, patch);
  if (kept && ts) { kept.ts = ts; saveLogs(); }
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
/* The menu for today: one to three sittings, each a list of areas with its own
   minutes. The areas on a sitting are the ones you will do; everything else is
   below it, one tap away, with the reason it is or is not a good idea. */

var todaySessions = [];     /* the area-days on screen, for the set count in the app bar */
var todaySitting = 0;       /* which sitting is showing */
var todayOpen = {};         /* area-day id -> showing its exercises */

var SKIP_REASONS = [['no time', 'No time'], ['tired', 'Tired'], ['pain', 'Pain'], ['other', 'Other']];

function dataLoading(title) {
  setView(title, '', [el('p', { class: 'empty', text: areaLoad === 'failed'
    ? 'Could not load the areas. Connect once so they can be cached, then they work offline.'
    : 'Loading areas…' })]);
}

/* Re-draw in place, keeping the scroll: a tap on a button should not jump the page. */
function repaintToday() {
  var y = window.scrollY;
  renderToday();
  window.scrollTo(0, y);
}

/* One line per red body area: what it has paused, and until when. */
function heldCallouts(date) {
  var red = redAreasOn(date);
  return Object.keys(red).map(function (body) {
    var paused = areaList().filter(function (a) { return a.guardedBy.indexOf(body) >= 0; })
      .map(function (a) { return a.name; });
    if (!paused.length) return null;
    return el('div', { class: 'callout callout-red' }, [
      el('strong', { text: 'Red · ' + bodyLabel(body).toLowerCase() }),
      document.createTextNode('Paused until ' + fmtDateShort(addDays(red[body], 1)) + ': ' + paused.join(', ') + '.')
    ]);
  }).filter(Boolean);
}

/* The week in one line, and a couple of gentle things worth knowing. Tap for the grid. */
function weekStripBlock(today, days) {
  var strip = weekStrip(today, days);
  var kids = [el('div', { class: 'ws-main', text: 'This week: ' + strip.text })];
  nudgesFor(today, days).forEach(function (n) { kids.push(el('div', { class: 'nudge', text: n.text })); });
  return el('a', { class: 'week-strip', href: '#/areas' }, kids);
}

/* The week that has just finished, once: what was done, what was skipped. It stays
   until you put it away, and only for the week before this one. */
function lastWeekCard(today, days) {
  var start = addDays(weekStartOf(today), -7), end = addDays(start, 6);
  if (settings.lastWeekSeen === start) return null;
  var happened = days.some(function (r) { return r.date >= start && r.date <= end; })
    || Object.keys(dayPlans).some(function (d) { return d >= start && d <= end; });
  if (!happened) return null;

  var sum = weekSummary(start, today, days);
  var open = el('button', { class: 'btn', type: 'button', text: 'See it in Areas' });
  open.addEventListener('click', function () { areasView.week = start; areasView.day = null; location.hash = '#/areas'; });
  var away = el('button', { class: 'btn btn-quiet', type: 'button', text: 'Put it away' });
  away.addEventListener('click', function () { settings.lastWeekSeen = start; saveSettings(); repaintToday(); });

  return el('div', { class: 'card monday-card' }, [
    el('div', { class: 'card-top' }, [el('span', { class: 'card-title', text: 'Last week · ' + fmtDateShort(start) + ' – ' + fmtDateShort(end) })]),
    weekGrid(start, today, days, { static: true }),
    weekLegend(sum, weekHasNoPlan(start, today, days)),
    el('p', { class: 'wk-sum', text: 'Done ' + sum.done + ' · Partial ' + sum.partial + ' · Skipped ' + sum.skipped }),
    skippedList(sum),
    el('div', { class: 'sheet-actions', style: 'margin-top:10px' }, [open, away])
  ]);
}

/* When even the minimums do not fit the minutes you have, say so where you will
   see it. Tight and comfortable weeks say nothing here; the Areas tab has them. */
function overBooked(today, days) {
  var fit = weekFitFor(weekStartOf(today), days, today);
  if (!fit || fit.verdict !== 'over') return null;
  return el('div', { class: 'callout callout-due' }, [
    el('strong', { text: 'This week is over-booked' }),
    document.createTextNode(feasibilityLine(fit) + ' The lowest priorities will slip first. More minutes on some days, or fewer areas, would fix it.')
  ]);
}

/* Sitting tabs, and the time you have for the one showing. */
function sittingBar(date, plan) {
  var sitting = plan.sittings[todaySitting];
  var wrap = el('div', { class: 'sit-bar' });

  if (plan.sittings.length > 1) {
    var tabs = el('div', { class: 'sit-row' });
    plan.sittings.forEach(function (st, i) {
      var b = el('button', {
        class: 'sit-chip' + (i === todaySitting ? ' is-on' : ''), type: 'button',
        'aria-pressed': String(i === todaySitting),
        text: 'Sitting ' + (i + 1) + ' · ' + st.minutes + ' min'
      });
      b.addEventListener('click', function () { todaySitting = i; repaintToday(); });
      tabs.appendChild(b);
    });
    wrap.appendChild(tabs);
  }

  var options = areaData.rules.defaults.timeOptions.slice();
  if (options.indexOf(sitting.minutes) < 0) { options.push(sitting.minutes); options.sort(function (a, b) { return a - b; }); }

  var times = el('div', { class: 'sit-row' }, [el('span', { class: 'sit-label', text: 'Time:' })]);
  options.forEach(function (m) {
    var b = el('button', {
      class: 'sit-chip' + (m === sitting.minutes ? ' is-on' : ''), type: 'button',
      'aria-pressed': String(m === sitting.minutes), text: m + ' min'
    });
    b.addEventListener('click', function () { changeSittingMinutes(date, todaySitting, m, areaDays()); repaintToday(); });
    times.appendChild(b);
  });
  wrap.appendChild(times);
  return wrap;
}

/* Take an area off. Something the app suggested becomes a skip, so ask why
   (you may say nothing); something you added yourself just goes. */
function takeOff(date, sittingIdx, areaId) {
  var plan = dayPlans[date];
  var area = areaById(areaId);

  function go(reason) {
    var r = removeAreaFromDay(date, sittingIdx, areaId, reason);
    if (!r.ok) toast(r.why);
    repaintToday();
  }

  if (plan.suggested.indexOf(areaId) < 0) { go(''); return; }

  var list = el('div', { class: 'picklist' });
  SKIP_REASONS.concat([['', 'No reason']]).forEach(function (r) {
    var b = el('button', { class: 'card pick', type: 'button' }, [el('div', { class: 'card-title', text: r[1] })]);
    b.addEventListener('click', function () { closeSheet(); go(r[0]); });
    list.appendChild(b);
  });
  openSheet('Take ' + area.name + ' off today?', 'It was suggested, so the week will show it as skipped. A reason is optional.', [list]);
}

/* One area on one date: its progress, its start button and, when opened, its
   exercises with the same set chips as ever. */
function areaDayCard(date, sittingIdx, areaId, plan, onlyOne) {
  var area = areaById(areaId);
  var s = areaDaySession(date, areaId);
  if (!area || !s) {
    return el('div', { class: 'card' }, [
      el('div', { class: 'card-title', text: area ? area.name : areaId }),
      el('div', { class: 'card-sub', text: 'Nothing is written for this stage yet.' })
    ]);
  }

  if (!todaySessions.some(function (x) { return x.id === s.id; })) todaySessions.push(s);

  var paused = areaPaused(s);
  var total = totalSets(s), done = doneSets(s);
  var finished = !paused && total > 0 && done >= total;
  var open = s.id in todayOpen ? todayOpen[s.id] : onlyOne;

  var head = el('button', { class: 'ad-head', type: 'button', 'aria-expanded': String(open) }, [
    el('span', { class: 'ad-title', text: area.name }),
    el('span', { class: 'ad-prog', text: paused ? 'held' : done + ' / ' + total }),
    el('span', { class: 'chev', text: open ? '⌃' : '⌄' })
  ]);
  head.addEventListener('click', function () { todayOpen[s.id] = !open; repaintToday(); });

  var hold = paused ? null : holdReason(area, date);
  var why = plan.why && plan.why[areaId] ? plan.why[areaId] : (plan.suggested.indexOf(areaId) < 0 ? 'You added this one.' : '');

  var meta = (area.track ? [] : [s.stageId + (s.type ? ' · ' + s.type : '')]).concat(['~' + area.minutes + ' min']);
  var badges = el('div', { class: 'badges' }, [
    paused ? badge('Held', 'badge-test') : null,
    hold ? badge('Hold', 'badge-test') : null,
    s.deload ? badge('Easy block') : null,
    finished ? badge('Done', 'badge-green') : null,
    s.draft ? badge('Draft') : null
  ]);

  var card = el('div', { class: 'card ad-card' + (finished ? ' is-done' : '') }, [
    head,
    el('div', { class: 'ad-meta' }, [el('span', { text: meta.join(' · ') }), badges]),
    why && !paused ? el('div', { class: 'ad-why', text: why }) : null
  ]);

  var actions = el('div', { class: 'ad-actions' });
  if (!paused && !finished && total > 0 && area.track) {
    var mark = el('button', { class: 'btn btn-go', type: 'button', text: 'Mark done' });
    mark.addEventListener('click', function () {
      var r = logAreaBlock(date, areaId);
      if (!r.ok) toast(r.why);
      repaintToday();
    });
    actions.appendChild(mark);
  } else if (!paused && !finished && total > 0) {
    actions.appendChild(el('a', { class: 'btn btn-go', href: '#/run/' + s.id + '/' + firstOpenExercise(s), text: done ? '▶ Resume' : '▶ Start' }));
  }
  if (!sessionHasLogs(s)) {
    var off = el('button', { class: 'btn btn-quiet', type: 'button', text: 'Take off' });
    off.addEventListener('click', function () { takeOff(date, sittingIdx, areaId); });
    actions.appendChild(off);
  }
  if (actions.childNodes.length) card.appendChild(actions);

  if (paused) {
    card.appendChild(el('div', { class: 'ad-note', text: 'Held: ' + heldReason(area, date) + '. Nothing to do here until it clears.' }));
  } else if (hold) {
    card.appendChild(el('div', { class: 'ad-note', text: 'Hold: ' + hold + '. Train it, but keep the load where it is.' }));
  }
  if (!paused && s.deload) {
    card.appendChild(el('div', { class: 'ad-note', text: 'Easy block: about 60% of the usual sets, clean and unhurried. It still counts as a full day, and the review comes after it.' }));
  }
  if (!paused && s.draft && open) {
    card.appendChild(el('div', { class: 'ad-note', text: 'First-draft prescription: sets and reps for this stage have not been reviewed yet.' }));
  }

  if (open && !paused) {
    var gate = sessionGate(s);
    s.exercises.forEach(function (ex) { card.appendChild(exerciseCard(ex, s, 'live', gate)); });
  }
  return card;
}

/* An area that is not on this sitting, and why you might or might not add it. */
function addRow(row, date, sittingIdx) {
  var a = row.area;
  var lines = [el('div', { class: 'add-why', text: row.held ? 'Held: ' + row.held + '.' : row.reason })];
  if (row.record) lines.push(el('div', { class: 'add-why', text: 'Done today: ' + row.record.done + ' of ' + row.record.total + ' sets.' }));
  if (row.elsewhere) lines.push(el('div', { class: 'add-why', text: 'Already on another sitting today.' }));

  /* The recommender's own words, where the warnings below do not already say it:
     what makes it worth adding, or that it will not fit or is not needed. */
  var adviceKinds = ['time', 'limit', 'met'];
  if (row.recommended) lines.push(el('div', { class: 'add-rec', text: row.advice.why }));
  else if (!row.held && !row.elsewhere && !row.record && adviceKinds.indexOf(row.advice.kind) >= 0) lines.push(el('div', { class: 'add-why', text: row.advice.why }));

  if (row.hold) lines.push(el('div', { class: 'add-warn', text: 'Hold: ' + row.hold + '. Keep the load where it is.' }));
  row.warnings.forEach(function (w) { lines.push(el('div', { class: 'add-warn', text: w })); });

  var action;
  if (row.held) {
    action = el('span', { class: 'badge badge-test', text: 'Held' });
  } else {
    action = el('button', { class: 'btn btn-add', type: 'button', text: 'Add' });
    action.addEventListener('click', function () {
      var r = addAreaToDay(date, sittingIdx, a.id);
      if (!r.ok) toast(r.why);
      todayOpen[areaDayId(date, a.id)] = true;
      repaintToday();
    });
  }

  return el('div', { class: 'add-row' + (row.held ? ' is-held' : '') }, [
    el('div', { class: 'add-main' }, [
      el('div', { class: 'add-name', text: a.name }),
      el('div', { class: 'add-meta' }, [
        el('span', { text: currentStage(a).id + ' · ~' + a.minutes + ' min' }),
        row.held ? null : statusTag(row.week.status),
        row.recommended ? el('span', { class: 'st st-rec', text: 'Suggested' }) : null
      ])
    ].concat(lines)),
    action
  ]);
}

/* Something done without the app: pick the day and the area; every set of its
   block is marked done. */
function openElsewhereSheet(today) {
  var daySel = el('select', { id: 'log-date' }, [0, 1, 2, 3, 4, 5, 6].map(function (n) {
    var d = addDays(today, -n);
    return el('option', { value: d, text: n === 0 ? 'Today' : n === 1 ? 'Yesterday' : DAY_SHORT[isoDow(d)] + ' ' + fmtDateShort(d) });
  }));

  var list = el('div', { class: 'picklist' });
  areaList().forEach(function (a) {
    var b = el('button', { class: 'card pick', type: 'button' }, [
      el('div', { class: 'card-title', text: a.name }),
      el('div', { class: 'card-sub', text: 'Marks every set of ' + currentStage(a).id + ' as done.' })
    ]);
    b.addEventListener('click', function () {
      var date = daySel.value;
      var r = logAreaBlock(date, a.id);
      closeSheet();
      toast(r.ok ? a.name + ' logged for ' + fmtDateShort(date) + '.' : r.why);
      repaintToday();
    });
    list.appendChild(b);
  });

  openSheet('Log something done elsewhere', 'Pick the day, then the area.', [field('Day', daySel), list]);
}

function renderToday() {
  if (!areaData) return dataLoading('Today');

  var today = todayISO();
  var days = areaDays();
  var plan = ensureDayPlan(today, days);
  if (todaySitting >= plan.sittings.length) todaySitting = 0;
  var sitting = plan.sittings[todaySitting];
  todaySessions = [];

  var nodes = heldCallouts(today);
  var lastWeek = lastWeekCard(today, days);
  if (lastWeek) nodes.push(lastWeek);
  reviewCards(today, days).forEach(function (c) { nodes.push(c); });
  var over = overBooked(today, days);
  if (over) nodes.push(over);
  nodes.push(weekStripBlock(today, days));
  nodes.push(sittingBar(today, plan));

  var load = sittingLoad(sitting);
  nodes.push(el('div', { class: 'total-line' }, [
    el('span', { text: sitting.areas.length ? 'About ' + load.planned + ' min of ' + sitting.minutes : 'Nothing on this sitting yet.' }),
    load.over ? el('span', { class: 'over', text: '+' + load.over + ' min over' }) : null
  ]));

  var cards = sitting.areas.map(function (id) { return areaDayCard(today, todaySitting, id, plan, sitting.areas.length === 1); });

  var startable = sitting.areas.map(function (id) { return areaDaySession(today, id); })
    .filter(function (x) { return x && !areaPaused(x) && doneSets(x) < totalSets(x); })[0];
  if (startable) {
    nodes.push(el('a', { class: 'btn btn-go btn-block btn-start', href: '#/run/' + startable.id + '/' + firstOpenExercise(startable),
      text: sitting.areas.some(function (id) { var x = areaDaySession(today, id); return x && doneSets(x) > 0; }) ? '▶ Carry on with this sitting' : '▶ Start this sitting' }));
  }
  cards.forEach(function (c) { nodes.push(c); });

  if (!sitting.areas.length) {
    nodes.push(el('p', { class: 'hint', text: plan.suggested.length
      ? 'Everything suggested has been taken off. Add what you feel like below.'
      : 'Nothing is recommended for this time. Add what you feel like below.' }));
  }

  var others = menuRows(today, todaySitting, days).filter(function (r) { return !r.selected; });
  if (others.length) {
    nodes.push(el('p', { class: 'section-label', text: 'Add to this sitting' }));
    others.forEach(function (r) { nodes.push(addRow(r, today, todaySitting)); });
  }

  var more = el('div', { class: 'sheet-actions today-actions' });
  if (plan.sittings.length < MAX_SITTINGS) {
    var another = el('button', { class: 'btn', type: 'button', text: '+ Another sitting today' });
    another.addEventListener('click', function () { todaySitting = addSitting(today, 30); fillSitting(today, todaySitting, areaDays()); repaintToday(); });
    more.appendChild(another);
  }
  if (plan.sittings.length > 1 && !sitting.areas.length) {
    var drop = el('button', { class: 'btn btn-quiet', type: 'button', text: 'Remove this sitting' });
    drop.addEventListener('click', function () { removeSitting(today, todaySitting); todaySitting = 0; repaintToday(); });
    more.appendChild(drop);
  }
  nodes.push(more);

  var elsewhere = el('button', { class: 'btn btn-block btn-move', type: 'button', text: 'Log something done elsewhere' });
  elsewhere.addEventListener('click', function () { openElsewhereSheet(today); });
  nodes.push(elsewhere);

  nodes.push(el('p', { class: 'hint', text: 'The plan from before the areas is still under Plan, to read. Tap a set to tick it off by hand, long-press to record what actually happened.' }));
  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));

  setView('Today', '', nodes);
  paintCount();
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
    var wantArray = [LS_SETTINGS, LS_SCHEDULE, LS_DAYPLANS, LS_AREADAYS, LS_WEEKFITS, LS_PROGRESS].indexOf(key) < 0;

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
    [LS_DAYPLANS, LS_AREADAYS, LS_WEEKFITS, LS_PROGRESS, LS_DECISIONS].forEach(function (key) {
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
    loadWeekFits();
    loadProgress();
    loadDecisions();
    loadCustomAreas();
    mergeCustomAreas();
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
  cancelSounds('work');              /* a rest keeps going in its own bar, a hold does not */
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
  scheduleSounds('work', runner.secs);
  paintRunner();
}

/* One set finished: log it, advance, and let the rest run itself. A set that ran out
   by itself is finished a moment before its end sound is due, so this must not cancel
   it; a tap that ends a set early cancels the sounds first (see primaryAction). */
function completeSet() {
  var s = runSession();
  var ex = runExercise();
  if (!s || !ex) return;

  /* A timed per-side set is two efforts; the first only switches sides. */
  if (runner.phase !== 'resting' && isPerSide(ex) && timedSeconds(ex) !== null && runner.side === 0) {
    runner.side = 1;
    runner.phase = 'ready';
    runner.endAt = 0;
    if (navigator.vibrate) navigator.vibrate(60);
    paintRunner();
    return;
  }

  writeLog(s.id, ex.id, runner.setIdx, { done: true });
  paintCount();

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

  cancelSounds('work');
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
  cancelSounds('work');
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
    btn.addEventListener('click', function () { cancelSounds('work'); completeSet(); });
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

  /* A sitting runs as one go: the next area on it that still has sets to do. */
  var next = nextAreaDay(s);
  var nextBtn = null;
  if (next) {
    nextBtn = el('button', { class: 'run-action', type: 'button', text: 'Next: ' + areaById(next.areaId).name + ' ▶' });
    nextBtn.addEventListener('click', function () { location.hash = '#/run/' + next.id + '/' + firstOpenExercise(next); });
  }

  return el('div', { class: 'run-body run-done' }, [
    el('div', { class: 'run-ex', text: 'Session done' }),
    el('div', { class: 'run-setline', text: s.name }),
    el('div', { class: 'run-big', text: done + ' / ' + total }),
    el('div', { class: 'run-hint', text: 'sets logged · ' + mins + ' min' }),
    nextBtn || finish,
    nextBtn ? finish : null,
    el('div', { class: 'run-cue', text: done < total
      ? 'Some sets were skipped. You can still tick them off on the Today tab.'
      : 'Everything the plan asked for. Check in tomorrow morning.' })
  ]);
}

/* --- Check-in ---------------------------------------------------------- */
/* A separate event from the session log, with its own screen, because the
   plan autoregulates off next-morning stiffness rather than off how a set
   felt at the time. */

var AREA_LABEL = { elbow: 'Medial elbow', shoulder: 'Shoulder', wrist: 'Wrist', lowerBack: 'Lower back', knee: 'Knee', achilles: 'Achilles', hamstring: 'Hamstring' };
var STATE_LABEL = { green: 'Green', amber: 'Amber', red: 'Red' };

/* The track keys are join keys, not English. */
var TRACK_LABEL = {
  pullup: 'pull-up', dips: 'dips', heelRaise: 'heel raise', pogo: 'pogo',
  nordic: 'Nordic', hinge: 'hinge', sprint: 'sprint', kbPress: 'KB press'
};

function trackNames(area) {
  return tracksForArea(area).map(function (t) { return TRACK_LABEL[t] || t; }).join(', ');
}

/* What a body area's light does to the work. The old plan's tracks until the areas
   are in, then the areas it guards: amber holds them where they are, red pauses them. */
function guardedAreas(bodyId) {
  return areaList().filter(function (a) { return a.guardedBy.indexOf(bodyId) >= 0; });
}

function consequenceText(bodyId, state) {
  var guarded = guardedAreas(bodyId);
  if (!guarded.length) return trackNames(bodyId);
  var names = guarded.map(function (a) { return a.short || a.name; }).join(', ');
  return (state === 'red' ? 'Pauses ' : 'Holds ') + names;
}

function renderCheckIn() {
  var today = todayISO();
  var existing = checkInOn(today);

  /* Editing today's entry rather than stacking a second one. */
  var draft = {
    date: today,
    pain: {},
    stiffness: existing ? existing.stiffness : 'none',
    note: existing ? (existing.note || '') : ''
  };
  areas().forEach(function (a) { draft.pain[a] = existing ? painOf(existing, a) : 0; });

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
        el('span', { class: 'verdict-area', text: bodyLabel(a) }),
        el('span', { class: 'verdict-tracks', text: s === 'green' ? '' : consequenceText(a, s) })
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
        + rising.map(bodyLabel).join(', ') + '.' }));
    }
  }

  var nodes = [];

  nodes.push(el('p', { class: 'section-label', text: 'Morning check-in · ' + fmtDate(today) }));
  nodes.push(el('p', { class: 'hint', text: 'How it feels this morning, not how it felt during the session.' }));

  /* --- pain sliders --- */
  areas().forEach(function (a) {
    var out = el('span', { class: 'slider-val', text: String(draft.pain[a]) });
    var input = el('input', { type: 'range', min: '0', max: '10', step: '1', class: 'slider',
      id: 'pain-' + a, 'aria-label': bodyLabel(a) + ' pain, 0 to 10' });
    input.value = draft.pain[a];

    input.addEventListener('input', function () {
      draft.pain[a] = Number(input.value);
      out.textContent = input.value;
      repaintVerdict();
    });

    nodes.push(el('div', { class: 'slider-block' }, [
      el('div', { class: 'slider-head' }, [
        el('label', { class: 'slider-label', for: 'pain-' + a, text: bodyLabel(a) }),
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

/* "Elbow 4 · Knee 2", or "no pain". Body areas an older check-in never asked about
   read as nothing, so they never show. */
function painSummary(c) {
  var hurt = areas().filter(function (a) { return painOf(c, a) > 0; })
    .map(function (a) { return bodyLabel(a) + ' ' + painOf(c, a); });
  return hurt.length ? hurt.join(' \u00b7 ') : 'no pain';
}

function checkInRow(c) {
  var overall = worstState(areaStates(c, priorTo(c.date)));
  var pains = painSummary(c);
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

  var areaNames = gate.redAreas.map(bodyLabel).join(', ');
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
  var from = gate.heldAreas.map(bodyLabel).join(', ');

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
      text: fmtKg(toDisplayWeight(Math.round(v / PLATE) * PLATE)) }));
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
      svgEl('title', { text: p.label + ': ' + fmtWeight(p.kg) })
    ]));
  });

  /* what actually went on the bar, where it was logged */
  series.forEach(function (p, i) {
    if (actual[p.week] === undefined) return;
    g.push(svgEl('circle', { cx: x(i), cy: y(actual[p.week]), r: 3.2, class: 'ch-actual' }, [
      svgEl('title', { text: p.label + ' actual: ' + fmtWeight(actual[p.week]) })
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
    + fmtWeight(main[0].p.kg) + ' in ' + main[0].p.label + ' to '
    + fmtWeight(main[main.length - 1].p.kg) + ' in ' + main[main.length - 1].p.label + '.';

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
        el('span', { class: 'chart-delta', text: (delta >= 0 ? '+' : '−') + fmtWeight(Math.abs(delta)) })
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

  nodes.push(dataCheckSection());           /* short, and something to act on: keep it near the top */

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

  nodes.push(unitsSection());               /* it changes the loads just above, so it sits beside them */
  nodes.push(soundSection());
  nodes.push(scheduleSection());
  nodes.push(installSection());
  nodes.push(chartsSection());
  nodes.push(equipmentSection());
  nodes.push(backupSection());
  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));

  setView('Progress', baselines.length ? baselines.length + (baselines.length === 1 ? ' entry' : ' entries') : '', nodes);

  var btn = document.getElementById('btn-recal');
  if (btn) btn.addEventListener('click', function () { openBaselineSheet(); });

  window.scrollTo(0, 0);
}

/* Where a logged set came from, in words. */
function describeLoggedSet(e) {
  var s = sessionById(e.sessionId);
  var ex = s && s.exercises.filter(function (x) { return x.id === e.exerciseId; })[0];
  var date = s ? sessionDate(s) : null;
  if (!date && e.ts) date = String(e.ts).slice(0, 10);
  return {
    what: (ex ? ex.name : e.exerciseId) + ' · set ' + (e.setIdx + 1),
    when: date ? fmtDate(date) : 'date unknown'
  };
}

/* Sets whose numbers cannot be real, each with a one-tap clear. Nothing is shown
   when everything is fine. */
function dataCheckSection() {
  var items = suspectSets();
  if (!items.length) return null;

  function cleared(count) {
    toast(count === 1 ? 'Cleared. The set is still done.' : 'Cleared ' + count + ' sets. They are still done.');
    renderProgress();
    paintTabBadge();
  }

  var wrap = el('div', {}, [
    el('p', { class: 'section-label', text: 'Check your data' }),
    el('div', { class: 'callout callout-due' }, [
      el('strong', { text: items.length === 1 ? 'One set looks like a typo' : items.length + ' sets look like typos' }),
      document.createTextNode('A load over ' + loadLimitInUnit().max + ' ' + unitName() + ', more than 300 reps, or an RPE outside 1–10. Clearing removes only the odd numbers; the set stays done.')
    ])
  ]);

  items.forEach(function (item) {
    var d = describeLoggedSet(item.entry);
    var clearBtn = el('button', { class: 'linkbtn', type: 'button', text: 'Clear values' });
    clearBtn.addEventListener('click', function () {
      clearSuspect(item);
      cleared(1);
    });
    wrap.appendChild(el('div', { class: 'card hist' }, [
      el('div', { class: 'card-top' }, [el('span', { class: 'card-title', text: d.what }), clearBtn]),
      el('div', { class: 'card-sub', text: d.when + ' · ' + setBits(item.entry).join(' · ') })
    ]));
  });

  if (items.length > 1) {
    var allBtn = el('button', { class: 'btn btn-quiet btn-block', type: 'button', text: 'Clear all ' + items.length });
    allBtn.addEventListener('click', function () {
      items.forEach(clearSuspect);
      cleared(items.length);
    });
    wrap.appendChild(allBtn);
  }
  return wrap;
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

var STATE_TEXT = {
  full: 'done', partial: 'partial', skipped: 'skipped', planned: 'planned',
  noplan: 'no plan recorded', none: 'not trained', future: 'not yet'
};

/* One glyph per state. Shape carries the meaning, colour only reinforces it:
   filled disc done, half disc partial, dashed ring planned, cross skipped,
   hatching no plan recorded, dot nothing. */
function stateGlyph(state) {
  var svg = svgEl('svg', { class: 'g', viewBox: '0 0 20 20', 'aria-hidden': 'true' });
  if (state === 'full') {
    svg.appendChild(svgEl('circle', { class: 'g-done', cx: 10, cy: 10, r: 7.5 }));
  } else if (state === 'partial') {
    svg.appendChild(svgEl('circle', { class: 'g-ring', cx: 10, cy: 10, r: 7.5 }));
    svg.appendChild(svgEl('path', { class: 'g-part', d: 'M10 2.5 A7.5 7.5 0 0 0 10 17.5 Z' }));
  } else if (state === 'planned') {
    svg.appendChild(svgEl('circle', { class: 'g-plan', cx: 10, cy: 10, r: 7.5 }));
  } else if (state === 'skipped') {
    svg.appendChild(svgEl('path', { class: 'g-skip', d: 'M5.5 5.5 L14.5 14.5 M14.5 5.5 L5.5 14.5' }));
  } else if (state === 'noplan') {
    svg.appendChild(svgEl('path', { class: 'g-hatch', d: 'M4 12 L12 4 M8 16 L16 8 M12 18 L18 12' }));
  } else if (state === 'none') {
    svg.appendChild(svgEl('circle', { class: 'g-dot', cx: 10, cy: 10, r: 1.9 }));
  }
  return svg;
}

var REASON_TEXT = {};
SKIP_REASONS.forEach(function (r) { REASON_TEXT[r[0]] = r[1]; });
function reasonText(reason) { return reason ? (REASON_TEXT[reason] || reason) : ''; }

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
function weekGrid(start, today, days, opts) {
  var live = !(opts && opts.static);                /* static: for reading, nothing to tap */
  var grid = el('div', { class: 'wk-grid', role: 'grid', 'aria-label': 'Areas by day' });
  var LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function pickDay(date) { areasView.day = date; repaintAreas(); }

  grid.appendChild(el('div'));
  LETTER.forEach(function (letter, i) {
    var date = addDays(start, i);
    var b = el(live ? 'button' : 'div', {
      class: 'wk-day' + (date === today ? ' is-today' : '') + (live && date === areasView.day ? ' is-sel' : ''),
      type: live ? 'button' : null,
      'aria-label': fmtDateShort(date) + (date === today ? ', today' : '')
    }, [letter, el('b', { text: String(Number(date.slice(8, 10))) })]);
    if (live) b.addEventListener('click', function () { pickDay(date); });
    grid.appendChild(b);
  });

  areaList().forEach(function (area) {
    var w = areaWeek(area, start, today, days);
    grid.appendChild(el('div', { class: 'wk-lab' }, [
      el('div', { class: 'n', text: area.short }),
      el('div', { class: 's', text: currentStage(area).id + ' · ' + w.touched + '/' + w.target + (w.ramp ? ' · ramp' : '') }),
      statusTag(w.status)
    ]));

    w.cells.forEach(function (c) {
      var cell = el(live ? 'button' : 'div', {
        class: 'wk-cell' + (c.isToday ? ' is-today' : '') + (c.state === 'future' ? ' is-future' : '')
          + (live && c.date === areasView.day ? ' is-sel' : ''),
        type: live ? 'button' : null,
        'aria-label': area.name + ', ' + fmtDateShort(c.date) + ': ' + STATE_TEXT[c.state]
      }, [c.state === 'future' ? null : stateGlyph(c.state)]);
      if (live) cell.addEventListener('click', function () { pickDay(c.date); });
      grid.appendChild(cell);
    });
  });

  return grid;
}

/* Only the shapes this week actually uses, so the legend never explains
   something that is not on screen. */
function weekLegend(sum, hasNoPlan) {
  var wrap = el('div', { class: 'wk-legend' });
  var items = [['full', 'Done'], ['partial', 'Partial']];
  if (sum.planned) items.push(['planned', 'Planned']);
  if (sum.skipped) items.push(['skipped', 'Skipped']);
  if (hasNoPlan) items.push(['noplan', 'No plan recorded']);
  items.push(['none', 'Not trained']);
  items.forEach(function (p) {
    wrap.appendChild(el('span', {}, [stateGlyph(p[0]), p[1]]));
  });
  return wrap;
}

/* The line under a logged item: "5 of 5 sets", "3 of 17 sets · partial". */
function recNote(r) {
  return r.done + ' of ' + r.total + ' sets' + (r.full ? '' : ' · partial');
}

function detailRow(item, extra) {
  var area = item.area;
  var note = '';
  if (item.record) note = recNote(item.record);
  else if (item.state === 'skipped') note = 'Skipped' + (item.reason ? ' · ' + reasonText(item.reason) : '');
  else if (item.state === 'planned' || item.state === 'future') note = 'Planned';

  if (item.record && item.removed) note += ' · taken off the menu';
  if (extra) note += (note ? ' · ' : '') + extra;

  return el('div', { class: 'wk-item' }, [
    stateGlyph(item.state === 'future' ? 'planned' : item.state),
    el('span', { text: area ? area.name : '' }),
    el('span', { class: 'wk-note', text: note })
  ]);
}

/* One day: each sitting in turn, then anything logged that was not on the menu.
   A day nobody opened says so, rather than looking like a day off. */
function dayDetail(date, today, days) {
  var d = dayDetailItems(date, today, days);
  var card = el('div', { class: 'card' }, [
    el('div', { class: 'card-top' }, [
      el('span', { class: 'card-title', text: fmtDate(date) }),
      el('div', { class: 'badges' }, [date === today ? badge('Today', 'badge-now') : null])
    ])
  ]);

  if (d.noPlan) {
    var since = settings.menuSince && date >= settings.menuSince && date < today;
    if (!d.extras.length) {
      card.appendChild(el('div', { class: 'card-sub', text: date > today ? 'Nothing yet.'
        : since ? 'No plan recorded for this day.' : 'Nothing logged for any area.' }));
      return card;
    }
    if (since) card.appendChild(el('div', { class: 'card-sub', text: 'No plan recorded for this day. What was logged:' }));
    d.extras.forEach(function (it) { card.appendChild(detailRow(it)); });
    return card;
  }

  d.sittings.forEach(function (st) {
    card.appendChild(el('div', { class: 'wk-sit', text: 'Sitting ' + (st.index + 1) + ' · ' + st.minutes + ' min' }));
    if (!st.items.length) card.appendChild(el('div', { class: 'card-sub', text: 'Nothing planned.' }));
    st.items.forEach(function (it) { card.appendChild(detailRow(it)); });
  });

  if (d.extras.length) {
    card.appendChild(el('div', { class: 'wk-sit', text: 'Not on the menu' }));
    d.extras.forEach(function (it) { card.appendChild(detailRow(it, it.removed ? '' : 'added')); });
  }
  return card;
}

/* What was skipped this week, with the reason you gave, one line each. */
function skippedList(sum) {
  if (!sum.skippedItems.length) return null;
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var shown = sum.skippedItems.slice(0, 6);
  var rows = shown.map(function (s) {
    var why = reasonText(s.reason);
    return el('li', { text: DAYS[isoDow(s.date)] + ' · ' + s.area.name + (why ? ' · ' + why : '') });
  });
  if (sum.skippedItems.length > shown.length) {
    rows.push(el('li', { text: '+ ' + (sum.skippedItems.length - shown.length) + ' more — tap a day to see it' }));
  }
  return el('ul', { class: 'wk-skips', 'aria-label': 'Skipped this week' }, rows);
}

/* How the week's time was shared out: whether the minimums fit, what was
   trimmed to make it fit, who is starting out. Nothing for a finished week that
   was never looked at while it ran. */
function fitBlock(start, today, days) {
  var fit = weekFitFor(start, days, today);
  if (!fit) return null;
  var lines = [feasibilityLine(fit), noTimeLine(fit), trimmedLine(fit), rampLine(fit)].filter(Boolean);
  return el('div', { class: 'wk-fit wk-fit-' + fit.verdict }, lines.map(function (text, i) {
    return el('p', { class: i === 0 ? 'wk-fit-main' : '', text: text });
  }));
}

function weekHasNoPlan(start, today, days) {
  return areaList().some(function (a) {
    return areaWeek(a, start, today, days).cells.some(function (c) { return c.state === 'noplan'; });
  });
}

function weekCard(start, today, days) {
  var current = weekStartOf(today);
  var first = firstWeekStart(days);
  var end = addDays(start, 6);

  var prev = el('button', { class: 'wk-nav', type: 'button', 'aria-label': 'Previous week', text: '‹', disabled: start <= first });
  var next = el('button', { class: 'wk-nav', type: 'button', 'aria-label': 'Next week', text: '›', disabled: start >= current });
  prev.addEventListener('click', function () { areasView.week = addDays(start, -7); areasView.day = null; repaintAreas(); });
  next.addEventListener('click', function () { areasView.week = addDays(start, 7); areasView.day = null; repaintAreas(); });

  var sum = weekSummary(start, today, days);
  var line = 'Done ' + sum.done + ' · Partial ' + sum.partial + ' · Skipped ' + sum.skipped;
  if (sum.planned) line += ' · Planned today ' + sum.planned;

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
    weekLegend(sum, weekHasNoPlan(start, today, days)),
    el('p', { class: 'wk-sum', text: line }),
    skippedList(sum),
    fitBlock(start, today, days)
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

/* The verdict as a small label, coloured by what it means. */
function verdictChip(fb) {
  return el('span', { class: 'vd vd-' + fb.verdict, title: fb.why, text: fb.label });
}

/* "2 2 3 1": days trained in each of the last finished weeks, oldest first. */
function weeksText(fb) {
  return fb.weeks.length ? fb.weeks.map(function (w) { return w.touched; }).join('  ') : 'nothing yet';
}

function areaCard(area, days) {
  var prog = stageProgress(area, days);
  var fb = areaFeedback(area, todayISO(), days);
  return el('a', { class: 'card', href: '#/areas/' + area.id }, [
    el('div', { class: 'card-top' }, [
      el('span', { class: 'card-title', text: area.name }),
      el('div', { class: 'badges' }, [
        area.custom ? badge('Yours') : null,
        prog.due ? badge('Review due', 'badge-test') : prog.phase === 'deload' ? badge('Easy block') : null,
        el('span', { class: 'chev', text: '›' })
      ])
    ]),
    el('div', { class: 'card-sub', text: area.goal }),
    area.track ? null : ladderRow(area, prog.stage.id),
    el('div', { class: 'card-sub', text: area.track ? 'Tracked · ' + prog.full + ' full days so far'
      : 'Stage ' + prog.stage.id + ' · ' + prog.stage.name
        + (prog.askAfter ? ' · ' + prog.full + ' of ' + prog.askAfter + ' full days' : ' · ' + prog.full + ' full days') }),
    el('div', { class: 'vd-row' }, [
      verdictChip(fb),
      fb.mostlyPartial ? el('span', { class: 'vd vd-partial', text: 'Mostly partial' }) : null,
      el('span', { class: 'vd-weeks', text: 'Last weeks: ' + weeksText(fb) })
    ])
  ]);
}

function renderAreas() {
  if (!areaData) return areasLoading();

  var today = todayISO();
  var days = areaDays();
  var current = weekStartOf(today);
  var first = firstWeekStart(days);
  ensureWeekFit(current, days);

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
  var addBtn = el('button', { class: 'btn btn-block', type: 'button', text: '+ Add an area' });
  addBtn.addEventListener('click', openAddAreaSheet);
  nodes.push(addBtn);
  nodes.push(skippedAreasNote());

  if (!decisions.length) nodes.push(el('p', { class: 'hint', text: 'Every area starts at the first rung of its ladder. If you are already further along in one, open it and choose Set the stage yourself.' }));
  nodes.push(el('p', { class: 'hint', text: 'History from before the areas (weighted pull-ups, sprints, hinge, kettlebell press and a few prehab exercises) is kept but not counted here. A day counts as skipped only when it was on that day’s menu, or taken off it, and nothing was logged.' }));
  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));

  setView('Areas', areaList().length + ' areas', nodes);
}

/* --- the review ------------------------------------------------------------ */
/* Where you decide. The app asks when the days are done; you can open it any
   time. It shows what you did, how the body is, the standard to attest to, and
   what the next stage is, then you move up, say not yet, or step back. */

var reviewTicks = {};     /* the standard's checklist for this visit; not stored */

function phaseText(prog) {
  if (prog.phase === 'top') return 'Top of the ladder.';
  if (prog.phase === 'ask') return 'Ready for a review.';
  if (prog.phase === 'deload') return 'Easy block: about 60% of the sets, the last days before the review.';
  if (prog.nextAsk !== null) return 'Staying at the top prescription until ' + prog.nextAsk + ' full days.';
  return 'Full prescription.';
}

/* The body areas guarding an area, as the last week of check-ins reads them. */
function guardLights(area, date) {
  var recent = checkInsBetween(addDays(date, -(RED_DAYS - 1)), date);
  return area.guardedBy.map(function (b) {
    var state = recent.length ? 'green' : null;
    recent.forEach(function (c) {
      var s = areaState(b, c, priorTo(c.date));
      if (STATE_RANK[s] > STATE_RANK[state]) state = s;
    });
    return { body: b, label: bodyLabel(b), state: state };
  });
}

/* "3 × 5 → 8 / leg · 3 s down · +25 % BW", the way a set reads. */
function exerciseLine(ex, date) {
  var bits = [ex.sets + ' × ' + ex.reps];
  if (ex.tempo) bits.push(ex.tempo);
  var load = resolveLoad(ex.load, date).text;
  if (load && load !== '—' && load !== 'Bodyweight') bits.push(load);
  return bits.join(' · ');
}

/* What changes between two stages: by exercise id. */
function stageDiff(from, to) {
  var had = {}, has = {};
  (from.exercises || []).forEach(function (e) { had[e.id] = e; });
  (to.exercises || []).forEach(function (e) { has[e.id] = e; });
  return {
    added: (to.exercises || []).filter(function (e) { return !had[e.id]; }),
    dropped: (from.exercises || []).filter(function (e) { return !has[e.id]; })
  };
}

function lightLabel(state) { return state ? STATE_LABEL[state] : 'no check-in this week'; }

function decisionLine(d) {
  var what = d.action === 'up' ? d.from + ' → ' + d.to + ', moved up'
    : d.action === 'back' ? d.from + ' → ' + d.to + ', stepped back'
    : d.action === 'set' ? d.from + ' → ' + d.to + ', set by you'
    : d.from + ', not yet';
  return fmtDateShort(d.date) + ' · ' + what + (d.full ? ' · ' + d.full + ' full days' : '');
}

function decisionsFor(area) {
  return decisions.filter(function (d) { return d.area === area.id; }).slice().reverse();
}

function decisionList(area) {
  var list = decisionsFor(area);
  if (!list.length) return null;
  return el('div', {}, [
    el('p', { class: 'section-label', text: 'Your decisions' }),
    el('ul', { class: 'rv-history' }, list.map(function (d) { return el('li', { text: decisionLine(d) }); }))
  ]);
}

function renderReview(id) {
  if (!areaData) return areasLoading();
  var area = areaById(id);
  if (!area) return renderNotFound('No area "' + id + '".');
  if (area.track) {
    return setView('Review', area.short || area.name, [
      el('a', { class: 'back', href: '#/areas/' + area.id, text: '‹ ' + area.name }),
      el('p', { class: 'empty', text: area.name + ' is tracked, so there is no ladder to review.' })
    ]);
  }

  var today = todayISO();
  var days = areaDays();
  var prog = stageProgress(area, days);
  var stage = prog.stage;
  var next = area.stages[prog.index + 1] || null;
  var prev = area.stages[prog.index - 1] || null;
  var block = next ? levelUpBlock(area, today) : null;

  function kvRow(k, v, cls) {
    return el('div', { class: 'kv-row' }, [el('span', { class: 'kv-key', text: k }), el('span', { class: 'kv-val' + (cls ? ' ' + cls : ''), text: v })]);
  }
  function repaint() { var y = window.scrollY; renderReview(id); window.scrollTo(0, y); }
  function leave(message) { toast(message); location.hash = '#/areas/' + area.id; }

  var nodes = [
    el('a', { class: 'back', href: '#/areas/' + area.id, text: '‹ ' + area.name }),
    el('div', { class: 'session-head' }, [
      el('h2', { text: 'Review · ' + area.name }),
      el('div', { class: 'meta', text: stage.id + ' · ' + stage.name })
    ])
  ];

  if (prog.phase !== 'ask' && prog.phase !== 'top') {
    nodes.push(el('p', { class: 'hint', text: 'You are early. The review usually comes after ' + (prog.nextAsk !== null ? prog.nextAsk : prog.askAfter) + ' full days; you can decide now if you already know.' }));
  }

  /* where you are */
  var kv = el('div', { class: 'kv kv-text' }, [
    kvRow('Full days in ' + stage.id, prog.full + (prog.askAfter ? ' of ' + prog.askAfter : '')),
    kvRow('Where that is', phaseText(prog))
  ]);
  guardLights(area, today).forEach(function (g) {
    kv.appendChild(kvRow(g.label, lightLabel(g.state), g.state === 'red' ? 'is-red' : g.state === 'amber' ? 'is-amber' : ''));
  });
  nodes.push(el('p', { class: 'section-label', text: 'Where you are' }), kv);

  /* the standard, to attest to */
  nodes.push(el('p', { class: 'section-label', text: 'The standard for ' + stage.id }));
  var checks = el('div', { class: 'rv-checks' });
  stage.ready.forEach(function (text, i) {
    var key = area.id + ':' + stage.id + ':' + i;
    var on = !!reviewTicks[key];
    var b = el('button', { class: 'rv-check' + (on ? ' is-on' : ''), type: 'button', role: 'checkbox', 'aria-checked': String(on) }, [
      el('span', { class: 'rv-box', text: on ? '✓' : '' }), el('span', { text: text })
    ]);
    b.addEventListener('click', function () { reviewTicks[key] = !on; repaint(); });
    checks.appendChild(b);
  });
  nodes.push(checks, el('p', { class: 'hint', text: 'Tick what you can do, honestly. Nothing here is checked for you; it is for you.' }));

  /* what comes next */
  if (next) {
    var diff = stageDiff(stage, next);
    var preview = el('div', { class: 'card' }, [
      el('div', { class: 'card-top' }, [
        el('span', { class: 'card-title', text: next.id + ' · ' + next.name }),
        el('div', { class: 'badges' }, [next.optional ? badge('Optional') : null, next.draft ? badge('Draft') : null, next.goal ? badge('Goal', 'badge-test') : null])
      ]),
      el('div', { class: 'card-sub', text: next.work })
    ]);
    if (next.exercises && next.exercises.length) {
      var added = {};
      diff.added.forEach(function (e) { added[e.id] = true; });
      preview.appendChild(el('ul', { class: 'rv-ex' }, next.exercises.map(function (e) {
        return el('li', {}, [
          el('span', { class: 'rv-ex-name', text: e.name }),
          added[e.id] ? el('span', { class: 'st st-rec', text: 'new' }) : null,
          el('span', { class: 'rv-ex-line', text: exerciseLine(e, today) })
        ]);
      })));
      if (diff.dropped.length) preview.appendChild(el('div', { class: 'stage-fact', text: 'Drops out: ' + diff.dropped.map(function (e) { return e.name; }).join(', ') + '.' }));
    } else {
      preview.appendChild(el('div', { class: 'stage-fact is-unmet', text: 'Nothing is written for ' + next.id + ' yet, so it cannot be started.' }));
    }
    if (next.note) preview.appendChild(el('div', { class: 'card-sub', text: next.note }));

    var needs = stageNeeds(next);
    needs.equipment.forEach(function (q) {
      preview.appendChild(el('div', { class: 'stage-fact' + (q.owned ? '' : ' is-unmet'), text: (q.owned ? 'Have: ' : 'Missing: ') + q.label }));
    });
    needs.bells.forEach(function (b) {
      preview.appendChild(el('div', { class: 'stage-fact' + (b.owned ? '' : ' is-unmet'), text: (b.owned ? 'Have: ' : 'Missing: ') + 'a ' + b.lb + ' lb (' + b.kg + ' kg) bell' }));
    });
    prereqStatus(next).forEach(function (r) {
      preview.appendChild(el('div', { class: 'stage-fact' + (r.met ? '' : ' is-unmet'), text:
        'Advisory: ' + r.name + ' ' + r.stage + ' first. You are at ' + (r.have || 'nothing') + (r.met ? ', met.' : ', not yet.') }));
    });
    if (next.perWeek || next.minGapDays) {
      var per = stageWeek(area, next);
      preview.appendChild(el('div', { class: 'stage-fact', text: 'This stage runs ' + per.min + ' · ' + per.target + ' · ' + per.max + ' days a week, ' + stageGap(area, next) + ' days apart.' }));
    }
    if (needs.missing.length) preview.appendChild(el('a', { class: 'rv-link', href: '#/progress', text: 'Tick what you own under Equipment on the Progress tab' }));
    nodes.push(el('p', { class: 'section-label', text: 'Next' }), preview);
  } else {
    nodes.push(el('p', { class: 'hint', text: stage.goal ? 'This is the goal stage: ' + area.goal : 'This is the top of the ladder.' }));
  }

  /* the decision */
  nodes.push(el('p', { class: 'section-label', text: 'Your call' }));
  var actions = el('div', { class: 'rv-actions' });

  if (next) {
    var up = el('button', { class: 'btn btn-go btn-block', type: 'button', disabled: !!block,
      text: (next.optional ? 'Take the optional stage ' : 'Move up to ') + next.id });
    up.addEventListener('click', function () {
      var ticked = stage.ready.every(function (x, i) { return reviewTicks[area.id + ':' + stage.id + ':' + i]; });
      if (!ticked && !confirm('You have not ticked everything in the standard. Move up anyway?')) return;
      var r = moveUp(area.id, days, today);
      if (!r.ok) { toast(r.why); return; }
      reviewTicks = {};
      leave('Moved up to ' + r.stage.id + '.');
    });
    actions.appendChild(up);
    if (block) actions.appendChild(el('p', { class: 'rv-wait', text: 'Waiting: ' + block + '. Moving up opens again when it clears. You can still say not yet or step back.' }));

    var not = el('button', { class: 'btn btn-block', type: 'button', text: 'Not yet' });
    not.addEventListener('click', function () {
      var r = notYet(area.id, days, today);
      leave('Okay. Staying at the top prescription, and asking again after ' + areaData.rules.defaults.repeatEvery + ' more full days.');
    });
    actions.appendChild(not);
  }
  if (prev) {
    var back = el('button', { class: 'btn btn-quiet btn-block', type: 'button', text: 'Step back to ' + prev.id });
    back.addEventListener('click', function () {
      if (!confirm('Step back to ' + prev.id + '? Full area-days start again from zero in the old stage.')) return;
      var r = stepBack(area.id, days, today);
      if (!r.ok) { toast(r.why); return; }
      leave('Stepped back to ' + r.stage.id + '.');
    });
    actions.appendChild(back);
  }
  nodes.push(actions);

  var history = decisionList(area);
  if (history) nodes.push(history);
  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));

  setView('Review', area.short || area.name, nodes);
  window.scrollTo(0, 0);
}

/* Set the stage yourself: where you start, or somewhere that is not the next rung. */
function openStagePicker(area, onDone) {
  var prog = stageProgress(area, areaDays());
  var list = el('div', { class: 'picklist' });
  area.stages.forEach(function (s) {
    var here = s.id === prog.stage.id;
    var ready = !!(s.exercises && s.exercises.length);
    var b = el('button', { class: 'card pick', type: 'button', disabled: here || !ready }, [
      el('div', { class: 'card-top' }, [
        el('span', { class: 'card-title', text: s.id + ' · ' + s.name }),
        el('div', { class: 'badges' }, [here ? badge('You are here', 'badge-now') : null, !ready ? badge('Nothing written yet') : null])
      ]),
      el('div', { class: 'card-sub', text: (s.ready[0] || s.work) })
    ]);
    b.addEventListener('click', function () {
      if (!confirm('Set ' + area.name + ' to ' + s.id + '? Full area-days start again from zero in the new stage.')) return;
      var r = placeAt(area.id, s.id, areaDays(), todayISO());
      closeSheet();
      toast(r.ok ? area.name + ' is now at ' + s.id + '.' : r.why);
      if (onDone) onDone();
    });
    list.appendChild(b);
  });
  openSheet('Set the stage yourself', 'Where are you now in ' + area.name + '? Each stage shows its first standard.', [list]);
}

/* A review that is due, on Today: one line to tap. */
function reviewCards(today, days) {
  var out = [];
  areaList().forEach(function (area) {
    var prog = stageProgress(area, days);
    if (!prog.due) return;
    var block = levelUpBlock(area, today);
    out.push(el('a', { class: 'card review-card', href: '#/review/' + area.id }, [
      el('div', { class: 'card-top' }, [
        el('span', { class: 'card-title', text: 'Review due · ' + area.name + ' ' + prog.stage.id }),
        el('span', { class: 'chev', text: '›' })
      ]),
      el('div', { class: 'card-sub', text: prog.full + ' full days in ' + prog.stage.id + '. Ready to move on?' + (block ? ' Waiting: ' + block + '.' : '') })
    ]));
  });
  return out;
}

/* --- units (on the Progress tab) --- */

/* The chips are mid-page: change one and stay where you are. */
function repaintProgressInPlace() {
  var y = window.scrollY || 0;
  renderProgress();
  window.scrollTo(0, y);
}

function unitsSection() {
  var row = el('div', { class: 'sit-row' }, [el('span', { class: 'sit-label', text: 'Show weights in:' })]);
  ['kg', 'lb'].forEach(function (u) {
    var on = unitName() === u;
    var b = el('button', { class: 'sit-chip' + (on ? ' is-on' : ''), type: 'button', 'aria-pressed': String(on), text: u });
    b.addEventListener('click', function () { settings.units = u; saveSettings(); repaintProgressInPlace(); });
    row.appendChild(b);
  });
  return el('div', {}, [
    el('p', { class: 'section-label', text: 'Units' }), row,
    el('p', { class: 'hint', text: 'Changes loads in sessions, logged sets and charts. Everything is stored in kg, and baselines are entered in kg.' })
  ]);
}

/* --- sound (on the Progress tab) --- */

var SOUND_LABELS = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High', max: 'Max', dong: 'Double-dong', beeps: 'Beeps' };

/* A row of chips for one setting: tap one to choose it. `after` runs once it is saved. */
function soundRow(label, key, options, after) {
  var current = soundPrefs()[key];
  var row = el('div', { class: 'sit-row sound-row' }, [el('span', { class: 'sit-label', text: label })]);
  options.forEach(function (o) {
    var on = current === o.value;
    var b = el('button', { class: 'sit-chip' + (on ? ' is-on' : ''), type: 'button', 'aria-pressed': String(on), text: o.label });
    b.addEventListener('click', function () {
      setSound(key, o.value);
      if (after) after(o.value);
      repaintProgressInPlace();
    });
    row.appendChild(b);
  });
  return row;
}

function soundChoices(key) {
  return SOUND_CHOICES[key].map(function (v) { return { value: v, label: SOUND_LABELS[v] || (typeof v === 'number' ? v + ' s' : String(v)) }; });
}

function soundSection() {
  var onOff = [{ value: true, label: 'On' }, { value: false, label: 'Off' }];

  var hearSet = el('button', { class: 'btn', type: 'button', text: 'Hear the end of a set' });
  hearSet.addEventListener('click', function () { previewSound('work'); });
  var hearRest = el('button', { class: 'btn', type: 'button', text: 'Hear the end of a rest' });
  hearRest.addEventListener('click', function () { previewSound('rest'); });

  return el('div', {}, [
    el('p', { class: 'section-label', text: 'Sound' }),
    soundRow('Volume:', 'volume', soundChoices('volume'), function (v) {
      if (v !== 'off') previewCue('dong');                           /* the double-dong, at the level you just picked */
    }),
    soundRow('Ticks in the last seconds of a set:', 'workTicks', onOff),
    soundRow('Ticks before a rest ends:', 'restTicks', onOff),
    soundRow('Ticks start:', 'tickFrom', soundChoices('tickFrom')),
    soundRow('When a set ends:', 'endWork', [{ value: 'dong', label: 'Double-dong' }, { value: 'off', label: 'Silent' }]),
    soundRow('When a rest ends:', 'endRest', [{ value: 'beeps', label: 'Beeps' }, { value: 'dong', label: 'Double-dong' }, { value: 'off', label: 'Silent' }]),
    el('div', { class: 'sheet-actions sound-hear' }, [hearSet, hearRest]),
    el('p', { class: 'hint', text: 'A set ticks fast and high, a rest ticks slow and low (tick, tock), so you can tell them apart without looking. A short timer only ticks for its last half. Sounds play at the phone’s media volume, so turn that up as well.' })
  ]);
}

/* --- equipment you own (on the Progress tab) --- */

function equipmentSection() {
  if (!areaData) return null;
  var wrap = el('div', {}, [el('p', { class: 'section-label', text: 'Equipment you own' })]);
  var list = el('div', { class: 'kv kv-text' });

  equipmentList().forEach(function (q) {
    var owned = equipmentOwned(q.id);
    var b = el('button', { class: 'eq-toggle' + (owned ? ' is-on' : ''), type: 'button', 'aria-pressed': String(owned), text: owned ? 'Have' : 'Don’t have' });
    b.addEventListener('click', function () { setEquipment(q.id, !owned); renderProgress(); });
    list.appendChild(el('div', { class: 'kv-row eq-row' }, [el('span', { class: 'kv-key', text: q.label }), b]));
  });
  wrap.appendChild(list);

  var bells = el('div', { class: 'eq-bells' });
  bellsOwned().forEach(function (lb) {
    var chip = el('button', { class: 'sit-chip', type: 'button', 'aria-label': 'Remove the ' + lb + ' lb bell', text: lb + ' lb ×' });
    chip.addEventListener('click', function () { setBells(bellsOwned().filter(function (x) { return x !== lb; })); renderProgress(); });
    bells.appendChild(chip);
  });
  var input = el('input', { type: 'text', inputmode: 'numeric', id: 'bell-lb', placeholder: 'Add a bell, in lb' });
  var add = el('button', { class: 'btn', type: 'button', text: 'Add' });
  add.addEventListener('click', function () {
    var n = Math.round(Number(String(input.value).trim()));
    if (!(n > 0 && n <= 200)) { toast('A bell between 1 and 200 lb.'); return; }
    setBells(bellsOwned().concat([n]));
    renderProgress();
  });
  wrap.appendChild(el('p', { class: 'hint', text: 'Kettlebells you have, in lb (kg is shown beside the bell a stage needs):' }));
  wrap.appendChild(bells);
  wrap.appendChild(el('div', { class: 'sheet-actions', style: 'margin-top:8px' }, [input, add]));
  return wrap;
}

/* --- adding an area ---------------------------------------------------------- */

var ORDER_LABEL = { power: 'Power (jumps, sprints)', skill: 'Skill (technique work)', strength: 'Strength', mobility: 'Mobility', kettlebell: 'Kettlebell or conditioning' };
var LOAD_LABEL = { low: 'Light on the body', medium: 'Moderate', high: 'Hard on the body' };

/* The entry point: three ways to add, and where to read about them. */
function openAddAreaSheet() {
  var list = el('div', { class: 'picklist' });
  [['Track something simple', 'A run, climbing, mobility: a target and a time, no ladder.', openTrackForm],
   ['Import an area pack', 'A whole ladder, from one JSON file. It is checked before it is added.', pickPackFile],
   ['How adding areas works', 'The pack format, with a starter you can copy.', function () { closeSheet(); location.hash = '#/howto'; }]
  ].forEach(function (o) {
    var b = el('button', { class: 'card pick', type: 'button' }, [el('div', { class: 'card-title', text: o[0] }), el('div', { class: 'card-sub', text: o[1] })]);
    b.addEventListener('click', o[2]);
    list.appendChild(b);
  });
  openSheet('Add an area', 'The eight stay as they are. What you add joins the menu, the week and the verdicts.', [list]);
}

/* Something you only want to track. */
function openTrackForm() {
  var draft = { name: '', perWeek: 3, minutes: 30, order: 'strength', load: 'medium', guardedBy: [] };
  var problem = el('p', { class: 'sheet-error', role: 'alert' });

  var name = el('input', { type: 'text', id: 'f-area-name', placeholder: 'Morning run' });
  var minutes = el('input', { type: 'text', inputmode: 'numeric', id: 'f-area-min', placeholder: '30' });
  minutes.value = String(draft.minutes);
  var order = el('select', { id: 'f-area-order' }, areaData.rules.dayOrder.map(function (o) { return el('option', { value: o, text: ORDER_LABEL[o] || o }); }));
  order.value = draft.order;
  var load = el('select', { id: 'f-area-load' }, ['low', 'medium', 'high'].map(function (l) { return el('option', { value: l, text: LOAD_LABEL[l] }); }));
  load.value = draft.load;

  var days = el('div', { class: 'sit-row' }, [el('span', { class: 'sit-label', text: 'Days a week:' })]);
  [1, 2, 3, 4, 5, 6, 7].forEach(function (n) {
    var b = el('button', { class: 'sit-chip' + (n === draft.perWeek ? ' is-on' : ''), type: 'button', 'aria-pressed': String(n === draft.perWeek), text: String(n) });
    b.addEventListener('click', function () {
      draft.perWeek = n;
      Array.prototype.forEach.call(days.querySelectorAll('.sit-chip'), function (c) { c.classList.remove('is-on'); c.setAttribute('aria-pressed', 'false'); });
      b.classList.add('is-on'); b.setAttribute('aria-pressed', 'true');
    });
    days.appendChild(b);
  });

  var hurt = el('div', { class: 'eq-bells' });
  areas().forEach(function (id) {
    var b = el('button', { class: 'sit-chip', type: 'button', 'aria-pressed': 'false', text: bodyLabel(id) });
    b.addEventListener('click', function () {
      var i = draft.guardedBy.indexOf(id);
      if (i >= 0) draft.guardedBy.splice(i, 1); else draft.guardedBy.push(id);
      var on = i < 0;
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on));
    });
    hurt.appendChild(b);
  });

  var add = el('button', { class: 'btn btn-go btn-block', type: 'button', text: 'Add it' });
  add.addEventListener('click', function () {
    var r = addCustomArea(trackedAreaFrom({ name: name.value, perWeek: draft.perWeek, minutes: minutes.value, order: order.value, load: load.value, guardedBy: draft.guardedBy }));
    if (!r.ok) { problem.textContent = r.errors.slice(0, 3).join(' '); return; }
    closeSheet();
    toast(r.area.name + ' added.');
    location.hash = '#/areas/' + r.area.id;
  });

  openSheet('Track something', 'It gets a target, a time, a place on the menu and a verdict. No ladder.', [
    field('Name', name), days, field('Minutes', minutes), field('Kind', order), field('Load', load),
    el('p', { class: 'hint', text: 'Could it hurt anything? A red light on these pauses it:' }), hurt, problem, add
  ]);
}

/* An area pack: pick the file, check it, show what is in it. */
function pickPackFile() {
  var input = el('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden' });
  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 512 * 1024) { showPackProblems(['That file is too big for an area pack (over 500 KB).']); return; }
    var reader = new FileReader();
    reader.onerror = function () { showPackProblems(['Could not read that file.']); };
    reader.onload = function () { reviewPack(String(reader.result || '')); };
    reader.readAsText(file);
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(function () { input.remove(); }, 60000);
}

function showPackProblems(errors, warnings) {
  var shown = errors.slice(0, 10);
  var nodes = [el('ul', { class: 'pack-list is-bad' }, shown.map(function (e) { return el('li', { text: e }); }))];
  if (errors.length > shown.length) nodes.push(el('p', { class: 'hint', text: 'And ' + (errors.length - shown.length) + ' more.' }));
  nodes.push(el('a', { class: 'rv-link', href: '#/howto', text: 'How an area pack is written' }));
  openSheet('That pack cannot be added', 'Nothing was changed. Fix these and try again.', nodes);
}

function reviewPack(text) {
  var parsed;
  try { parsed = JSON.parse(text); } catch (err) { showPackProblems(['That file is not valid JSON.']); return; }
  var r = validateAreaPack(parsed, { taken: areaList().map(function (a) { return a.id; }) });
  if (!r.ok) { showPackProblems(r.errors); return; }

  var a = r.area;
  var exercises = (a.stages || []).reduce(function (n, s) { return n + s.exercises.length; }, 0);
  var kv = el('div', { class: 'kv kv-text' });
  [['Name', a.name], ['Goal', a.goal], ['Stages', (a.stages || []).length + ' (' + exercises + ' exercises)'],
   ['Days a week', a.perWeek.min + ' · ' + a.perWeek.target + ' · ' + a.perWeek.max], ['A session takes', 'about ' + a.minutes + ' min'],
   ['Guarded by', a.guardedBy.length ? a.guardedBy.map(bodyLabel).join(', ') : 'nothing']
  ].forEach(function (row) {
    kv.appendChild(el('div', { class: 'kv-row' }, [el('span', { class: 'kv-key', text: row[0] }), el('span', { class: 'kv-val', text: row[1] })]));
  });
  var nodes = [kv];
  if (r.warnings.length) nodes.push(el('ul', { class: 'pack-list' }, r.warnings.slice(0, 6).map(function (w) { return el('li', { text: w }); })));

  var add = el('button', { class: 'btn btn-go btn-block', type: 'button', text: 'Add ' + a.name });
  add.addEventListener('click', function () {
    var done = addCustomArea(parsed);
    if (!done.ok) { showPackProblems(done.errors); return; }
    closeSheet();
    toast(done.area.name + ' added.');
    location.hash = '#/areas/' + done.area.id;
  });
  nodes.push(add);
  openSheet('Add this area?', r.warnings.length ? 'It passes. Worth a look first:' : 'It passes every check.', nodes);
}

/* --- how adding areas works --------------------------------------------------------- */

/* A small pack that passes every check, for copying and changing. The example file in
   docs/ is this, and a test keeps the two the same, so it never goes stale. */
function starterPack() {
  return {
    id: 'rowing',
    name: 'Rowing technique',
    goal: 'A smooth 2 km row at a steady pace.',
    perWeek: { min: 2, target: 3, max: 4 },
    minGapDays: 1,
    minutes: 25,
    load: 'medium',
    order: 'strength',
    guardedBy: ['lowerBack'],
    stages: [
      {
        id: 'R1', name: 'Catch and drive', askAfter: 6,
        work: 'Rowing drills and short pieces.',
        ready: ['5 x 500 m at a steady pace'],
        equipment: ['mat'],
        exercises: [
          { id: 'drill', name: 'Pause drill', sets: 3, reps: '10', restSec: 45, load: { type: 'bodyweight' }, cue: 'Legs, body, arms.' },
          { id: 'piece', name: 'Steady piece', sets: 4, reps: '4 min', restSec: 90, load: { type: 'text', text: 'Easy pace' }, cue: 'Same stroke rate.' }
        ]
      },
      {
        id: 'R2', name: 'Steady state', askAfter: 8, goal: true,
        work: 'Longer steady rows.',
        ready: ['2 km without stopping'],
        exercises: [
          { id: 'steady', name: 'Steady row', sets: 3, reps: '6 min', restSec: 90, load: { type: 'text', text: 'Easy pace' }, cue: 'Relax the shoulders.' }
        ]
      }
    ]
  };
}

function renderHowTo() {
  if (!areaData) return areasLoading();
  var rules = areaData.rules;
  var starter = JSON.stringify(starterPack(), null, 2);

  function h(text) { return el('p', { class: 'section-label', text: text }); }
  function p(text) { return el('p', { class: 'hint', text: text }); }
  function list(items) { return el('ul', { class: 'howto-list' }, items.map(function (x) { return el('li', { text: x }); })); }

  var copy = el('button', { class: 'btn btn-block', type: 'button', text: 'Copy the starter pack' });
  copy.addEventListener('click', function () {
    var done = function () { toast('Copied. Paste it into a text editor, change it, save it as a .json file.'); };
    var fail = function () { toast('Could not copy. Select the text below and copy it.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(starter).then(done, fail);
    else fail();
  });

  setView('Adding areas', '', [
    el('a', { class: 'back', href: '#/areas', text: '‹ Areas' }),
    h('Three ways'),
    list([
      'Train an area that was not suggested today: open Today, find it under "Add to this sitting", tap Add.',
      'Track something with no ladder (a run, climbing, mobility): Areas, "+ Add an area", "Track something simple". It gets a target, a time and a place on the menu and in the week and the verdicts.',
      'Add a whole ladder: write an area pack, a single JSON file, and import it from the same sheet. It is checked first, and nothing changes if it does not pass.'
    ]),
    h('The pack'),
    p('One area per file. The area has a few settings and a list of stages; each stage says what it trains, the standard you attest to before moving up, and its exercises. Start from this one, which passes every check:'),
    copy,
    el('pre', { class: 'howto-code', tabindex: '0' }, [starter]),
    h('What goes where'),
    list([
      'Area: id (lowercase, 2 to 24 characters), name, goal, perWeek { min, target, max } in days (1 to 7), minGapDays (days between sessions), minutes, load (low, medium or high), order, guardedBy, stages. Optional: short (up to 13 characters), priority, sessionTypes.',
      'Stage: id, name, work (what it trains), ready (the standard, a list of clear sentences), exercises, and askAfter (full area-days before the review, at least one week of the area). Optional: equipment, goal (one stage), optional, draft, requires, bells, maxContacts.',
      'Exercise: id (lowercase slug), name, sets, reps (text: "5", "30 s", "8 / side"), restSec, load { type }, and optionally tempo, cue, note. load.type is one of bodyweight, fixedKg, pct5RM, pctBW, text, none.',
      'Every stage needs at least one exercise, so a move up never lands on an empty stage.'
    ]),
    h('Values you can use'),
    list([
      'order: ' + rules.dayOrder.join(', ') + '. It sets where the area goes in a day.',
      'guardedBy: ' + rules.bodyAreas.filter(function (b) { return b.collected; }).map(function (b) { return b.id; }).join(', ') + '. A red light on one of these pauses the area.',
      'equipment: ' + rules.equipment.map(function (q) { return q.id; }).join(', ') + '.'
    ]),
    h('Good to know'),
    list([
      'What you add is kept with your data and is in the backup. Remove it from its own page; the days you logged stay in your history and come back if you add it again.',
      'A rough clock compares each stage’s exercises with the minutes you gave and mentions it if they are far apart. It never blocks.',
      'The eight areas that come with the app are not changed by anything you add.'
    ]),
    el('p', { class: 'buildline', text: 'Build ' + BUILD })
  ]);
  window.scrollTo(0, 0);
}

/* One of your own that no longer loads, with why, and a way to clear it. */
function skippedAreasNote() {
  var skipped = (areaData && areaData.skipped) || [];
  if (!skipped.length) return null;
  return el('div', {}, [
    el('p', { class: 'section-label', text: 'Could not load' })
  ].concat(skipped.map(function (s) {
    var drop = el('button', { class: 'linkbtn', type: 'button', text: 'Remove' });
    drop.addEventListener('click', function () {
      if (!confirm('Remove "' + s.id + '"? It cannot be loaded as it is.')) return;
      removeCustomArea(s.id);
      renderAreas();
    });
    return el('div', { class: 'card hist' }, [
      el('div', { class: 'card-top' }, [el('span', { class: 'card-title', text: s.id }), drop]),
      el('div', { class: 'card-sub', text: s.errors.slice(0, 2).join(' ') })
    ]);
  })));
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
  ensureWeekFit(start, days);        /* the target shown here is the one the week is judged by */
  var w = areaWeek(area, start, today, days);
  var prog = stageProgress(area, days);

  var nodes = [
    el('a', { class: 'back', href: '#/areas', text: '‹ Areas' }),
    el('div', { class: 'session-head' }, [
      el('h2', { text: area.name }),
      el('div', { class: 'meta', text: area.goal })
    ])
  ];

  var ladderKv = el('div', { class: 'kv kv-text' });
  var pace = paceText(paceFor(area, today, days));
  [['Stage', prog.stage.id + ' · ' + prog.stage.name],
   ['Full days here', prog.full + (prog.askAfter ? ' of ' + prog.askAfter : '')],
   ['Where that is', phaseText(prog)]].concat(pace ? [['Review', pace]] : []).forEach(function (r) {
    ladderKv.appendChild(el('div', { class: 'kv-row' }, [el('span', { class: 'kv-key', text: r[0] }), el('span', { class: 'kv-val', text: r[1] })]));
  });
  var pick = el('button', { class: 'btn btn-quiet', type: 'button', text: 'Set the stage yourself' });
  pick.addEventListener('click', function () { openStagePicker(area, function () { renderAreaDetail(id); }); });
  if (area.track) {
    nodes.push(el('p', { class: 'hint', text: 'Tracked: it has a target and a time, and a place on the menu, but no ladder. ' + prog.full + ' full days so far.' }));
  } else {
    nodes.push(el('p', { class: 'section-label', text: 'Where you are on the ladder' }), ladderKv,
      el('div', { class: 'sheet-actions', style: 'margin-top:0' }, [
        el('a', { class: prog.due ? 'btn btn-go' : 'btn', href: '#/review/' + area.id, text: prog.due ? 'Open the review' : 'Review now' }),
        pick
      ]));
    var decided = decisionList(area);
    if (decided) nodes.push(decided);
  }

  var fb = areaFeedback(area, today, days);
  var last = fb.weeks.length ? fb.weeks[fb.weeks.length - 1] : null;
  var rows = [
    ['This week', w.touched + ' of ' + w.target + (w.status.label ? ' · ' + w.status.label : '')],
    ['How it is going', fb.label + '. ' + fb.why],
    ['Last weeks', fb.weeks.length ? fb.weeks.map(function (x) { return x.touched + '/' + x.target; }).join('  ') : 'nothing yet'],
    ['Completion', last && last.completion !== null ? last.completion + '% of sets last week' + (fb.mostlyPartial ? ' · mostly partial lately' : '') : 'no sets last week'],
    ['Days a week', w.min + ' · ' + w.target + ' · ' + w.max + '  (min · target · max)'],
    ['Days apart', 'at least ' + w.gap],
    ['A session takes', 'about ' + area.minutes + ' min'],
    ['Load', area.load],
    ['Guarded by', area.guardedBy.map(bodyLabel).join(', ')]
  ];
  if (w.ramp) rows.splice(3, 0, ['Target this week', w.target + ' (ramp-in: the minimum for the first ' + areaData.rules.defaults.rampWeeks + ' weeks)']);
  else if (w.target < w.nominal) rows.splice(3, 0, ['Target this week', w.target + ' (' + w.nominal + ' nominal, fitted to your time)']);

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

  if (!area.track) {
    nodes.push(el('p', { class: 'section-label', text: 'Ladder' }));
    nodes.push(ladderRow(area, prog.stage.id));
    area.stages.forEach(function (s) { nodes.push(stageCard(area, s, prog)); });
  }

  if (area.custom) {
    var drop = el('button', { class: 'btn btn-quiet btn-block', type: 'button', text: 'Remove this area' });
    drop.addEventListener('click', function () {
      if (!confirm('Remove ' + area.name + '? Its days stay in your history and come back if you add it again.')) return;
      removeCustomArea(area.id);
      toast(area.name + ' removed.');
      location.hash = '#/areas';
    });
    nodes.push(drop);
  }

  nodes.push(el('p', { class: 'buildline', text: 'Build ' + BUILD }));
  setView(area.short, area.track ? 'Tracked' : 'Stage ' + prog.stage.id, nodes);
  window.scrollTo(0, 0);
}

/* Today, Areas, the review and the runner draw from the area data. The check-in asks
   about seven body areas instead of four once it is in, and Progress gains the
   equipment card. Only Plan works without it. An empty hash is Today. */
function routeNeedsAreas(hash) {
  var tab = String(hash || '').replace(/^#\/?/, '').split('/')[0] || 'today';
  return tab === 'today' || tab === 'areas' || tab === 'run' || tab === 'checkin' || tab === 'review' || tab === 'progress' || tab === 'howto';
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
  else if (tab === 'review' && parts[1]) renderReview(parts[1]);
  else if (tab === 'howto') renderHowTo();
  else if (tab === 'areas' && parts[1]) renderAreaDetail(parts[1]);
  else if (tab === 'areas') renderAreas();
  else if (tab === 'session') renderSession(parts[1]);
  else if (tab === 'today') { renderToday(); window.scrollTo(0, 0); }
  else if (tab === 'checkin') renderCheckIn();
  else if (tab === 'progress') renderProgress();
  else {
    renderNotFound('Nothing at "' + hash + '".');
  }

  markTab(tab === 'session' ? 'plan' : (tab === 'review' || tab === 'howto') ? 'areas' : tab);
  paintTabBadge();
  view().focus({ preventScroll: true });
}

/* A dot on the Progress tab when a backup is overdue or a set looks like a typo —
   the nag has to be visible from the screens you actually use, not only from
   the one it is on. */
function paintTabBadge() {
  mark('progress', exportOverdue() || suspectSets().length > 0);
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
  loadCustomAreas();
  mergeCustomAreas();
  areaLoad = 'ready';
}).catch(function () {
  areaLoad = 'failed';
}).then(function () {
  /* The plan usually arrives first, so the screen drawn then said "loading". */
  if (plan && routeNeedsAreas(location.hash)) route();
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
  loadWeekFits();
  loadProgress();
  loadDecisions();
  restoreTimer();
  scheduleReminder();
  if (!location.hash) location.replace('#/today');
  window.addEventListener('hashchange', route);
  route();
}).catch(function () {
  renderError('Could not load the plan. Connect once so it can be cached, then it works offline.');
});
