# Areas, stages and the daily menu — draft v2 for review

Status: **draft, nothing in the app is implemented.** Numbers marked
*(placeholder)* are mine, not sourced; change them freely. Section 13 lists what
I still need from you.

---

## 1. What changed since v1

| v1 | v2 (your latest answers) |
|---|---|
| Fixed 7-session rotation | **No rotation.** The app recommends today's areas; you choose. |
| Unit = a session | Unit = **one area on one day** (an "area-day"). |
| Aim 3–4 days a week | **7 days a week**; partial training allowed. |
| Missed session → recover or ignore | Nothing is scheduled, so nothing is *missed*, only *behind*. Weekly caps stop it snowballing. |
| Per-rotation frequency | **Weekly targets per area** (min / target / max days), with feedback on how you are doing. |
| Areas fixed in data | You can add today's areas freely, create **track-only areas in the app**, or import a full ladder as JSON. |

I prototyped the recommender and simulated it before writing this (section 5),
because the first version of the rules did not hold up.

---

## 2. The model on one page

| Concept | What it is | Lives in |
|---|---|---|
| **Area** | Something you are getting better at: goal, weekly targets, spacing rules. | `data/areas/<id>.json` |
| **Stage** | A rung on an area's ladder: exercises, the "ready when" standard, sessions before the app asks. | inside the area file |
| **Area-day** | One area trained on one date. Partial allowed. The unit of tracking. Its content is frozen once you log it. | logs + a small `areaDays` record |
| **Day menu** | The areas you chose for today, starting from the app's recommendation. | `dayPlans` |
| **Progress** | Per area: current stage, full days in it, decision history. | `progress`, `decisions` |
| **Week stats** | Days trained per area per week, derived from logs. Never stored. | computed |
| **Rules** | Spacing, conflicts, shared budgets, day time budget, thresholds. | `data/rules.json` |

No area-specific code anywhere: the recommender, week grid, verdicts and
level-up all read from the data.

---

## 3. A day: the menu and the recommender

```
Today · Thu 22 Oct                          budget 60 min   [change]
 [x] Nordic curl        N1   10 min   DUE · 1/2 this week, 3 d since last
 [x] One-arm pull-up    O1   20 min   DUE · 1/2 this week, 3 d since last
 [x] Backward bridge    B1   12 min   1/3 this week, 3 d since last
 [x] Pistol squat       P1   18 min   1/2 this week, 3 d since last
 [ ] Handstand push-up  H1   20 min   too soon: trained yesterday, needs 2 days
 [ ] Kettlebell         K1   30 min   not with Nordic: both load the hamstrings
 Total 60 min                                  [ Start ]   [ + Add area ]
```

This is real output from the prototype (`prototype/recommender-sim.js`), with
stage labels added.

**What you can do**
- Untick anything, or tick something the app advised against. You get a warning,
  not a block.
- **Add area** puts any area on today's menu, including paused ones. Section 8
  covers creating new ones.
- **Partial is fine:** finish early at any point. What you logged counts, and
  the area-day shows as partial.
- **Log something done off-app:** pick the area and mark it, with sets defaulting
  to complete.
- Dismiss a recommendation for today with no penalty and no "missed" mark.

**How the recommender decides** (deterministic, no learning, so you can always
see why):
1. **Exclude:** guarded body area is red · already at weekly max · too soon since
   the last session (spacing) · a shared weekly budget is used up.
2. **Rank:** a minimum that is about to become impossible goes first (highest
   priority first). Then by how tight the spacing to the weekly target is: areas
   that need more sessions, or longer gaps, come first. Then days since last
   trained. Then your priority order.
3. **Fill** from the top, within the day's time budget, at most 4 areas and at
   most 2 high-load areas, never a conflicting pair.
4. **Order** for doing: skill → strength → mobility → kettlebell.
5. An area that has already hit its target is not recommended (you can still add
   it, up to the max).
6. Amber on a guarding body area keeps the area on the menu but flags **HOLD**
   (no load progression). Amber on the elbow holds muscle-up and one-arm pull-up
   together, as today.

**No catch-up binge.** The week resets and the targets are caps. Miss a week and
the next one is still just the target.

