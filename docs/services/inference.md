# Inference Service

![Dashboard main view](../img/dashboard.png)

## Purpose

Central FastAPI service. Loads all pre-trained models into memory at startup, subscribes to the
Redis `transactions` channel, runs predictions, persists results to Postgres, and serves the
dashboard via SSE (live feed) and REST (DB-backed metrics and model catalog).

This service never calls `.fit()`. It only deserializes models and calls `.predict()`.

## Responsibilities

- Load every model and scaler referenced in `models/registry.json` via `joblib.load()` at startup.
- Sync the model catalog from `registry.json` into the Postgres `models` table.
- Subscribe to `transactions`; for each message: predict, write to `predictions`, push SSE event.
- Maintain per-model in-memory benchmark accumulators; finalize to `model_runs` on model switch
  or 30-second idle.
- Serve the full REST + SSE API to the dashboard and trainer.
- Relay `POST /control` commands to the Redis `control` channel so the streamer reacts to changes.
- Hot-reload models from disk on `POST /reload` without restarting.

## Inputs / Outputs

| Direction | Source / Consumer | Content |
|---|---|---|
| IN | Redis `transactions` | `{ dataset, features, actual }` |
| IN | `models/` (read-only) | `registry.json`, `*.joblib`, `scaler.joblib` |
| IN | Postgres | Read for metrics, history, catalog, benchmark runs |
| OUT | Postgres `predictions` | One row per prediction event |
| OUT | Postgres `models` | Upserted at startup and on `/reload` |
| OUT | Postgres `model_runs` | Written on model switch or idle timeout |
| OUT | Redis `control` | JSON command relayed from `POST /control` |
| OUT | HTTP SSE (`/stream`) | Live prediction events + running aggregates |
| OUT | HTTP REST | Metrics, history, catalog, progress, monitoring |

## Configuration (env vars)

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://...` — psycopg2 DSN (required) |
| `REDIS_URL` | Redis connection URL (default: `redis://localhost:6379/0`) |
| `MODELS_DIR` | Path to models directory (default: `/models`) |
| `DATA_DIR` | Path to data directory; used to count CSV rows for `/progress` |
| `START_DATASET` | Initial active dataset on startup (default: `fraud`) |

## Port

`8000` (mapped from host `INFERENCE_PORT`).

## Key files

