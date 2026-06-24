---
name: roadmap-workflow
description: How to work this project task-by-task from the numbered roadmap — find the current task, execute it against its acceptance criteria, and update status. Use at the start of any work session, when asked "what's next", or after finishing a task.
---

# Roadmap Workflow

This project is built strictly **one numbered task at a time**, in order. The roadmap lives in
`.claude/roadmap/`.

## Finding the current task

1. Open `.claude/roadmap/00-INDEX.md`.
2. The status table lists every task in linear order with `☐` (todo) / `▶` (in progress) / `☑` (done),
   and a `CURRENT TASK` pointer.
3. The current task = the `CURRENT TASK` pointer, or if stale, the **lowest-numbered `☐`** task.
4. Open that task's file (e.g. `04-inference/02-redis-subscriber.md`) and read it fully.

## Executing a task

- Each task file has: **Goal · Prerequisites · Steps · Skills/Agent · Acceptance criteria · Status**.
- Confirm prerequisites are `☑`. If not, go do the prerequisite first.
- Invoke the **Skills/Agent** the task names (do not skip — best practices are mandatory here).
- Do only what the task scopes. Don't pull future tasks forward.
- Meet **every** acceptance criterion. If you discover the task is wrong/missing steps, update the task
  file first, then execute.

## Closing a task

1. Set `Status: ☑ done` (with a one-line note) in the task file.
2. In `00-INDEX.md`: flip the row to `☑` and move `CURRENT TASK` to the next `☐`.
3. Briefly tell the user what was completed and what's next.

## Rules

- One task `▶` at a time. Mark `▶` when you start, `☑` when acceptance is met.
- Never mark done what isn't verified against acceptance criteria.
- Keep the INDEX and task files as the live source of truth — they're how the next session knows where
  we are.

## Commands

- `/next-task` — print the current task and start it.
- `/service-status` — summarize progress across all services from the INDEX.
