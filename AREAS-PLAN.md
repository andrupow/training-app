# Areas, stages and the weekly rotation — draft for review

Status: **draft, nothing implemented.** Everything below is placeholder-quality
until you've been through it. Numbers marked *(placeholder)* are mine, not
sourced; change them freely. Section 9 lists what I need from you.

---

## 1. The model on one page

| Concept | What it is | Lives in |
|---|---|---|
| **Area** | One thing you are getting better at, with a goal standard. | `data/areas/<id>.json` |
| **Stage** | A rung on an area's ladder: its exercises, the standard that says "ready", and how many sessions before the app asks. | inside the area file |
| **Rotation** | The repeating cycle of sessions that mixes the areas. Not pinned to weekdays. | `data/rotation.json` |
| **Progress** | Per area: current stage, sessions done in it, decision history. The only new saved state. | localStorage `progress`, `decisions` |
| **Session** | Derived, not stored: rotation slot × each *active* area's current stage. | built at render time |

No area-specific code anywhere. Colour, ladder, chips, matrix and prompts all
read from the area file, so adding area #8 is a new JSON file plus one line in
the rotation.

### Stage lifecycle (your decisions 3 and 4)

```
Build sessions ──► Deload block ──► Review prompt ──► Move up
 (askAfter − d)     (d = this area's      │            Not yet ─► top prescription for 4 more
                     sessions/rotation,   │                       sessions, then ask again
                     ~60% volume)         └──► Step back (always available)
```

- **`askAfter`** is the number of that area's sessions in the stage after which
  the app asks you to review. It includes the deload block.
- A session counts when **≥ 80 % of that area's sets are logged** *(placeholder)*.
  Partial sessions still show as partial, they just don't advance the counter.
- The review screen shows: sessions done, check-in colours for the guarding body
  areas, the stage's **standard** as a checklist you attest to (or run as a
  one-off check set), and a **preview of the next stage** — exercises, sets ×
  reps × load resolved from your baselines, what is new and what drops out.
- **You always decide.** The app only asks. You can also open the review
  yourself at any time.
- **Blocked, with the reason shown**, while a guarding body area is amber or red
  (e.g. "waiting: elbow amber"). Amber on the elbow also holds the pulling load
  for Muscle-up and One-arm pull-up, as today.
- **Placement:** on first run you pick each area's starting stage using the same
  review screen, working up from stage 1.

---

## 2. The seven areas at a glance

Priority = your list order (a → g). It decides what gets cut first when a
session is compromised: from the bottom up.

| # | Area | Goal standard | Stages | Per rotation | Guarded by | Earliest finish* |
|---|---|---|---|---|---|---|
| a | **Muscle-up** | 1 strict unassisted bar muscle-up | 4 | 2 | elbow, shoulder, wrist | ~26 wk |
| b | **Handstand push-up** | 5 strict full-range wall HSPUs ⚠ | 5 (+1 stretch) | 2 | shoulder, wrist | ~29 wk |
| c | **Full backward bridge** | 3 free stand-to-stand bridges, controlled | 7 | 2 | lower back, shoulder, wrist | ~49 wk |
| d | **Pistol squat** | 5 strict pistols per leg, heel down, no counterweight | 6 | 2 | knee | ~34 wk |
| e | **Nordic curl** | 5 strict unassisted full-range Nordics ⚠ | 5 (+1 stretch) | 2 | hamstring, knee | ~28 wk |
| f | **Kettlebell (S&S)** | Simple standard (default 32 kg) ⚠ | 6 (+1 stretch) | 3 | lower back, shoulder, hamstring | ~26 wk |
| g | **One-arm pull-up** | 1 strict one-arm pull-up each arm | 6 | 2 | elbow, shoulder | ~50 wk |

\* Earliest = every review passed the first time it is asked, training 6 days a
week (rotation ≈ 8 days). **At your logged pace of ~3–4 days a week, multiply
by about 1.7.** Real life will be longer. ⚠ = goal definition needs your
confirmation (section 9).