**Rest.** No day is forced rest. When the rules allow little, you get a light
day (bridge, kettlebell) or "nothing recommended". Real recovery comes from
spacing, maxes and the per-stage deload.

---

## 4. The seven areas: weekly targets and rules

All numbers are placeholders. **Days/week** is min · target · max.

| # | Area | Days/week | Min days apart | ~Min | Load | Guarded by |
|---|---|---|---|---|---|---|
| a | Muscle-up | 2 · 2 · 3 | 2 | 30 | high | elbow, shoulder, wrist |
| b | Handstand push-up | 2 · 2 · 3 | 2 | 20 | high | shoulder, wrist |
| c | Backward bridge | 2 · 3 · 5 | 1 | 12 | low | lower back, shoulder, wrist |
| d | Pistol squat | 2 · 2 · 3 | 2 | 18 | medium | knee |
| e | Nordic curl | 1 · 2 · 2 | 3 | 10 | high | hamstring, knee |
| f | Kettlebell (S&S) | 3 · 5 · 6 | 1 | 30 | medium | lower back, shoulder, hamstring |
| g | One-arm pull-up | 1 · 2 · 2 | 3 | 20 | high | elbow, shoulder |

At targets the week costs **382 min, about 55 min/day over 7 days.** At minimums
it costs 280.

**Rules between areas**

| Rule | Why |
|---|---|
| Muscle-up and one-arm pull-up never recommended the same day | both load the elbow tendons |
| Nordic and kettlebell never the same day | both load the hamstrings |
| HSPU and muscle-up never the same day | shoulders and triceps (dips) |
| Muscle-up + one-arm pull-up ≤ 4 days a week combined | shared elbow budget |
| ≤ 2 high-load areas in a day | spreads the stress across the week |

**Ramp-in:** an area's first 2 weeks run at its *minimum*, then rise to target.
Seven new areas at full target would be a big jump from where you are now. *Not
simulated, trivial parameter.*

Priority is your list order (a → g) and breaks ties and decides what is dropped
first when time or days run short.

---

## 5. Does the rule set work? (simulation)

I implemented the rules above as a pure function and simulated 8 weeks.
Reproduce with `node prototype/recommender-sim.js`.

| Scenario | Result |
|---|---|
| **A.** 7 days/week, 60 min/day, follow every recommendation | **Every target met in every week**, 0 rule violations, 42–60 min/day (avg 55) |
| **E.** rest Sundays (6 days) | All minimums met; bridge 2/3 and kettlebell 4/5 |
| **F.** 5 days/week but 90 min | Minimums met; Nordic 1/2, kettlebell 4/5 |
| **B.** 5 days/week at 60 min | Muscle-up and HSPU fall to 1 (min 2). **Budget too small**: minimums need 280 of 300 min, leaving no room for the conflicts |
| **C.** 30 min/day | 28 of 49 area-weeks below minimum. Targets simply don't fit |
| **D.** hamstring red for 5 days | Nordic and KB resume the next week at target, with no make-up |

**What the simulation changed.** My first rules reached only 1 Nordic a week
instead of 2, because spacing wasn't part of the urgency, and an urgent area
could blow the time budget (a 90-minute day under a 30-minute limit). Fixing
those made A perfect. A separate priority bug (one-arm pull-up beating muscle-up
when days were scarce) is why minimums now jump the queue once they become
urgent.

**Honest limits.** It is greedy, day by day, so it is not optimal (scenario B
might be partly rescued by a smarter week-lookahead; I'd only build that if
needed). It assumes perfect compliance and no partial days. The minutes,
targets and gaps are mine.

**So the app also shows a feasibility line**, e.g. "Your minimums need 280 min a
week; 5 days × 60 min = 300. Tight: expect shortfalls in muscle-up and HSPU."
Better to say it than to silently under-deliver.

---

## 6. Tracking: are you doing well?

**What counts**
- A **touched day** has ≥ 1 set logged for the area (partial included, shown as
  a half dot). It counts toward weekly frequency, as you asked.
- A **full day** has ≥ 80 % of the area's prescribed sets *(placeholder)*. Only
  full days count toward level-up (section 7).
