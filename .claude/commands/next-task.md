---
description: Find the current numbered roadmap task and start working it
---

Use the `roadmap-workflow` skill.

1. Read `.claude/roadmap/00-INDEX.md`. Identify the `CURRENT TASK` (or the lowest-numbered `☐` if the
   pointer is stale).
2. Open and read that task file in full.
3. Confirm its prerequisites are `☑`. If a prerequisite is incomplete, switch to that one instead.
4. Tell me: the task id + goal, the skills/agent it requires, and the acceptance criteria.
5. Mark it `▶` in the INDEX and begin executing it (delegate to the named agent if appropriate).
