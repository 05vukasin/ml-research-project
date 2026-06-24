# 00 — Architecture Overview

## Problem & domain

We monitor the live performance of a machine-learning model "in production". A real system would
receive a continuous stream of events (transactions, sensor readings, network packets) and a model
would classify each one. Operators need to see, in real time: how many events are processed, how fast,
and **how accurate the model is**.

We simulate this with a public dataset replayed as a stream. Because the dataset includes ground-truth
labels, we can compute the model's **real** running accuracy and show it as the dashboard's hero gauge.

## Goals

- One-command startup (`docker compose up --build`).
- Strict separation of concerns into containers (DB, broker, streamer, inference, dashboard).
- Pre-trained, serialized model — **no training at runtime**.
- A modern, animated, interactive dashboard that makes the live pipeline tangible.
- Multiple datasets and selectable/named models, switchable live from the UI.
- Model export in multiple serialization formats, downloadable from the UI.

## High-level diagram

```
            ┌──────────────────────────────────────────────────────────────────┐
            │                        docker compose (6 containers)              │
            │                                                                   │
 CSV ──▶ streamer ──▶ Redis (transactions) ──▶ inference ──INSERT──▶ PostgreSQL │
            ▲                                      │  joblib.load, .predict()   │
            └──── Redis (control) ◀────────────────┤                            │
                                                   │ SSE + REST                 │
                                                   ▼                            │
                                             dashboard (Next.js)                │
                                             trainer (FastAPI) ◀── Training Lab │
            └──────────────────────────────────────────────────────────────────┘
                                                   ▲
                                             browser (operator)
```

## Components at a glance

| Component | Tech | Port | Responsibility |
|---|---|---|---|
| streamer | Python | — | Replay CSV rows to Redis at a controllable rate; switch dataset on command |
| inference | FastAPI | 8000 | Consume stream, run pre-loaded model `.predict()`, persist results, serve SSE/REST |
| trainer | FastAPI | 8001 | User-triggered live training via Training Lab; exports, registers, and reloads into inference |
| postgres | PostgreSQL | 5432 | Store every prediction + timing for history/metrics |
| redis | Redis | 6379 | Pub/sub broker: `transactions` (data) and `control` (commands) |
| dashboard | Next.js + shadcn | 3000 | Animated real-time visualization + controls + model export + Training Lab |

## Glossary

- **Running accuracy** — cumulative `correct / total` of predictions vs ground-truth labels.
- **Active dataset / active model** — the dataset+model currently being streamed and scored.
- **Model registry** — `models/registry.json` indexing every trained model and its export formats.
- **Control channel** — Redis channel carrying speed/pause/dataset/model commands from the UI.
- **Positive class** — the "interesting" label per dataset (fraud / failure / attack).

See sibling docs: `01-data-flow.md`, `02-services.md`, `03-data-model.md`, `04-decisions.md`, `05-ml-lifecycle.md`.