- **Completion** = sets done ÷ prescribed on touched days.

**This week, per area** (weeks run Mon–Sun)

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
weeks, so a streak of token sessions doesn't read as success.

```
This week · Mon 5 – Sun 11     M  T  W  T  F  S  S   days  status     last 4 wk
Muscle-up      M1   7/12       ●  ·  ◐  ·  ·  ·  ·   2/2   Done       2 3 2 2  Consistent
Handstand PU   H1   3/8        ·  ●  ·  ·  ·  ·  ·   1/2   On track   2 2 1 2  Building
Backward bridge B1  5/8        ●  ●  ●  ·  ·  ·  ·   3/3   Done       3 3 3 2  Consistent
Pistol         P1   2/8        ·  ·  ○  ·  ·  ·  ·   0/2   Due        1 2 0 0  Slipping
Nordic         N1   1/8        ·  ·  ·  ·  ·  ·  ·   0/2   Held: hamstring red
Kettlebell     K1   0/8        ◐  ·  ●  ·  ·  ·  ·   2/5   Behind     4 3 5 4  Consistent
One-arm        O1   0/12       ·  ·  ·  ·  ·  ·  ·   0/2   On track    – – – –  New
● full day   ◐ partial   ○ planned for today   · none or future
```
(Illustrative numbers. "7/12" = full days in the stage out of `askAfter`.)

**Where it shows up**
- **Today:** a one-line strip ("5 of 7 areas on track") and at most two gentle
  nudges, e.g. "Pistol: 6 days since last, you aim for every 3–4".
- **Areas tab:** the grid above, verdict chips and the 4-week numbers.
- **Monday card:** last week in one screen.
- **Pace:** projected review date per area from your *actual* 4-week average,
  not the target. "At your pace the muscle-up review lands about 21 Oct."

The thresholds are data, not code.

---

## 7. Stage lifecycle and level-up

```
Build days ──► Deload block ──► Review prompt ──► Move up
(askAfter − d)  (d = the area's    │              Not yet ─► stay at the top prescription
                 weekly target,    │                          for 4 more full days, then ask
                 ~60% volume)      └──► Step back (always available)
```

- **`askAfter`** = full training days of that area in the stage, deload block
  included. At a target of 2 a week, 12 days is 6 weeks.
- The review shows: days done, the check-in colours for the guarding body areas,
  the stage's **standard** as a checklist you attest to (or run as a one-off
  check set), and a **preview of the next stage**: exercises, sets × reps × load
  from your baselines, what is new and what drops out.
- **You always decide.** The app only asks. You can also open the review
  yourself at any time.
- **Blocked, with the reason shown**, while a guarding body area is amber or red
  ("waiting: elbow amber").
- **Placement:** on first run you pick each area's starting stage with the same
  screen, working up from stage 1.

---

## 8. Adding areas

| You want to… | How |
|---|---|
| Train an existing area today that wasn't recommended | **Add area** on the menu. One tap. |
| Track something with no ladder (a run, climbing, mobility) | **New track-only area in the app**: name, days/week target, minutes. It joins the menu, the week grid and the verdicts. No stages. |
| Add a full ladder like the seven above | **Import an area pack** (JSON) in the app, or drop a file in `data/areas/`. A validator checks it before it loads. |

Custom areas are stored with your data and included in the export. This
relaxes the BRIEF's "hardcode the plan": still no backend and no plan editor,
but track-only areas are made in the app and laddered ones are data files. If JSON proves
a chore for laddered areas, a minimal in-app builder is a later option.

---

## 9. Area ladders

Columns: **Work** is what you do in the stage; **Ready when** is the standard you
attest to at review; **Ask** is `askAfter`, counted in that area's *full* training
days in the stage (section 7).

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

