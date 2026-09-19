# Start here

1. Open a **new Claude Code session** with this folder (`training-app`) as the working directory.
2. Paste the prompt below as your first message.
3. That's it. Everything the session needs is already in this folder.

---

## The prompt to paste

```
Read BRIEF.md and build Milestone 1.

This is a personal training-log PWA for my Android phone. The full spec, the
tech decisions and the build order are all in BRIEF.md. The training plan
itself is already encoded in data/plan.json — 73 sessions, don't re-derive it.

Build Milestone 1 only (shell + PWA install + Plan browser), then stop and
show me how to get it on my phone. Don't start Milestone 2 until I say so.
```

---

## What's in this folder

| Path | What it is |
|---|---|
| `BRIEF.md` | The build spec. Tech decisions, data model, screens, milestones. |
| `data/plan.json` | **The whole training plan as data.** 73 sessions, 282 exercises. Already built — this was the hard part. |
| `data/Tracker-Sessions.csv` | Flat session list. Backup reference. |
| `data/Tracker-Benchmarks.csv` | Week-by-week targets across all seven tracks. |
| `reference/Integrated-Plan-Sep-Dec-2026.docx` | The source plan document, for context. |

## Why the milestones are ordered the way they are

**The plan starts Monday 21 September.** Milestone 1 alone — just browsing the
plan on your phone — is genuinely useful on day one, so ship it before anything
else. Logging can arrive in week 2 or 3 without losing much.

**The real deadline is Friday 6 November.** That's the W8 retest, where your
pull-up 5RM changes and every load in Block 3 gets recalculated off the new
number. Milestone 3 (baselines + load maths) must be working by then or you're
back to doing arithmetic on a gym floor.