---

## 3. The weekly rotation — how the areas mix

Seven sessions, then repeat. It advances when you train, so a rest day or a
missed day is just a gap. The Mon–Sun labels are a suggestion, not a rule.

```
                   S1  S2  S3  S4  S5  S6  S7   per rot
Muscle-up          ■   ·   ·   ·   ·   ■   ·      2    S1 strength · S6 skill
Handstand PU       ·   ·   ■   ·   ·   ■   ·      2    S3 main · S6 volume
Bridge             ■   ·   ·   ■   ·   ·   ·      2    S1 primer · S4 strength
Pistol             ·   ■   ·   ·   ■   ·   ·      2    S2 main · S5 technique
Nordic             ·   ■   ·   ·   ·   ■   ·      2
Kettlebell (S&S)   ·   ·   ■   ·   ■   ·   ■      3
One-arm pull-up    ·   ·   ·   ■   ·   ·   ■      2    S4 heavy · S7 light
minutes           ~45 ~35 ~55 ~45 ~50 ~60 ~50
```

| Slot | Name | Contents |
|---|---|---|
| S1 | Pull A | Muscle-up (strength) · Bridge (primer) |
| S2 | Legs A | Pistol · Nordic |
| S3 | Press + KB | Handstand push-up · Kettlebell |
| S4 | Pull B | One-arm pull-up (heavy) · Bridge (strength) |
| S5 | Legs B + KB | Pistol (technique) · Kettlebell |
| S6 | Press + Skill | HSPU (volume) · Muscle-up (skill) · Nordic |
| S7 | Light + KB | One-arm pull-up (light, technique) · Kettlebell |

**Why it is shaped this way**
- Pulling touches the elbow tendon: muscle-up and one-arm pull-up share it, so
  the two heavy pull slots (S1, S4) are three sessions apart.
- Pressing (HSPU, dips in muscle-up, get-ups) shares shoulders and wrists; HSPU
  sits on S3 and S6, three apart.
- Nordics are at least three sessions apart (S2, S6).
- Within a session: skill first, heavy before light, Nordic before anything that
  tires the hamstrings.

**Known compromises:** S6 → S7 → S1 touches pulling three sessions running; S7's
one-arm work and S6's muscle-up are capped at light/skill volume to compensate.
S5's swings sit the day before S6's Nordics. If either bothers you we move slots.

**Active areas.** Seven simultaneous skill goals is a lot, especially at 3–4
days a week. Each area has an *active* switch; the rotation is built from active
areas only (empty slots drop out, the rest compress). Paused areas keep their
stage. Starting with three or four active is realistic — your call.

---

## 4. Area ladders

Columns: **Work** is what you do in the stage; **Ready when** is the standard you
attest to at review; **Ask** is `askAfter`, in that area's sessions.

### a) Muscle-up — 2 per rotation — goal: 1 strict unassisted bar muscle-up

These are your existing P1–P4, using the exercises already in `plan.json`.

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **M1 Dip foundation** | Dip negatives (3 s) → band-assisted parallel dips → bodyweight; sternum and strict pull-ups; false-grip hangs; hollow and arch holds; bar support | 8 clean parallel dips **and** 5 strict chest-to-bar pulls | 12 |
| **M2 Straight-bar crossing** | Straight-bar dip negatives (5 s), Russian dips, false-grip top holds, low-bar turnovers, speed chest-to-bar, L-sit chins, hanging toes-to-bar | 5 s straight-bar negative **and** 4 Russian dips | 12 |
| **M3 Banded integration** | Band-assisted muscle-ups (heavy → light band), 6 s negative muscle-ups, explosive and weighted dips, lockout and L-sit holds | Clean single with a light band | 12 |
| **M4 Micro-band → unassisted** | Micro-band singles, unassisted attempts, neural primers | **1 strict unassisted bar muscle-up** ★ | 8 |

