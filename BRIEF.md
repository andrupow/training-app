# Build brief — training log PWA

A personal training app for one user, one plan, one 14-week block. Android phone,
installed to the home screen. Simplicity beats everything.

---

## 1. What this is for

Three features justify building this instead of using Hevy or Strong. Everything
else is secondary and should be cut if it costs time.

**1. The load calculator.** Every load in the plan is a percentage of a calibrated
baseline — three different rules (`pct5RM`, `pctBW`, `fixedKg`) against four
different baselines. Without the app, working out that "heel raise +20% BW" means
15.6 kg happens five times a day, five days a week, and again after every
recalibration. **This is the feature.**

**2. The deferred stiffness prompt.** The plan's autoregulation keys off
*next-morning* stiffness, not how a set felt. So the morning check-in is a
separate event from the session log, with its own screen and its own notification.
No off-the-shelf app does this.

**3. A traffic light that gates progression.** The plan says "amber means hold the
load another week". The app enforces it: when week N is amber for a body area,
week N+1 shows `HOLD` on that track's exercises and displays week N's load instead
of the scheduled increase. This is what turns a document into a system.

---

## 2. Tech decisions — already made, don't relitigate

| Decision | Choice | Why |
|---|---|---|
| Framework | **None.** Vanilla HTML/CSS/JS | No build step, no npm, no node_modules. Edit a file, refresh. |
| Files | ~5 total | `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest` |
| Storage | **localStorage** | Total data is well under 1 MB. IndexedDB is overkill here. |
| Data | `data/plan.json`, fetched once and cached | Already built. Do not regenerate it. |
| Hosting | **GitHub Pages** | Free, permanent HTTPS URL. PWA install requires HTTPS. |
| Fallback hosting | Netlify Drop | Drag the folder onto `netlify.com/drop` if git is a hassle. |
| Target | Chrome on Android | Full PWA install, real notifications, persistent storage. |
| Dark mode | `prefers-color-scheme` only | No toggle. |

Single-file is fine too if it stays readable. Don't add a bundler, a framework, a
CSS library, or TypeScript.

---

## 3. Data model

### Already in `data/plan.json` (read-only)

```
meta              title, dates, priority order, override rule
baselineFields[]  the five fields to collect at calibration
trafficLight      areas, areaToTracks mapping, the three rules
checkpoints[]     six dated checkpoints incl. the two recalibration dates
weeks[]           14 weeks: id, label, dates, start, block, muPhase, deload
sessions[]        73 sessions, each with:
                    id, week, day, date, name, tag, deload, exercises[]
                  exercise:
                    id, name, sets, reps, tempo, restSec, cue, load, track?, note?
```

`tag` is `mu` (muscle-up session), `ten` (tendon/strength), `test`, or `rest`.
Use it for colour-coding.

`track` appears only on exercises that progress week to week
(`pullup`, `dips`, `heelRaise`, `pogo`, `nordic`, `hinge`, `sprint`, `kbPress`).
It's the join key for the traffic light and the charts.

### Load rules — implement exactly this

```js
{ type: 'pct5RM',     value: 0.72 }  // 0.72 × pullup5RMAddedKg  → "+X kg"
{ type: 'pctBW',      value: 0.20 }  // 0.20 × bodyweightKg      → "+X kg"
{ type: 'fixedKg',    value: 5 }     //                          → "+5 kg"
{ type: 'bodyweight' }               //                          → "Bodyweight"
{ type: 'text',       text: '...' }  //                          → "Heavy band"
{ type: 'none' }                     //                          → "—"
```

Round computed kilos to the nearest **1.25 kg** (smallest plate pair). Resolve
against the most recent `baselines` entry whose date is on or before the session
date — never the newest one unconditionally, or past sessions will silently
rewrite themselves.

If baselines are missing, show `— set baselines` as the load and link to that
screen. Never show `NaN`.

### Written by the app (localStorage)

```
baselines[]   { date, bodyweightKg, pullup5RMAddedKg, maxCleanDips,
                maxSLHeelRaises, nordicBreakPoint }
setLogs[]     { sessionId, exerciseId, setIdx, done, loadKg?, reps?, rpe?, ts }
checkIns[]    { date, pain: {elbow, shoulder, achilles, hamstring},
                stiffness: 'none'|'under30'|'30to60'|'over60', note }
settings      { installedAt, lastExport, notifHour }
```

One key per collection, JSON-serialised. Wrap every read and write in try/catch —
storage can throw.

---

## 4. Screens

Four tabs, bottom bar, thumb-reachable.

### Today (default)

The session for today's date, or the next upcoming one with a "Next session:
Monday" header. Rest days show what's next and nothing else.

Each exercise is a card:

```
Weighted chest-to-bar pull-up                    HOLD
5 × 4    ·    +18.75 kg    ·    rest 3:30
2s up / 4s down
[1] [2] [3] [4] [5]
The 4-second lower is the whole point.
```

