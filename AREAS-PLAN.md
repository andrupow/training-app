# Areas, stages and the daily menu — draft v4 for review

Status: **draft, nothing in the app is implemented.** Numbers marked
*(placeholder)* are mine, not sourced; change them freely. Section 13 lists the
last things I need from you.

---

## 1. What changed

Earlier versions: v1 had a fixed 7-session rotation; v2 replaced it with a daily
recommender, one area on one day as the unit, and weekly tracking; v3 added
plyometrics, time-fitted targets and bells in lb.

**This version (v4), from your last answers**
- **Plyometrics goal = vertical jump**, measured by wall-touch. Y1 starts with a
  baseline test; you set the target in cm after seeing it.
- **Achilles stays in the check-in** as part of plyometrics.
- **Time-fitted targets approved:** kettlebell 3 (nominal 5), Nordic 3 in N1–N2.
- **Kettlebell target bell: 50 kg.** The ladder now runs to it. One check on units
  in section 13.
- **Up to 3 sittings in a day**, each with its own time and menu.
- **The week view shows what was done, partial and skipped**, per area and per
  day (section 6, and a rendered mock in `prototype/week-mock.html`).

---

## 2. The model on one page

| Concept | What it is | Lives in |
|---|---|---|
| **Area** | Something you are getting better at: goal, weekly targets, spacing rules. | `data/areas/<id>.json` |
| **Stage** | A rung on an area's ladder: exercises, the "ready when" standard, sessions before the app asks, equipment, optional advisory prerequisites. | inside the area file |
| **Sitting** | One training sitting inside a day (up to 3), with its own minutes and menu. | `dayPlans` |
| **Area-day** | One area on one date, however many sittings it took. Partial allowed. The unit of tracking. Its content is frozen once you log it. | logs + a small `areaDays` record |
| **Day plan** | What each sitting's menu was, saved when it is first shown and updated when you edit it. This is what lets the app say **skipped**. | `dayPlans` |
| **Progress** | Per area: current stage, full area-days in it, decision history. | `progress`, `decisions` |
| **Week stats** | Days trained per area per week, derived from logs and day plans. Never stored. | computed |
| **Equipment** | What you own (bells 15 lb and 25 lb, bar, bands, box…). Stages say what they need. | `settings` |
| **Rules** | Spacing, conflicts, shared budgets, time budget, thresholds. | `data/rules.json` |

No area-specific code anywhere: the recommender, week grid, verdicts and
level-up all read from the data.

---

## 3. A day: sittings, the menu and the recommender

```
Today · Thu 22 Oct        Sitting 1 of 1             time:  30  [45]  60  min
 [x] Muscle-up         M1   30 min   0/2 this week, 4 d since last
 [x] Backward bridge   B1   12 min   2/3 this week, 1 d since last
 [ ] Nordic curl       N1   10 min   too soon: trained yesterday, needs 2 days
 [ ] One-arm pull-up   O1   20 min   not with muscle-up: both load the elbow tendons
 [ ] Handstand push-up H1   20 min   not with muscle-up: shoulders and triceps
 [ ] Pistol · Kettlebell · Plyometrics      don't fit today's 45 min
 Total 42 min             [ Start ]  [ + Add area ]  [ + Another sitting today ]
```

Real output from `prototype/recommender-sim.js`, with stage labels added.

**Time and sittings**
- You pick how long you have (30 / 45 / 60 or a number). The app remembers a
  default per weekday.
- **Up to 3 sittings a day**, each with its own time and menu. Declare them at
  the start ("today: 30 + 30") so the planner can spread areas across them, or
  tap **Another sitting today** later: the new menu is recomputed from what you
  have already done.
- An area's block stays whole inside one sitting by default. You can also **split
  a block across sittings**: do half now and the rest later. It shows partial
  until the rest is logged, then becomes a full area-day.
- **The same area in two sittings of one day is allowed.** It counts once for the
  day, and only completing the block counts toward level-up. High-load areas
  show a warning, because tendons need the gap.
- Spacing and conflict rules are measured in **days**, so two sittings don't
  loosen them: a conflicting pair is still advised against on the same day.
- Adding minutes helps; reshaping the same minutes doesn't (section 5).
- Adding something over a sitting's time shows "+12 min over" instead of
  blocking it.

**What you can do**
- Untick anything, or tick something the app advised against. You get a warning,
  not a block.
- **Add area** puts any area on the menu, including paused ones. Section 8
  covers creating new ones.
- **Partial is fine:** finish early at any point. What you logged counts as a
  touched day, and the area-day shows as partial.
- **Log something done off-app:** pick the area and mark it.
- **Remove from today** takes a recommendation off the menu. One optional tap
  gives a reason (no time / tired / pain / other); it then shows as skipped.

**How the recommender decides** (deterministic, no learning, so you can always
see why):
1. **Exclude:** a guarding body area is red · already at the weekly max · too
   soon since the last session · a shared weekly budget is used up.