### b) Handstand push-up — 2 per rotation — goal: 5 strict full-range wall HSPUs ⚠

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **H1 Pike foundation** | Pike push-ups, feet on floor → feet elevated; wrist prep; scapular shrugs; hollow hold | 3 × 10 feet-elevated pike push-ups, hips over hands | 8 |
| **H2 Wall handstand** | Chest-to-wall walk-ups and holds, line and breathing | 3 × 45 s chest-to-wall hold | 8 |
| **H3 Negatives** | Wall HSPU negatives, 5 s lowering to a head-touch on a folded mat | 3 × 5 negatives at 5 s | 10 |
| **H4 Partial range** | Wall HSPU to a mat stack, depth increasing as the stack shrinks (15 → 10 → 5 cm) | 3 × 6 at about 5 cm | 12 |
| **H5 Full range** | Wall HSPU, head to the floor, no mat | **5 consecutive strict reps** ★ | 12 |
| *H6 Stretch* | Parallettes, deficit, freestanding holds | Your definition — see section 9 | — |

### c) Full backward bridge from standing — 2 per rotation — goal: 3 free stand-to-stand bridges

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

### d) Pistol squat — 2 per rotation — goal: 5 strict pistols per leg

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **P1 Squat foundation** | Full-depth bodyweight squat, heels down; deep-squat holds; knee-to-wall ankle rocks; reverse lunges | 3 × 20 deep squats and 2 min accumulated deep hold | 8 |
| **P2 Single-leg strength** | Bulgarian split squat, step-ups, 3 s down | 3 × 10 per leg Bulgarian, bodyweight | 8 |
| **P3 Assisted pistol** | Full-depth pistol holding a pole, doorframe or rings | 3 × 8 per leg with fingertip-light assist | 10 |
| **P4 Box pistol** | Single-leg sit-to-stand, box lowered 60 → 45 → 35 cm | 3 × 6 per leg from 35 cm | 10 |
| **P5 Negatives** | Pistol negatives, 5 s to full depth, two legs to stand | 3 × 5 per leg at 5 s to full depth | 10 |
| **P6 Full pistol** | Counterweight held forward (2–5 kg) then dropped; heel flat | **5 strict reps per leg, no counterweight** ★ | 12 |

### e) Nordic curl — 2 per rotation — goal: 5 strict unassisted Nordics ⚠

Your existing band-assisted progression from `plan.json`, extended to a true Nordic.

| Stage | Work | Ready when | Ask |
|---|---|---|---|
| **N1 Heavy band** | Band-assisted Nordics, heavy band, 4 s lowering | 3 × 8, heavy band, 4 s down | 8 |
| **N2 Lighter band** | Medium → light band | 3 × 6, light band, 4 s down | 8 |
| **N3 Unassisted eccentric** | No band; 5 s lowering; hands catch at the floor and push back | 3 × 5, 5 s down | 10 |
| **N4 Push-back reduction** | As N3 with the push-back reduced to fingertips | 3 × 5 with a fingertip push | 10 |
| **N5 Full Nordic** | No hands: eccentric and concentric | **5 strict reps** ★ | 12 |
| *N6 Stretch* | Weighted, +2.5 → +5 kg at the chest (the old feat) | 3 × 3 at 5 kg | — |

### f) Kettlebell strength (Simple & Sinister) — 3 per rotation — goal: Simple standard ⚠

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

### g) One-arm pull-up — 2 per rotation — goal: 1 strict rep each arm

The most tendon-hungry ladder. Only **one heavy slot per rotation** (S4); the
S7 slot is capped at light technique work.

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

## 5. What changes in the app

**Check-in areas.** Heel raise and pogo are gone, so Achilles loses its reason
to exist. Proposed list: **elbow, shoulder, wrist, lower back, knee,
hamstring.** Past check-ins keep their Achilles value; it is simply not asked
again. Each area file says which body areas guard it (column "Guarded by").
HOLD and red-light work as now, per area instead of per track.