| File | Role |
|---|---|
| `inference/app/main.py` | FastAPI app, lifespan, Redis subscriber, all endpoint handlers |
| `inference/app/model.py` | `ModelStore` — thread-safe model registry loader and predict |
| `inference/app/db.py` | SQLAlchemy schema definitions, `init_db()`, `get_engine()` |
| `inference/app/catalog.py` | `sync_registry_to_db()`, catalog query helpers |
| `inference/app/benchmark.py` | `BenchmarkRecorder`, `_RunAccumulator`, `_write_run_to_db()` |
| `inference/app/metrics.py` | In-memory aggregates, `fetch_metrics()`, `fetch_history()`, `fetch_progress()` |
| `inference/app/schemas.py` | Pydantic models for request/response validation |
| `inference/requirements.txt` | `fastapi`, `uvicorn`, `sse-starlette`, `redis`, `sqlalchemy`, `psycopg2-binary`, `scikit-learn`, `joblib`, `pandas`, `numpy`, `pydantic`, `httpx` |

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/stream` | SSE live feed — one event per prediction with running aggregates |
| GET | `/metrics?dataset=` | DB-backed accuracy, confusion matrix, latency avg/p95, throughput, accuracy-over-time buckets |
| GET | `/history?dataset=&limit=` | Recent prediction rows from Postgres (default 50, max 1000) |
| GET | `/registry` | Full `registry.json` content + current `active_dataset` / `active_model` |
| GET | `/progress?dataset=` | `rows_processed / total_rows / percent` for the dataset progress widget |
| GET | `/models` | Catalog of all models with each model's last-run summary |
| GET | `/models?dataset=` | Same, filtered by dataset |
| GET | `/models/{dataset}/{slug}` | Full detail for one model |
| GET | `/models/{dataset}/{slug}/runs` | All benchmark runs for a model, most recent first |
| GET | `/models/{dataset}/{slug}/last-run` | The `is_last=true` run (or `{ run: null }`) |
| GET | `/models/{dataset}/{slug}/current-run` | Live accumulator snapshot for the active model |
| GET | `/models/{dataset}/{model}/export?format=` | Download pre-generated model file (joblib / pickle / onnx / pmml) |
| POST | `/control` | Apply dataset/model/speed/pause change; relay to Redis; finalize benchmark run on model switch |
| POST | `/reload` | Re-read `registry.json`, `joblib.load` new/changed models, re-sync catalog to DB |
| GET | `/monitoring` | Aggregated health snapshot: postgres, redis, streamer, inference |
| GET | `/health` | Liveness: DB probe + Redis ping + models loaded count |

### SSE event shape (`GET /stream`)

```json
{
  "id": 1234,
  "dataset": "fraud",
  "prediction": 1,
  "actual": 1,
  "is_correct": true,
  "probability": 0.934,
  "latency_ms": 4.2,
  "ts": "2026-06-24T10:30:00.000Z",
  "running_accuracy": 0.971,
  "total_processed": 1234,
  "positive_count": 17,
  "throughput": 2.0,
  "avg_latency": 3.8
}
```

### `POST /control` payload

```json
{
  "interval_ms": 500,
  "paused": false,
  "dataset": "iot",
  "model": "rotormind-v1"
}
```

All fields are optional. `interval_ms` is validated: 50–60000. `dataset` must be one of
`fraud | iot | intrusion`. `model` must exist in the loaded store for the target dataset.

## Startup sequence

1. `model_store.load_all()` — reads `registry.json`, `joblib.load()` every model+scaler. Raises
   `FileNotFoundError` loudly if any file is missing (fail fast).
2. `init_db()` — connects to Postgres with retry/backoff (up to 10 attempts), runs
   `metadata.create_all(checkfirst=True)`.
3. `sync_registry_to_db()` — upserts `models` table from registry.
4. `_count_csv_rows()` — counts rows in each `sample.csv` for `/progress` denominator.
5. Redis client initialized; background thread subscribes to `transactions`.
6. Asyncio background task starts 15-second idle-check loop for benchmark finalization.

## How it fits the pipeline

```
Redis transactions
  → _redis_subscriber (background thread)
    → _handle_transaction()
      → model_store.predict()       — scale + predict, no .fit()
      → agg_store.record()          — in-memory running aggregates
      → run_recorder.update()       — benchmark accumulator
      → _thread_pool: _db_insert()  — Postgres insert, off event loop
      → asyncio: _broadcast_sse()   — push to all SSE queues
```

The DB insert and SSE broadcast are decoupled. A slow database write does not block the SSE feed.

## Gotchas / operational notes

- **Driver prefix** — `DATABASE_URL` must use `postgresql+psycopg2://` (not `postgresql+psycopg://`).
  The trainer uses the opposite. See `architecture/04-decisions.md` ADR-012.
- **Model files are read-only** — the `./models` directory is bind-mounted as `:ro`. Inference
  cannot write model artifacts. Only the trainer writes new artifacts; inference reloads them on
  `POST /reload`.
- **Thread pool size** — `ThreadPoolExecutor(max_workers=4)` handles DB inserts and all blocking
  SQLAlchemy calls. High prediction rates with slow DB writes can fill the queue; monitor
  `avg_latency_ms` and `throughput` at `/monitoring` for signs of back-pressure.
- **SSE queue per client** — each `GET /stream` consumer gets its own `asyncio.Queue(maxsize=256)`.
  Events dropped for slow consumers (`QueueFull`) rather than blocking the broadcaster.
- **Benchmark idle finalization** — if the stream stops (streamer paused/crashed), the idle-check
  loop finalizes the current accumulator after 30 seconds of no events. The `/monitoring` endpoint
  will show `streamer: down` via the stale heartbeat key.
- **`/export` path traversal guard** — the export endpoint resolves and validates that the file
  path stays under `MODELS_DIR/<dataset>/`. Slug characters are restricted to `[a-z0-9\-]`.