2. **Value each remaining area.** Highest when its weekly minimum is about to
   become impossible, then when the spacing to its target is tight, then how long
   since you last trained it, all weighted by your priority order.
3. **Pick the best combination that fits:** the highest total value that packs
   into the day's sittings, at most 4 areas, at most 2 high-load areas, and no
   conflicting pair. Eight areas means at most 256 combinations, so it is instant.
4. **Order** for doing: plyometrics and skill first → strength → mobility →
   kettlebell.
5. An area that has already hit its target is not recommended (you can still add
   it, up to the max).
6. Amber on a guarding body area keeps the area on the menu but flags **HOLD**
   (no load progression). Amber on the elbow holds muscle-up and one-arm pull-up
   together.

**No catch-up binge.** The week resets and the targets are caps.

**Rest.** No day is forced rest. When the rules allow little you get a light day
or "nothing recommended". Real recovery comes from spacing, maxes and the
per-stage deload.

---

## 4. The eight areas: weekly targets and rules

All numbers are placeholders. **Days/week** is min · target · max.

| # | Area | Days/week | Min days apart | ~Min | Load | Guarded by |
|---|---|---|---|---|---|---|
| a | Muscle-up | 2 · 2 · 3 | 2 | 30 | high | elbow, shoulder, wrist |
| b | Handstand push-up | 2 · 2 · 3 | 2 | 20 | high | shoulder, wrist |
| c | Backward bridge | 2 · 3 · 5 | 1 | 12 | low | lower back, shoulder, wrist |
| d | Pistol squat | 2 · 2 · 3 | 2 | 18 | medium | knee |
| e | Nordic curl | N1–N2: 2 · 3 · 3 · N3+: 1 · 2 · 3 | 2 · 3 | 10 | high | hamstring, knee |
| f | Kettlebell (S&S) | 2 · **3** · 6 (nominal 5) | 1 | 30 | medium | lower back, shoulder, hamstring |
| g | One-arm pull-up | 1 · 2 · 2 | 3 | 20 | high | elbow, shoulder |
| h | Plyometrics | 1 · 2 · 2 | 2 (3 in Y5–Y6) | 20 | high | **Achilles**, knee |

Priority is your list order a → h, with plyometrics last. Priority breaks ties
and decides what is trimmed first.

At these targets the week costs **372 min, about 53 min/day over 7 days.** At
minimums it costs 280 (40 min/day). With KB at its nominal 5 it would be 432.

**Rules between areas**

| Rule | Why |
|---|---|
| Muscle-up and one-arm pull-up never the same day | both load the elbow tendons |
| HSPU and muscle-up never the same day | shoulders and triceps |
| Plyometrics and Nordic never the same day | jumping on tired hamstrings |
| Nordic and kettlebell not the same day *unless one would otherwise miss its target* (Nordic first) | both load the hamstrings; a soft rule |
| Muscle-up + one-arm pull-up ≤ 4 days a week combined | shared elbow budget |
| ≤ 2 high-load areas in a day | spreads the stress across the week |

**Time-fitted targets.** Each week the app compares the minutes you have (your
usual per-weekday budgets) with what the targets cost. If they don't fit, it
trims the **lowest-priority** targets toward their minimums, one step at a time,
and tells you exactly what it trimmed and why. If even the minimums don't fit it
says so and offers to pause the lowest-priority areas. This is how kettlebell's
nominal 5 becomes 3 for you, and it climbs back toward 5 on weeks with 60-minute
days.

**Ramp-in:** an area's first 2 weeks run at its minimum, then rise to target.
*Not simulated; a trivial parameter.*

---

## 5. Does the rule set work? (simulation)

I implemented the rules as a pure function and simulated 10 weeks. Reproduce
with `node prototype/recommender-sim.js`. Your "mixed" week is **45 · 45 · 30 ·
45 · 45 · 60 · 60 minutes (330 a week)**, my reading of "30–60". Cells are average
days per week.

### Your question: Nordic 3 a week and kettlebell 5 a week

| Setup | Result |
|---|---|
| 60 min every day, **Nordic 3 + KB 5** | Everything at target except **KB 4 of 5**. 57 min/day |
| mixed 30–60, **Nordic 3 + KB 5** | **Muscle-up falls to 1 a week (min 2)**. Doesn't work |
| mixed 30–60, **Nordic 3 + KB 3** *(plan default)* | **Every minimum met:** muscle-up 2, HSPU 2, bridge 3, pistol 2, Nordic 3, KB 2, one-arm 1, plyometrics 1. 43 min/day |
| 60 min every day, Nordic 3 + KB 3 | **Every area at target.** 53 min/day |

So: **Nordic 3, yes. Kettlebell 5, not alongside everything else on 30–60
minute days.** Kettlebell 3 with Nordic 3 and all eight areas is what fits.

### Other results