### b) Handstand push-up — target 2 days/week — goal: 5 strict full-range wall HSPUs ⚠

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **H1 Pike foundation** | Pike push-ups, feet on floor → feet elevated; wrist prep; scapular shrugs; hollow hold | 3 × 10 feet-elevated pike push-ups, hips over hands | 8 |
| **H2 Wall handstand** | Chest-to-wall walk-ups and holds, line and breathing | 3 × 45 s chest-to-wall hold | 8 |
| **H3 Negatives** | Wall HSPU negatives, 5 s lowering to a head-touch on a folded mat | 3 × 5 negatives at 5 s | 10 |
| **H4 Partial range** | Wall HSPU to a mat stack, depth increasing as the stack shrinks (15 → 10 → 5 cm) | 3 × 6 at about 5 cm | 12 |
| **H5 Full range** | Wall HSPU, head to the floor, no mat | **5 consecutive strict reps** ★ | 12 |
| *H6 Stretch* | Parallettes, deficit, freestanding holds | Your definition — see section 13 | — |

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

### e) Nordic curl — target 2 days/week — goal: 5 strict unassisted Nordics ⚠

Your existing band-assisted progression from `plan.json`, extended to a true Nordic.

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **N1 Heavy band** | Band-assisted Nordics, heavy band, 4 s lowering | 3 × 8, heavy band, 4 s down | 8 |
| **N2 Lighter band** | Medium → light band | 3 × 6, light band, 4 s down | 8 |
| **N3 Unassisted eccentric** | No band; 5 s lowering; hands catch at the floor and push back | 3 × 5, 5 s down | 10 |
| **N4 Push-back reduction** | As N3 with the push-back reduced to fingertips | 3 × 5 with a fingertip push | 10 |
| **N5 Full Nordic** | No hands: eccentric and concentric | **5 strict reps** ★ | 12 |
| *N6 Stretch* | Weighted, +2.5 → +5 kg at the chest (the old feat) | 3 × 3 at 5 kg | — |

### f) Kettlebell strength (Simple & Sinister) — target 5 days/week — goal: Simple standard ⚠

Progression is by **bell**, as in the book. Weights are placeholders in kg: set
them to the bells you own.

Protocol, **as I remember it — please check against your copy**:
- 10 sets × 10 one-arm swings, alternating the hand each set
- 10 Turkish get-ups total, 5 per side, alternating
- interleaved: a get-up between swing sets
- Simple = 32 kg, Sinister = 48 kg (the book's standard for men)

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **K1 Foundation** | KB deadlift, goblet squat, two-hand swings 5 × 10, bodyweight/shoe get-up | 10 × 10 two-hand swings, clean hinge; 5 per side shoe get-ups | 8 |
| **K2 S&S, 16 kg** | Full S&S with the starter bell | Full protocol clean, not wrecked | 12 |
| **K3 S&S, 20 kg** | Full S&S | same | 12 |
| **K4 S&S, 24 kg** | Full S&S | same | 12 |
| **K5 S&S, 28 kg** | Full S&S | same | 12 |
| **K6 Simple, 32 kg** | Full S&S, plus the book's time standard | **Simple standard met** ★ | 12 |
| *K7 Stretch* | 40 → 48 kg, Sinister | Sinister standard | — |

The book also lets swings and get-ups advance independently. v1 keeps one bell
per stage; splitting them is a data change, not a rewrite.

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

---

## 10. What changes in the app

**Tabs (still four).** *Today* (the menu) · *Areas* (ladders, the week grid,
verdicts) · *Check-in* · *Progress*. The old *Plan* tab and its 14-week
calendar go away.

**Missed sessions.** No schedule means nothing to push back. An area that
wasn't trained is simply still due tomorrow ("recover") or you leave it
("ignore"); weekly caps stop it snowballing. The visuals you first asked for map
to: the **week grid** (what is done, by area, with the focus built in) and the
**menu with "due" per area** (what is coming).

**Check-in body areas.** Heel raise and pogo are gone, so Achilles loses its
reason to exist. Proposed list: **elbow, shoulder, wrist, lower back, knee,
hamstring.** Past check-ins keep their Achilles value; it is just not asked
again. HOLD and red-light work as now, per area instead of per track.

**Retired areas.** Heel raise / pogo, sprint & hinge, weighted pull-up as a
separate feat, strict KB press. Their W2–W3 logs stay as history. Weighted
pull-up folds into One-arm stage O2. The dated tests become standards you attest
to.

**Baselines.** Bodyweight and the pull-up 5RM stay (they drive O2 and weighted
dips). The rest become stage standards.

**Seeding from your export.** Legacy sessions are split by exercise into
area-days, using the dates you actually trained:

| Area | Seeded |
|---|---|
| Muscle-up | Stage M1, **3 full days** (20 Sep, 27 Sep, 3 Oct) |
| Nordic | Stage N1, **1 full day** (29 Sep) |
| Everything else | Stage 1, 0 days |

So the week grid has history on day one. The rest of the 93 sets belong to
retired areas and stay as history.

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
      "types": ["main", "technique"],
      "exercises": [
        { "id": "assisted-pistol", "name": "Assisted pistol", "sets": 3, "reps": "5 → 8",
          "tempo": "3 s down", "restSec": 90, "type": "main" }
      ] }
  ]
}
// data/rules.json
{ "defaults": { "dayMinutes": 60, "maxAreas": 4, "maxHigh": 2, "rampWeeks": 2, "fullDayPct": 80 },
  "conflicts": [ { "areas": ["mu", "oap"], "why": "both load the elbow tendons" } ],
  "budgets":   [ { "areas": ["mu", "oap"], "maxPerWeek": 4, "why": "elbow tendon" } ],
  "verdicts":  { "consistentWeeks": 3, "slippingMisses": 2, "dormantDays": 14 } }