**Retired areas.** Heel raise / pogo, sprint & hinge, weighted pull-up as a
separate feat, strict KB press. Their W2–W3 logs stay as history. Weighted
pull-up folds into One-arm stage O2. The old dated tests (8, 15, 29 Dec, 4 Jan)
become standards you attest to, not dates.

**Baselines.** Bodyweight and the pull-up 5RM stay (they drive O2 and weighted
dips). The rest become stage standards.

**Seeding from your export.** The 93 logged sets map cleanly:

| Area | Seeded |
|---|---|
| Muscle-up | Stage M1, **3 sessions** done (W2-Mon, W2-Wed, W2-Fri) |
| Nordic | Stage N1, **1 session** done (W2-Thu) |
| Everything else | Stage 1, 0 sessions |

**Backup.** Export gains `progress` and `decisions`; an old export imports and
is seeded as above.

**Missed sessions.** With a rotation queue there is nothing to "push back": a
missed slot just stays next in line, which *is* "recover". "Ignore" marks it
skipped and the rotation moves on. The status ribbon and the Today card from the
earlier plan still apply, using rotation slots and a 7-day layout.

---

## 6. Data shape (so you can see how little code an area needs)

```jsonc
// data/areas/pistol.json
{
  "id": "pistol", "name": "Pistol squat", "colour": "teal", "priority": 4,
  "perRotation": 2, "guardedBy": ["knee"],
  "goal": "5 strict pistols per leg, heel down, no counterweight",
  "stages": [
    { "id": "P3", "name": "Assisted pistol", "askAfter": 10, "repeatEvery": 4,
      "ready": ["3 × 8 per leg with fingertip-light assist"],
      "exercises": [
        { "id": "assisted-pistol", "name": "Assisted pistol",
          "sets": 3, "reps": "5 → 8", "tempo": "3 s down", "restSec": 90,
          "slot": "main" }
      ] }
  ]
}
// data/rotation.json
{ "sessions": [ { "id": "S2", "name": "Legs A",
                  "parts": [ { "area": "pistol", "role": "main" },
                             { "area": "nordic", "role": "main" } ] } ] }
```

A validator test checks that every rotation part resolves to an area, stage
ids are unique and ordered, loads parse, and `askAfter` ≥ the area's
per-rotation count.

---

## 7. Build order

0. **Fix first:** the session runner ignores red-light suppression. Hamstring is
   red until 9 Oct and today's session has Nordic.
1. **M11 — author and validate:** area files, rotation, validator test, read-only
   Areas screen (ladders, "you are here"), rotation matrix, area chips. No change
   to how you train.
2. **M12 — queue and status:** rotation as a queue, session status
   (done / partial / today / upcoming / missed / skipped), 7-day ribbon, recover
   or ignore for one or many.
3. **M13 — stage engine:** progress state, sessions generated from rotation ×
   stage, active-area switches, placement, seeding from your export.
4. **M14 — level-up:** counter, prompt, review screen with next-stage preview,
   move up / not yet / step back, decisions log, per-stage deload block.
5. **M15 — body areas and loose ends:** new check-in list, guard mapping,
   "add an area" how-to.

---

## 8. Caveats

- These are generic progressions. They do not know your history. Your export
  shows hamstring pain at 9 and 8 out of 10 and shoulder at 5 on recent
  check-ins; if those are real, get them looked at before loading Nordics.
- The Simple & Sinister details are from memory. The book wins.
- `askAfter` values and the 80 % counting rule are placeholders.

---

## 9. What I need from you

1. **Days per week you really train** (your logs say about 3–4; the old plan said
   5), and **which areas start active**. This sets how long every ladder takes.
2. **Goal definitions** marked ⚠: HSPU (wall ×5 or freestanding), Nordic
   (unassisted ×5 or weighted), and which KB standard you are aiming at.
3. **Bell sizes you own**, so K1–K6 can be set to real weights.
4. **Retire the old areas** (heel raise/pogo, sprint & hinge, weighted pull-up,
   KB press)? And **drop Achilles** from the check-in?
5. Anything wrong in a ladder: exercise choices, standards, `askAfter`.