- Set chips: tap = done, tap again = undone. That's the whole interaction — you
  are sweaty, one-handed, and between sets.
- Long-press a chip to enter actual load/reps/RPE if they differed.
- Completing a set auto-starts the rest timer.
- Deload weeks get a banner. `note` fields render as a callout.
- `HOLD` badge when the traffic light is gating that track.

### Check-in

Four pain sliders 0–10 (elbow, shoulder, Achilles, hamstring), one stiffness
picker (none / under 30 min / 30–60 min / over 60 min), one note field.

Shows the resulting verdict immediately, in the plan's own words — for amber:
*"Hold the current load another full week. No progression. Keep the volume."*

Prompt via a local notification around 08:00. Ask for permission after the first
logged session, not on first launch.

### Plan

Read-only browser: 14 weeks → 5 days → session detail. Same card rendering as
Today. Checkpoints marked. This is the "review the plan on my phone" requirement
and it's Milestone 1 because it's useful before any logging exists.

### Progress

- Baselines editor. "Recalibrate" appends a new dated row, never edits the old
  one — the history is what makes past sessions resolve correctly.
- A banner when a checkpoint recalibration is due (6 Nov, 4 Dec).
- Simple line charts: load by week per track.
- **Export / import JSON.** Both directions. See risks.

---

## 5. Traffic light logic

```
worst pain across the four areas, plus stiffness:

green  maxPain <= 3  AND stiffness in (none, under30)
amber  maxPain 4-5   OR  stiffness == 30to60
red    maxPain > 5   OR  stiffness == over60
       OR pain in one area rising across 3 consecutive check-ins
```

Per *area*, not globally. Map to tracks with `trafficLight.areaToTracks`:

```
elbow     → pullup, dips
shoulder  → dips, kbPress
achilles  → heelRaise, pogo
hamstring → nordic, hinge, sprint
```

If any check-in during week N is amber for an area, every exercise in week N+1
whose `track` is in that area's list shows `HOLD` and displays **week N's**
resolved load.

Red shows a full-width banner with the red-light protocol text and suppresses
that track's exercises entirely for 7 days.

Store the verdict as *derived* state, recomputed from `checkIns` on load — never
as a stored input. A corrected pain entry should fix next week automatically.

**Special case:** any amber on `elbow` holds the `pullup` track regardless of
anything else. Hardcode it. The plan is explicit that this is the one tendon that
can end the December muscle-up attempt.

---

## 6. Milestones

Ship each one before starting the next. Each is independently useful.

### Milestone 1 — shell, install, plan browser
`index.html` + `style.css` + `app.js` + `manifest.webmanifest` + `sw.js` + icons.
Loads `plan.json`, renders the Plan tab, installs to the Android home screen and
works offline. **No logging yet.**
→ *Useful on day one: the plan in your pocket.*

### Milestone 2 — Today + set logging
Today tab, set chips, localStorage persistence. Loads still shown as raw rules
(`+20% BW`) since baselines don't exist yet.
→ *Now it replaces the CSV.*

### Milestone 3 — baselines + load calculator
Baselines screen, dated history, the resolution logic, rounding. **This is the
feature.** Must work before **Friday 6 November**.

### Milestone 4 — rest timer
Auto-start on set completion, audible at zero, survives screen lock. Rests run
3–4 minutes and you will not time them by feel.

### Milestone 5 — check-in + traffic light
Check-in screen, verdict display, 08:00 notification.

### Milestone 6 — HOLD gating
Wire the verdict into Today and Plan rendering.

### Milestone 7 — export / import
JSON down and up. Do this before you have data worth losing — realistically,
alongside Milestone 3.

### Milestone 8 — charts
Load by week per track. Plain `<canvas>` or inline SVG; no chart library.

---

## 7. Do not build

Auth. Accounts. A backend. A plan editor. A general exercise library. Social
anything. Apple/Google Health integration. A dark-mode toggle. Offline sync
across devices. Settings beyond the notification hour.

**Hardcode the plan.** One user, one block, 14 weeks. If you want a real training
app afterwards, that's a different project built on what you learned here.

---

## 8. Risks

**Data loss.** localStorage gets cleared under Android storage pressure, and
losing eight weeks of logs would genuinely hurt. Mitigations, in order: build
export early (Milestone 7 alongside 3), show a "last exported N days ago" nag
after 7 days, and keep the CSVs as a paper backup. If this gets annoying, a
Google Sheet behind a form POST is a 20-line backend — but only if it proves
necessary.

**Date handling.** Sessions are dated `YYYY-MM-DD` in UTC. Compare date strings,
don't construct `Date` objects from them and compare timestamps — you'll get
off-by-one on either side of midnight.

**Service worker caching.** The classic PWA trap: you ship a fix and the phone
keeps serving the old version. Version the cache name, and `skipWaiting()` +
`clients.claim()` on activate. Add a visible build number somewhere so you can
tell what's actually running.

**Scope creep into charts.** Milestone 8 is the fun one and the least useful.
Don't do it before Milestone 5.