| Setup | Result |
|---|---|
| 45 min every day | Pistol falls to 1 (min 2). **Doesn't fit.** A flat 45 is worse than your mixed week because 30-minute blocks (kettlebell, muscle-up) don't pack into 45-minute days. **Longer days matter more than the average.** |
| 30 min every day | Muscle-up 1, KB 1, plyometrics 0. Doesn't fit |
| 7 areas (no plyometrics), KB 5, mixed week | Every minimum met, KB 3 instead of 2. Plyometrics costs you mainly kettlebell frequency |
| Hamstring red for 5 days (60 min) | Nordic and KB resume the next week at target, with no make-up |

**What the simulation changed.** Version 1 reached only 1 Nordic a week
(spacing wasn't part of urgency) and let an urgent area blow the time budget.
Version 2 (greedy) left **HSPU, priority 2, below its minimum at 1 a week** while
Nordic ran at 2.7, because areas with long gaps look more urgent. Picking the best
combination each day fixed that. Honest limits: it assumes perfect compliance and no partial
days, and the minutes, targets and gaps are mine.

### Two sittings in a day

| Setup (plan defaults) | Result |
|---|---|
| mixed week, single sittings (330 min) | the baseline: every minimum met |
| **same 330 min**, weekends as two 30-min sittings | **HSPU falls to 1 (min 2).** Splitting the same minutes fits *worse*: each area's block stays whole inside a sitting |
| 45 every day + a 30-min second sitting on Sat and Sun (375 min) | one-arm pull-up reaches its target of 2; every minimum met |
| 30 every day + a second 30 on Wed, Sat, Sun (300 min) | muscle-up falls to 1. Doesn't fit |
| two 30-min sittings every day (420 min) | **every area at target** |

So **a second sitting helps when it adds minutes, not when it reshapes them.**
The exception is splitting an area's block across sittings, which the app allows
and the simulation doesn't model.

### How long each ladder takes

Earliest finish, if every review passes the first time. Real life will be longer.

| Area | Ladder (full area-days) | At target | In your mixed week |
|---|---|---|---|
| Muscle-up | 44 | 22 wk | 22 wk |
| HSPU | 50 | 25 wk | 25 wk |
| Backward bridge | 84 | 28 wk | 28 wk |
| Pistol | 58 | 29 wk | 29 wk |
| Nordic | 48 | ~21 wk | ~21 wk |
| Kettlebell (to 50 kg) | 104 | 35 wk | 52 wk |
| One-arm pull-up | 86 | 43 wk | **86 wk (~20 months)** |
| Plyometrics | 70 | 35 wk | **70 wk (~16 months)** |

The three lowest priorities (kettlebell, one-arm pull-up, plyometrics) run at
minimum frequency in a 30–60 minute week, which stretches their time, one-arm
pull-up and plyometrics most. If either matters more, move it up the list,
or run **focus blocks**: pause one or two areas for 8–12 weeks and the rest
speed up.

The app also shows a **feasibility line**: "Your minimums need 280 min a week;
you have 330. Tight."

---

## 6. Tracking: are you doing well?

**What counts**
- A **touched day** has ≥ 1 set logged for the area (partial included). It counts
  toward weekly frequency, as you asked.
- A **full area-day** is **every exercise of that area's block completed**,
  whatever else you did or skipped that day, and across however many sittings it
  took. Only full area-days count toward level-up. The threshold is a setting
  (`fullAreaPct`, default 100) in case 100% proves too strict.
- **Completion** = sets done ÷ prescribed on touched days.

**Done, partial, skipped: what the week view shows**
- **Planned** = on that day's saved menu. The menu is saved when it is first
  shown, and updated when you edit it.
- **● Done**: a full area-day. **◐ Partial**: something logged, block not finished.
- **✕ Skipped**: planned, and nothing logged by the end of that day. If you took
  it off the menu yourself, it is skipped with the reason you tapped.
- **○ Planned**: today or later, not yet done. **░ No plan recorded**: you never
  opened the app that day. It is shown as a hatch and **never as skipped**,
  because the app can't know.
- Unplanned extras you add and do are simply done.

```
This week · Mon 5 – Sun 11      M    T    W²   T    F    S    S     days  status
Muscle-up       M1              ●    ·    ◐    ✕    ·    ·    ·     1/2   Behind
Handstand PU    H1              ·    ●    ·    ·    ●    ·    ·     2/2   Done
Backward bridge B1              ●    ●    ●    ·    ·    ·    ·     3/3   Done
Pistol          P1              ·    ✕    ●    ✕    ·    ·    ·     1/2   Due
Nordic          N1              ·    ·    ·    ·    ·    ·    ·     0/3   Held: hamstring red
Kettlebell      K1              ◐    ·    ●    ·    ●    ○    ·     2/3   On track
One-arm         O1              ·    ·    ·    ✕    ·    ·    ·     0/2   Behind
Plyometrics     Y1              ░    ░    ·    ✕    ·    ·    ·     0/2   At risk
● done  ◐ partial  ✕ skipped  ○ planned  ░ no plan recorded  · nothing planned     W² = two sittings
```
(Illustrative. The real thing is the rendered mock in `prototype/week-mock.html`.)

**Underneath the grid, the week in one line**

```
Planned 14 · Done 6 · Partial 2 · Skipped 4        Skipped: Muscle-up (Thu), Pistol (Tue, Thu)
                                                    · One-arm (Thu), Plyometrics (Thu)
```

**Tap a day to see its sittings**

```
Wed 7 Oct · 2 sittings
  Sitting 1 · 30 min   ● Muscle-up (M1)        ● Backward bridge (B1)
  Sitting 2 · 30 min   ◐ Kettlebell (K1) 18/30   ● Pistol (P1)
```

**This week, per area**

| Status | Meaning |
|---|---|
| **Done** | target reached |
| **On track** | target still reachable with room to spare |
| **Due** | must train now to keep the target reachable |
| **Behind** | target no longer reachable, minimum still is |
| **At risk** | minimum no longer reachable |
| **Held** | blocked by a body-area light, or at max |

**Last 4 weeks, per area**

| Verdict | Rule *(placeholder)* |
|---|---|
| **Consistent** | hit target in ≥ 3 of the last 4 weeks |
| **Building** | met minimum in ≥ 3 of 4 |
| **Slipping** | missed minimum in 2 of the last 3 weeks |
| **Dormant** | nothing for 14+ days |
| **New** | under 2 weeks of history (ramp-in) |
| **Overreaching** | over max, or trained into amber/red twice in 2 weeks |

A **"mostly partial"** tag appears when completion stays under 70 % for two
weeks. Targets use the **time-fitted** values, so a trimmed target is judged
against what you could actually do. Repeated skips with the same reason ("no
time") also feed the time-fitted trim.

**Where it shows up**
- **Today:** a one-line strip ("5 of 8 areas on track") and at most two gentle
  nudges, e.g. "Pistol: skipped twice this week".
- **Areas tab:** the grid, the done/skipped line, verdict chips, the 4-week numbers.
- **Monday card:** last week's grid and what was skipped, in one screen.
- **Pace:** projected review date per area from your *actual* 4-week average.

The thresholds are data, not code.

---

## 7. Stage lifecycle and level-up

```
Build days ──► Deload block ──► Review prompt ──► Move up
(askAfter − d)  (d = the area's    │              Not yet ─► stay at the top prescription
                 weekly target,    │                          for 4 more full area-days, then ask
                 ~60% volume)      └──► Step back (always available)
```

- **`askAfter`** = full area-days of that area in the stage, deload block
  included. At a target of 2 a week, 12 is 6 weeks.
- The review shows: area-days done, the check-in colours for the guarding body
  areas, the stage's **standard** as a checklist you attest to (or run as a
  one-off check set), and a **preview of the next stage**: exercises, sets × reps
  × load from your baselines, what is new and what drops out, **the equipment it
  needs and whether you own it**, and any **advisory prerequisites** and whether
  they are met.
- **You always decide.** The app only asks. You can open the review yourself at
  any time.
- **Blocked, with the reason shown**, while a guarding body area is amber or red
  ("waiting: elbow amber").
- **Placement:** on first run you pick each area's starting stage with the same
  screen, working up from stage 1.

---

## 8. Adding areas (agreed)

| You want to… | How |
|---|---|
| Train an existing area today that wasn't recommended | **Add area** on the menu. One tap. |
| Track something with no ladder (a run, climbing, mobility) | **New track-only area in the app**: name, days/week target, minutes. It joins the menu, the week grid and the verdicts. No stages. |
| Add a full ladder like the eight above | **Import an area pack** (JSON) in the app, or drop a file in `data/areas/`. A validator checks it before it loads. |

Custom areas are stored with your data and included in the export. This relaxes
the BRIEF's "hardcode the plan": still no backend and no plan editor.

---

## 9. Area ladders

Ladders a–g were reviewed and approved; changes since are marked.

Columns: **Work** is what you do in the stage; **Ready when** is the standard you
attest to at review; **Ask** is `askAfter`, counted in that area's *full*
area-days in the stage, meaning every exercise of that area's block done,
whatever else happened that day (section 6).

Some areas alternate two session types inside a stage and the app picks the one
you did least recently: muscle-up (strength / skill), one-arm pull-up (heavy /
light technique), pistol (main / technique), HSPU (main / volume), bridge
(primer / strength).

### a) Muscle-up — target 2 days/week — goal: 1 strict unassisted bar muscle-up

These are your existing P1–P4, using the exercises already in `plan.json`.

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **M1 Dip foundation** | Dip negatives (3 s) → band-assisted parallel dips → bodyweight; sternum and strict pull-ups; false-grip hangs; hollow and arch holds; bar support | 8 clean parallel dips **and** 5 strict chest-to-bar pulls | 12 |
| **M2 Straight-bar crossing** | Straight-bar dip negatives (5 s), Russian dips, false-grip top holds, low-bar turnovers, speed chest-to-bar, L-sit chins, hanging toes-to-bar | 5 s straight-bar negative **and** 4 Russian dips | 12 |
| **M3 Banded integration** | Band-assisted muscle-ups (heavy → light band), 6 s negative muscle-ups, explosive and weighted dips, lockout and L-sit holds | Clean single with a light band | 12 |
| **M4 Micro-band → unassisted** | Micro-band singles, unassisted attempts, neural primers | **1 strict unassisted bar muscle-up** ★ | 8 |

### b) Handstand push-up — target 2 days/week — goal: 5 strict full-range wall HSPUs

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **H1 Pike foundation** | Pike push-ups, feet on floor → feet elevated; wrist prep; scapular shrugs; hollow hold | 3 × 10 feet-elevated pike push-ups, hips over hands | 8 |
| **H2 Wall handstand** | Chest-to-wall walk-ups and holds, line and breathing | 3 × 45 s chest-to-wall hold | 8 |
| **H3 Negatives** | Wall HSPU negatives, 5 s lowering to a head-touch on a folded mat | 3 × 5 negatives at 5 s | 10 |
| **H4 Partial range** | Wall HSPU to a mat stack, depth increasing as the stack shrinks (15 → 10 → 5 cm) | 3 × 6 at about 5 cm | 12 |
| **H5 Full range** | Wall HSPU, head to the floor, no mat | **5 consecutive strict reps** ★ | 12 |
| *H6 Optional* | Parallettes, deficit, freestanding holds | Outside the goal; only if you want it later | — |

### c) Full backward bridge from standing — target 3 days/week — goal: 3 free stand-to-stand bridges

The slowest ladder: the limiter is mobility and back control, not strength.

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **B1 Foundation** | Glute bridge → straight-leg bridge; thoracic extension over a roller; overhead reach against a wall, ribs down; wrist prep | 3 × 15 straight-leg bridges; arms overhead flat to the wall | 8 |
| **B2 Hands high** | Bridge with hands on a high bench, lowering the surface over time | 3 × 8 from about 40 cm, arms straight | 12 |
| **B3 Hands low** | Bridge from a low platform (20 → 10 cm) | 3 × 8 from ≤ 15 cm | 12 |
| **B4 Full bridge, floor** | Press up from lying to a full bridge, controlled | 3 × 8 and one 30 s hold, arms and legs straight | 12 |
| **B5 Wall walk-down** | Stand near a wall, walk the hands down into a bridge and back up | 2 × 8, smooth, no collapse | 12 |
| **B6 Closing the bridge** | From a full bridge, walk the hands toward the feet, shoulders over hands | 2 × 8 to ≤ 30 cm hands-to-feet | 12 |
| **B7 Stand-to-stand** | Stand → bridge → stand, with a wall assist first, then free | **3 consecutive free reps, no momentum drop** ★ | 16 |

### d) Pistol squat — target 2 days/week — goal: 5 strict pistols per leg

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **P1 Squat foundation** | Full-depth bodyweight squat, heels down; deep-squat holds; knee-to-wall ankle rocks; reverse lunges | 3 × 20 deep squats and 2 min accumulated deep hold | 8 |
| **P2 Single-leg strength** | Bulgarian split squat, step-ups, 3 s down | 3 × 10 per leg Bulgarian, bodyweight | 8 |
| **P3 Assisted pistol** | Full-depth pistol holding a pole, doorframe or rings | 3 × 8 per leg with fingertip-light assist | 10 |
| **P4 Box pistol** | Single-leg sit-to-stand, box lowered 60 → 45 → 35 cm | 3 × 6 per leg from 35 cm | 10 |
| **P5 Negatives** | Pistol negatives, 5 s to full depth, two legs to stand | 3 × 5 per leg at 5 s to full depth | 10 |
| **P6 Full pistol** | Counterweight held forward (2–5 kg) then dropped; heel flat | **5 strict reps per leg, no counterweight** ★ | 12 |

### e) Nordic curl — target 3 days/week in N1–N2, 2 from N3 — goal: 5 strict unassisted Nordics

Your existing band-assisted progression from `plan.json`, extended to a true Nordic.
**Changed:** you asked for 3 a week. The simulation shows 3 works (section 5), with the
stages overriding the area defaults: **N1–N2** (band-assisted, lower load) run
2 · 3 · 3 a week with 2 days between; **N3 onward** (unassisted eccentric, the
high-risk part) run 1 · 2 · 3 with 3 days between. Hamstring red or amber still
blocks it. Common injury-prevention protocols ramp from about 1 to 3 a week; that
is from memory.

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **N1 Heavy band** | Band-assisted Nordics, heavy band, 4 s lowering | 3 × 8, heavy band, 4 s down | 8 |
| **N2 Lighter band** | Medium → light band | 3 × 6, light band, 4 s down | 8 |
| **N3 Unassisted eccentric** | No band; 5 s lowering; hands catch at the floor and push back | 3 × 5, 5 s down | 10 |
| **N4 Push-back reduction** | As N3 with the push-back reduced to fingertips | 3 × 5 with a fingertip push | 10 |
| **N5 Full Nordic** | No hands: eccentric and concentric | **5 strict reps** ★ | 12 |
| *N6 Optional* | Weighted, +2.5 → +5 kg at the chest (the old feat) | 3 × 3 at 5 kg | — |

### f) Kettlebell strength (Simple & Sinister) — target 3 days/week (5 when time allows) — goal: 50 kg bell

Progression is by **bell weight**, as in the book. **You own 15 lb (6.8 kg) and
25 lb (11.3 kg).** The ladder is stored in kg and shown in lb beside it. Your
target bell is **50 kg**, which is above the book's own top standard.

Protocol, **as I remember it — please check against your copy**:
- 10 sets × 10 one-arm swings, alternating the hand each set
- 10 Turkish get-ups total, 5 per side, alternating
- interleaved: a get-up between swing sets
- Simple = 32 kg (70 lb), Sinister = 48 kg (106 lb), the book's standards for men

| Stage | Bell | Work | Ready when | Ask |
|---|---|---|---|---|
| **K1 Foundation** | 15 and 25 lb (**you have these**) | KB deadlift, goblet squat, two-hand swings 5 × 10, shoe get-up then 15 lb get-up; a light S&S-style session with what you own | 10 × 10 two-hand swings with a clean hinge; 5 get-ups per side with the 15 lb | 8 |
| **K2 S&S** | 16 kg · 35 lb — **buy** | Full S&S | Full protocol clean, not wrecked | 12 |
| **K3 S&S** | 20 kg · 44 lb | Full S&S | same | 12 |
| **K4 S&S** | 24 kg · 53 lb | Full S&S | same | 12 |
| **K5 S&S** | 28 kg · 62 lb | Full S&S | same | 12 |
| **K6 Simple** | 32 kg · 70 lb | Full S&S, plus the book's time standard | **Simple standard met** (milestone) | 12 |
| **K7 S&S** | 40 kg · 88 lb | Full S&S | Full protocol clean | 12 |
| **K8 Sinister** | 48 kg · 106 lb | Full S&S, plus the book's time standard | **Sinister standard met** (milestone) | 12 |
| **K9 Target bell** | 50 kg · 110 lb | Full S&S | **Full protocol with the 50 kg bell** ★ | 12 |

**Honest notes.** 50 kg is a long way up: it is 2 kg above Sinister, which is
already an advanced standard. 48 kg is the common top size, and **I'm not sure a
50 kg bell is easy to buy**, so check before planning around it. The bell
weights are data, so changing the target later is a one-line edit. **You
need a 35 lb bell before K2.** An adjustable bell avoids buying several, and the
level-up preview will always say which bell the next stage needs.

The book also lets swings and get-ups advance independently. v1 keeps one bell
per stage; splitting them is a data change, not a rewrite.

**Frequency.** S&S is designed to be near-daily and you asked for 5 a week. At
30–60 minute days with eight areas it can't be 5 without pushing muscle-up below
its minimum (section 5), so the default target is **3, with 5 as the nominal
target** the app moves toward when your weekly time allows.

### g) One-arm pull-up — target 2 days/week — goal: 1 strict rep each arm

The most tendon-hungry ladder. Heavy sessions are at least 3 days apart, and
the area alternates a heavy session with a light technique session.

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **O1 Pull-up base** | Strict pull-ups, scapular pulls, dead hangs, short one-arm hangs | 3 × 10 strict pull-ups, 2 s down | 12 |
| **O2 Weighted** | Weighted pull-ups ramping to +25 % bodyweight (uses your bodyweight rule) | +25 % BW × 5 | 16 |
| **O3 Archers** | Archer pull-ups, widening the grip | 3 × 5 per side, assisting arm straight | 14 |
| **O4 Assisted one-arm** | One-arm with the other hand on the wrist or a towel/band, assist reducing | 3 × 3 per side, fingertip-level assist | 14 |
| **O5 One-arm negatives** | 6–8 s lowering, ≤ 4 reps per arm per session | 3 × 3 per side at 8 s | 14 |
| **O6 One-arm pull-up** | Partials from 90° to the top, then full attempts | **1 strict rep each arm** ★ | 16 |

Elbow amber blocks level-ups and holds the load here and in muscle-up.

### h) Plyometrics — target 2 days/week — goal: vertical jump +X cm

New. Purpose: jumping explosiveness and tendon strength. Volume is counted in
**foot contacts**, not sets. Your heel-raise and pogo work from W2–W3 lives on
as Y1–Y3. Rules: done **first** in a day, never on the same day as Nordic, at
least 2 days between sessions (3 in Y5–Y6), guarded by **Achilles and knee**.
Contact caps and heights are placeholders from general guidance, from memory.

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **Y1 Tendon base and landing** | Slow single-leg heel raises (3 s down), Achilles isometric holds, ankle mobility, low stick landings (20–30 cm), skipping; ≤ 40 contacts | 3 × 12 single-leg heel raises, 3 s down, pain-free; 10 quiet stick landings from 30 cm | 10 |
| **Y2 Double-leg elastic** | Double-leg pogos (short, stiff contacts), squat jumps, broad jumps, low box jumps; ≤ 60 contacts | 3 × 20 continuous double-leg pogos; 3 × 5 box jumps to 40 cm, landings stuck | 10 |
| **Y3 Single-leg elastic** | Single-leg pogos, in-place and lateral hops, low hurdle hops; ≤ 80 contacts | 20 continuous single-leg pogos per leg with short contacts (film it) | 12 |
| **Y4 Bounds and reactive** | Alternate-leg bounds, reactive hurdle hops (30 cm), single-leg box jumps; ≤ 100 contacts. *Advisory: Pistol P3* | 5 reactive hurdle hops with minimal ground time; 5 single-leg box jumps per leg to 30 cm | 12 |
| **Y5 Depth jumps** | Drop jumps from 20 → 30 → 40 cm (use the height where the rebound is highest), countermovement jumps with arm swing; ≤ 100 contacts, ≤ 30 of them depth. *Advisory: Pistol P4 and Nordic N3* | 5 depth jumps with a rebound at least as high as your countermovement jump | 14 |
| **Y6 Approach jumps** | 3–5 step approach, single-leg take-off to a touch target; ≤ 60 maximal contacts | **Vertical jump ≥ baseline + X cm** ★, retested every 4 weeks | 12 |

**Advisory prerequisites** are a new stage field: the level-up review shows
"not met" when, say, Pistol P4 is still ahead of you, and you can override. They
protect the tendons that depth jumps hit hardest.

**The goal is a vertical jump.** Y1 starts with a baseline: standing reach vs
wall-touch jump, best of 3, same warm-up each time. You set X (cm) after seeing
it. The jump is retested every 4 weeks and charted, so you can see the effect of
the stages before you reach Y6.

---

## 10. What changes in the app

**Tabs (still four).** *Today* (the menu) · *Areas* (ladders, the week grid,
verdicts) · *Check-in* · *Progress*. The old *Plan* tab and its 14-week calendar
go away.

**Missed sessions.** Nothing is scheduled, so nothing is missed, only behind. An
area that wasn't trained is still due tomorrow ("recover") or you leave it
("ignore"); weekly caps stop it snowballing. The visuals you first asked for map
to the **week grid** (what is done, by area) and the **menu with "due" per area**
(what is coming).

**Check-in body areas: seven.** Elbow, shoulder, wrist, lower back, knee,
hamstring, and **Achilles, kept for plyometrics.** Past check-ins are unchanged.
HOLD and red-light work as now, per area instead of per track.

**Retired.** Sprint & hinge (swings cover the hinge), weighted pull-up as a
separate feat (folds into One-arm O2), strict KB press (S&S has the get-up). The
dated tests (8, 15, 29 Dec, 4 Jan) become standards you attest to. **Heel raise
and pogo are not lost:** they are plyometrics Y1–Y3.

**Units and equipment.** Bell weights show in lb with kg beside them (35 lb ·
16 kg); everything else stays kg, with a switch in settings. Settings lists what
you own. Each stage lists what it needs and the level-up preview flags the gap.

**Baselines.** Bodyweight and the pull-up 5RM stay (they drive O2 and weighted
dips). A baseline vertical jump is added for plyometrics. The rest become stage
standards.

**Seeding from your export.** Legacy sessions are split by exercise into
area-days, using the dates you actually trained. I checked this against your
file:

| Area | Seeded |
|---|---|
| Muscle-up | Stage M1, **3 full area-days** (20 Sep, 27 Sep, 3 Oct) |
| Plyometrics | Stage Y1, **3 full area-days** (23 Sep, 29 Sep, 1 Oct): heel raises, pogo, Achilles holds |
| Nordic | Stage N1, **1 full area-day** (29 Sep) |
| Everything else | Stage 1, 0 days |

The rest of the 93 sets stay as history only: weighted pull-up 4, sprint 8,
hinge 7, KB press 6, KB floor press 6, scapular shrugs 3, face pulls 3,
Copenhagen 3, KB shoulder circuit 2. One heel-raise set is logged at 500 kg ×
999 reps; the import should flag it rather than seed it.

**Data shape**

```jsonc
// data/areas/pistol.json
{
  "id": "pistol", "name": "Pistol squat", "colour": "teal", "priority": 4,
  "perWeek": { "min": 2, "target": 2, "max": 3 },
  "minGapDays": 2, "minutes": 18, "load": "medium", "order": "strength",
  "guardedBy": ["knee"],
  "goal": "5 strict pistols per leg, heel down, no counterweight",
  "stages": [
    { "id": "P3", "name": "Assisted pistol", "askAfter": 10, "repeatEvery": 4,
      "ready": ["3 × 8 per leg with fingertip-light assist"],
      "equipment": ["pole, doorframe or rings"],
      "requires": [],
      "types": ["main", "technique"],
      "exercises": [
        { "id": "assisted-pistol", "name": "Assisted pistol", "sets": 3, "reps": "5 → 8",
          "tempo": "3 s down", "restSec": 90, "type": "main" }
      ] }
  ]
}
// data/rules.json
{ "defaults": { "dayMinutes": 60, "maxAreas": 4, "maxHigh": 2, "rampWeeks": 2, "fullAreaPct": 100 },
  "conflicts": [ { "areas": ["mu", "oap"], "why": "both load the elbow tendons" },
                 { "areas": ["nordic", "kb"], "soft": true, "why": "both load the hamstrings" } ],
  "budgets":   [ { "areas": ["mu", "oap"], "maxPerWeek": 4, "why": "elbow tendon" } ],
  "verdicts":  { "consistentWeeks": 3, "slippingMisses": 2, "dormantDays": 14 } }
// dayPlans["2026-10-07"]: what each sitting's menu was, so the week view can say "skipped"
{ "sittings": [ { "minutes": 30, "planned": ["mu", "bridge"] },
                { "minutes": 30, "planned": ["kb", "pistol"] } ],
  "removed": { "pistol": "no time" } }
// stage-level overrides, e.g. Nordic N1: "perWeek": {"min":2,"target":3,"max":3}, "minGapDays": 2
// advisory prerequisite, e.g. Plyometrics Y5: "requires": [{"area":"pistol","stage":"P4"}]
```

**Backup.** Export gains `progress`, `decisions`, `dayPlans`, `areaDays`,
`customAreas` and `equipment`. The old `schedule` collection is retired. An old
export imports and is seeded as above.

---

## 11. Build order

0. **Fix first:** the session runner ignores red-light suppression. Hamstring is
   red until 9 Oct and today's session has Nordic.
1. **M11 — data and rules:** area files for all eight, `rules.json`, a validator
   test, and a read-only *Areas* tab (ladders, week grid from your legacy
   history). No change to how you train. The grid shows done and partial only;
   **skipped appears once menus are saved, from M12.**
2. **M12 — area-days and sittings:** log per area instead of per fixed session,
   with legacy mapping and the 500 kg flag. A manual *Today* menu (pick areas,
   time chooser, up to 3 sittings, partial finish, log off-app), saved day
   plans, and a live week grid with done / partial / skipped.
3. **M13 — recommender:** port the prototype as a tested pure function, with
   reasons on every line, time-fitted targets, the feasibility line, ramp-in, and
   the seven-area check-in with guard mapping.
4. **M14 — stages and level-up:** progress state, the full-area-day counter,
   review screen with next-stage preview (equipment and prerequisites), move up /
   not yet / step back, the deload block, decisions log.
5. **M15 — feedback:** statuses, verdicts, nudges, the Monday card, pace
   projection.
6. **M16 — adding areas:** track-only areas in the app, area-pack import,
   units and equipment settings, how-to.

---

## 12. Caveats

- These are generic progressions. They do not know your history. Your export
  shows hamstring pain at 9 and 8 out of 10 and shoulder at 5 on recent
  check-ins; if those are real, get them looked at before loading Nordics or
  adding jumps. Seven days a week with tendon-heavy areas is a lot; spacing, the
  maxes and the per-stage deload are the safety net, and they only work if you
  log honestly.
- Plyometric contact counts, depth-jump heights and the strength prerequisites
  are from general guidance, from memory.
- The simulation is a paper prototype with my placeholder numbers.
- The Simple & Sinister details are from memory. The book wins.
- A 50 kg kettlebell may be hard to buy; 48 kg is the usual top size.
- `askAfter` values and the verdict thresholds are placeholders.

---

## 13. What I need from you

1. **Units on the bell target.** You wrote "50 kG". Is that **50 kg (110 lb)**, or
   did you mean **50 lb (22.7 kg)**, which would stop the ladder around K3–K4?
   I built it for 50 kg.
2. **Skipped, as defined in section 6:** planned means on that day's saved menu,
   and a day you never opened the app shows as "no plan recorded", never as
   skipped. OK?
3. **Two sittings:** the same area may be done in both, counts once, and only
   completing the block counts toward level-up. Up to 3 sittings a day. OK?

Everything else is settled. If those three are fine I'd treat the plan as
**approved** and start with the runner red-light fix, then M11.
