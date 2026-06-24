---
description: Summarize roadmap progress across all services
---

Read `.claude/roadmap/00-INDEX.md` and every task file's `Status:` line.

Produce a compact per-service summary:
- For each service group (foundation, training, database, inference, streamer, dashboard, docker, docs,
  verification): `done / total` and the next `☐` task.
- Then the single overall `CURRENT TASK` and any tasks marked `▶`.
- Flag any inconsistency between the INDEX table and individual task `Status:` lines.
