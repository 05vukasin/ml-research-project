# Architecture

## Diagram

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

![Dashboard showing the live pipeline](img/dashboard.png)

## Containers

| Container | Tech | Port | Role |
|---|---|---|---|
| `postgres` | PostgreSQL 16 | 5432 | Predictions, model catalog, benchmark runs |
| `redis` | Redis 7 | 6379 | Pub/sub broker: `transactions` (data) and `control` (commands) |
| `streamer` | Python | — | Replays CSV rows to Redis; no HTTP server |
| `inference` | FastAPI | 8000 | Loads models, classifies events, writes DB, serves SSE + REST |
| `trainer` | FastAPI | 8001 | Live Training Lab — trains on demand, exports, registers, reloads inference |
| `dashboard` | Next.js | 3000 | Animated real-time UI + controls + model export |

Startup order (compose `depends_on` + healthchecks):

```
redis, postgres (healthy)
  → inference (healthy)
    → trainer (healthy), dashboard
streamer → redis (healthy), inference (started)
```

## Serving path (forward data flow)

One event, end to end:

1. **Streamer** reads the next row from the active dataset's CSV.
2. Streamer publishes `{ "dataset": "fraud", "features": {...}, "actual": 0 }` to the Redis `transactions` channel and sleeps `interval_ms`.
3. **Inference** (subscribed to `transactions`) receives the message, selects the active model for the dataset, calls `scaler.transform()` then `model.predict()` + `predict_proba()`.
4. Inference computes `is_correct = prediction == actual` and `latency_ms`.
5. Inference inserts a row into `predictions` via a thread-pool executor (off the asyncio event loop).
6. Inference pushes a compact event with running aggregates onto every active SSE queue.
7. **Dashboard** consumes `GET /stream` (SSE) for the gauge, live feed, and pipeline animation; polls `GET /metrics`, `GET /history`, `GET /progress` (REST, PostgreSQL) for charts and KPIs.

## Control path (live, from UI)

1. Operator changes speed, pause state, dataset, or model in the settings popup.
2. Dashboard `POST /control` to inference with the changed fields.
3. Inference applies the change locally (switches active model in memory) and publishes the command to Redis `control`.
4. **Streamer** (subscribed to `control`) updates `interval_ms` / `paused`, or loads the new dataset CSV and resets to row 0.

## Training path (Training Lab)

1. Operator starts a training job from the Training Lab tab.
2. Dashboard `POST trainer:/train` with `{ dataset, algo, name, train_fraction }` → receives `job_id`.
3. Dashboard opens `GET /train/stream?job_id=` (SSE). Trainer fits the model incrementally and emits `{ step, total, accuracy, status }` after each batch.
4. On completion, trainer exports all formats, writes `<slug>.metadata.json`, upserts `registry.json`, writes a `models` row to Postgres (`source='trained'`), and calls `POST inference:/reload`.
5. Inference re-reads `registry.json`, `joblib.load`s new artifacts, and re-syncs the `models` table (pruning any orphans).

The serving path is never involved in training. Inference only calls `.predict()`.

## Why two transports (SSE + REST)

**SSE** pushes live events from inference to the dashboard with no polling lag — the gauge
updates within milliseconds of each prediction. It carries only the data the animation needs.

**REST over PostgreSQL** gives the dashboard historical aggregates (accuracy over time, full
confusion matrix, latency distribution) that SSE alone cannot provide. It also satisfies the
assignment requirement that the dashboard reads metrics from the database.

## Monitoring path

The Monitoring tab polls `GET /monitoring` (inference) and `GET /stats` (trainer) every ~2 seconds.

`/monitoring` collects four sections in a single request: PostgreSQL (size, prediction count, connections), Redis (version, memory, pubsub subscribers, ops/sec), streamer (reads the `streamer:heartbeat` Redis key), and inference itself (models loaded, throughput, SSE subscriber count). Each section tolerates its service being down and returns `{ "status": "down" }` rather than propagating a 500.