```

**Backup.** Export gains `progress`, `decisions`, `dayPlans`, `areaDays` and
`customAreas`. The old `schedule` collection is retired. An old export imports and is
seeded as above.

---

## 11. Build order

0. **Fix first:** the session runner ignores red-light suppression. Hamstring is
   red until 9 Oct and today's session has Nordic.
1. **M11 — data and rules:** area files, `rules.json`, a validator test, and a
   read-only *Areas* tab (ladders, week grid from your legacy history). No change
   to how you train.
2. **M12 — area-days:** log per area instead of per fixed session, with legacy
   mapping. A manual *Today* menu (pick areas, partial finish, log off-app), and a
   live week grid.
3. **M13 — recommender:** port the prototype as a tested pure function; reasons
   on every line, the feasibility line, ramp-in, and the new body-area
   check-in with guard mapping.
4. **M14 — stages and level-up:** progress state, the counter, review screen with
   next-stage preview, move up / not yet / step back, the deload block, decisions
   log.
5. **M15 — feedback:** statuses, verdicts, nudges, the Monday card, pace
   projection.
6. **M16 — adding areas:** track-only areas in the app, area-pack import,
   how-to.

---

## 12. Caveats

- These are generic progressions. They do not know your history. Your export
  shows hamstring pain at 9 and 8 out of 10 and shoulder at 5 on recent
  check-ins; if those are real, get them looked at before loading Nordics. Seven
  days a week with tendon-heavy areas is a lot; the spacing rules and the
  per-stage deload are the safety net, and they only work if you log honestly.
- The simulation is a paper prototype with my placeholder numbers.
- The Simple & Sinister details are from memory. The book wins.
- `askAfter` values, the 80 % rule and the verdict thresholds are placeholders.

---

## 13. What I need from you

1. **Daily time budget.** Is 60 min a good default, or does it vary by weekday?
   (At targets the week needs ~55 min/day.)
2. **Weekly targets and spacing in section 4.** Especially kettlebell 5 a week,
   muscle-up and one-arm pull-up sharing 4 elbow days, and Nordic 2 a week
   while hamstring is flagged.
3. **Partial counting:** a touched day counts for weekly frequency, but only a
   full day (≥ 80 %) counts toward level-up. OK?
4. **Goal definitions** marked ⚠: HSPU (wall ×5 or freestanding), Nordic
   (unassisted ×5 or weighted), which KB standard.
5. **Bell sizes you own.**
6. **Retire the old areas** (heel raise/pogo, sprint & hinge, weighted pull-up,
   KB press) and **drop Achilles** from the check-in?
7. **Adding areas:** track-only in the app and laddered ones as JSON, OK for now?
8. Anything wrong in a ladder: exercises, standards, `askAfter`.
