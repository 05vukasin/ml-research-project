# MLOps Real-Time ML Monitoring — Project Context

> This file is auto-loaded at the start of every Claude session in this repo.
> It is the single source of truth for **what we are building**, **how we work**, and **what to do next**.

## 1. What this project is

A real-time MLOps monitoring system. A streaming service replays a public dataset row-by-row, a
central inference service runs a **pre-trained, serialized** scikit-learn model over the stream, results
are stored in PostgreSQL, and a modern animated Next.js dashboard visualizes model performance live.

The hero metric is a **central accuracy gauge** that shows, in real time, how precise the model is
(running accuracy = correct predictions / total, computed against ground-truth labels in the stream).

**Hard rule (from the assignment):** the **inference/serving path** NEVER trains. The inference service
only deserializes models and calls `.predict()`. Pre-trained models are committed so the system runs
out-of-the-box.

**Live training feature (additive, on top of the rule):** a dedicated, user-triggered `trainer` service
lets you train a new model from the dashboard's **Training Lab** and watch accuracy climb live, then it
auto-exports to all formats, registers itself, and inference hot-reloads it. This is a separate training
pipeline — it does NOT make inference train to serve predictions. Two distinct paths:
- *Serving path:* streamer → inference (`.predict()` only, never `.fit()`).
- *Training path:* Training Lab → trainer (`.fit()` incrementally, streams progress) → registry → inference `/reload`.

## 2. Architecture (one screen)

```
CSV ─▶ streamer ──(Redis: "transactions")──▶ inference (FastAPI) ──INSERT──▶ PostgreSQL
                                                  │  loads model.joblib, .predict()
        ◀──(Redis: "control": speed/pause/dataset)│
                                                  ▼  SSE (live) + REST (history/metrics, reads DB)
                                            dashboard (Next.js + shadcn + Motion + Recharts + React Flow)
```

Six containers, one command (`docker compose up --build`): `postgres`, `redis`, `streamer`,
`inference`, `trainer`, `dashboard`. (`trainer` powers the live Training Lab; the four assignment
logical units — DB, streamer, central app, dashboard — remain cleanly separated.) Full detail in
`.claude/architecture/`.

## 3. Key decisions (do not re-litigate — see `architecture/04-decisions.md`)

- **3 datasets**, all binary classification with ground-truth labels: `fraud`, `iot`, `intrusion`.
- **Model registry** at `models/<dataset>/` + `models/registry.json`. Models pre-trained & committed.
- **Redis pub/sub** between streamer and inference (channels: `transactions`, `control`).
- **SSE** for live dashboard animation; **REST** for DB-backed history/metrics.
- **Dataset & model switch live** from a dashboard settings popup via the `control` channel.
- **Model export** in joblib / pickle / ONNX / PMML, downloadable from the dashboard.
- **Style:** clean light, shadcn/ui + Tailwind.

## 4. How we work — ROADMAP-DRIVEN, TASK BY TASK (mandatory)

1. Open `.claude/roadmap/00-INDEX.md`. It has the linear task order, a status table, and a
   `CURRENT TASK` pointer.
2. Work the **lowest-numbered unfinished task only**. Do not jump ahead or batch unrelated tasks.
3. Each task file has: Goal · Prerequisites · Steps · Skills/Agent · Acceptance criteria · Status.
   Follow it. Meet every acceptance criterion before moving on.
4. When done: set the task `Status: ☑ done` in its file AND update the status table + `CURRENT TASK`
   in `00-INDEX.md`.
5. Use `/next-task` to be told the current task; `/service-status` for an overview.

## 5. Skills you MUST use (best practices are non-negotiable here)

Match the skill to the work. The PostToolUse hooks will remind you, but invoke proactively:

| When you are working on… | Always use these skills |
|---|---|
| Any dashboard UI (`dashboard/**`, `*.tsx`, `*.css`) | `design-taste` (project), `realtime-ui` (project), `shadcn`, `web-design-guidelines`, `vercel-react-best-practices`, `vercel-react-view-transitions`, `next-best-practices` |
| Finishing/reviewing frontend | `react-doctor`, `web-perf`, `/design-review` |
| Python services (inference/streamer/training) | `mlops-architecture` (project), `security-best-practices` |
| Anything touching Postgres | `postgres` |
| Writing docs / README | `stop-slop` |
| Bug hunting / regressions | `diagnose` |
| Verifying a change runs | `verify`, `run` |
| Editing this `.claude/` config | `update-config` (settings/hooks), `skill-creator` (new skills) |

Project skills live in `.claude/skills/`. Global skills are referenced by name (no install needed).

## 6. Conventions

- All docs and `.md` files in **English**. Code comments in English.
- Datasets keyed by slug: `fraud`, `iot`, `intrusion`. Model slugs are kebab-case (`fraudguard-v1`).
- Redis channels: `transactions` (data), `control` (commands). Keep payloads JSON.
- Env config via `.env` (never hardcode secrets/ports). See `.env.example`.
- Python: type hints, small pure functions, no training at runtime.
- Frontend: Server Components by default; `"use client"` only where interactivity/SSE is needed.
- Prefer reusing the libraries listed in the plan over adding new dependencies.

## 7. Pointers

- Plan of record: `/home/vukasin/.claude/plans/imam-projekat-koji-treba-merry-wand.md`
- Architecture: `.claude/architecture/00-overview.md` … `05-ml-lifecycle.md`
- Roadmap index: `.claude/roadmap/00-INDEX.md`
- Custom agents: `.claude/agents/` · Custom skills: `.claude/skills/` · Commands: `.claude/commands/`