The streamer publishes `streamer:heartbeat` to a Redis STRING key with a 6-second TTL every ~2 seconds. If the key is absent or its timestamp is more than 6 seconds old, `/monitoring` marks the streamer as `down`.

![Monitoring tab](img/monitoring.png)

## Design decisions

The following summarizes the key architectural decisions. Full ADR text is in
`.claude/architecture/04-decisions.md`.

**ADR-001 — Redis pub/sub between streamer and inference.** Direct HTTP would couple the
services and make the control-back-channel awkward. Kafka is overkill at this scale. Redis
gives a realistic message-queue feel in a single lightweight container.

**ADR-002 — SSE for live events, REST for history.** SSE is simpler than WebSockets for
unidirectional server-push. REST-over-Postgres satisfies the assignment's "dashboard reads
from the DB" requirement and provides aggregates SSE cannot.

**ADR-003 — Pre-load all models at inference startup.** Dataset/model switching must be
instant. Loading every model at boot costs a few hundred MB of memory and removes any
per-request disk I/O from the hot path.

**ADR-004 — Three datasets, all binary with ground-truth labels.** Ground-truth labels make
the accuracy gauge a real metric. Multiple datasets show the architecture is domain-agnostic.

**ADR-005 — Pre-generate all export formats at training time.** The inference image carries
no heavy conversion dependencies. Downloads from the UI are instant file-serves.
Formats missing from the environment are marked `null` in the registry.

**ADR-007 — Redis as auxiliary infrastructure.** The four assignment logical units (database,
streamer, central app, dashboard) map to four containers. Redis is infrastructure, like
PostgreSQL.

**ADR-008 — Trainer as a separate service.** The assignment forbids the serving path from
training. A dedicated trainer service models the correct MLOps shape: training pipeline →
registry → serving reload. Inference never calls `.fit()`.

**ADR-009 — Synthetic datasets by default, real datasets optional.** The system runs offline
with no Kaggle account. Dropping in the real CSV requires no code changes.

**ADR-010 — `/reload` endpoint for hot model swap.** The trainer writes new artifacts and
calls `/reload`; inference re-reads the registry without restarting. A restart would clear
in-memory SSE state and require the dashboard to reconnect.

**ADR-011 — PMML is `null` on this runtime.** The trainer image ships a JRE (`default-jre-headless`),
but `sklearn2pmml` conversion fails on this scikit-learn version, so PMML is gracefully skipped.
joblib, pickle, and ONNX are always produced; a compatible `sklearn2pmml`/scikit-learn pairing re-enables it.

**ADR-012 — psycopg2 in inference, psycopg3 in trainer.** Inference uses `psycopg2-binary`
(`postgresql+psycopg2://` DSN). The trainer was added later and uses `psycopg[binary]` v3
(`postgresql+psycopg://` DSN). The trainer constructs its DSN from `POSTGRES_*` env vars
at compose time; no separate `TRAINER_DATABASE_URL` is needed in `.env`.

**ADR-013 — DB-backed model catalog with registry-driven prune.** `registry.json` is
authoritative. The Postgres `models` table is a sync'd mirror that enables SQL joins and
makes trainer-written rows visible. Pruning prevents phantom entries.

**ADR-014 — Automatic benchmark runs.** When the active model changes or the stream idles
for 30 seconds, inference finalizes a `model_runs` row. One row per model carries
`is_last=true`. Benchmark data accumulates without user action.

**ADR-015 — `/monitoring` aggregator + streamer heartbeat.** Routing all service health
through inference keeps the browser talking to one origin. The Redis-key heartbeat avoids
adding an HTTP server to the streamer.

See [03-workflow.md](03-workflow.md) for step-by-step workflows and message shapes.
See [05-data-model.md](05-data-model.md) for the Postgres schema and Redis channel payloads.
