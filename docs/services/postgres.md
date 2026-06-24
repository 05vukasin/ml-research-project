# PostgreSQL

![PostgreSQL monitoring card](../img/monitoring.png)

## Purpose

Durable store for every prediction the inference service processes, the model catalog synced from
`registry.json`, and per-model benchmark run windows.

## Responsibilities

- Persist every prediction row written by inference (one row per stream event).
- Hold the model catalog (`models` table) so the dashboard can query model metadata without reading
  files from disk at request time.
- Record finalized benchmark windows in `model_runs` for the BenchmarkSurface display.

## Inputs / Outputs

| Direction | Source / Consumer | Content |
|---|---|---|
| IN (writes) | inference service | `predictions` rows, `models` upserts, `model_runs` inserts |
| IN (writes) | trainer service | `models` upserts with `source='trained'` |
| OUT (reads) | inference service | All three tables, via SQLAlchemy Core |

No other service reads directly from Postgres. The dashboard reads through the inference REST API.

## Schema

### `predictions`

Created by `inference/app/db.py` via `metadata.create_all(checkfirst=True)` at inference startup.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `dataset` | TEXT NOT NULL | `fraud` / `iot` / `intrusion` |
| `model_name` | TEXT NOT NULL | active model slug at prediction time |
| `received_at` | TIMESTAMPTZ NOT NULL | when inference received the Redis message |
| `processed_at` | TIMESTAMPTZ NOT NULL | when `predict()` completed |
| `latency_ms` | DOUBLE PRECISION NOT NULL | `processed_at - received_at` in ms |
| `prediction` | SMALLINT NOT NULL | 0 or 1 |
| `actual_label` | SMALLINT NOT NULL | ground-truth label from the stream |
| `is_correct` | BOOLEAN NOT NULL | `prediction = actual_label` |
| `probability` | DOUBLE PRECISION NOT NULL | predicted probability of the positive class |
| `payload` | JSONB NULLABLE | feature snapshot for display/debug |

**Indexes:**
- `ix_predictions_dataset_received_at` on `(dataset, received_at)` — time-series metrics queries
- `ix_predictions_dataset_is_correct` on `(dataset, is_correct)` — accuracy rollup queries

### `models`

Inference upserts this table from `registry.json` on startup and after every `POST /reload`. Trainer
writes here after a successful training job. Rows absent from `registry.json` are pruned on each sync.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `dataset` | TEXT NOT NULL | |
| `slug` | TEXT NOT NULL | kebab-case identifier |
| `name` | TEXT NOT NULL | display name |
| `algo` | TEXT NOT NULL | e.g. `RandomForestClassifier` |
| `accuracy` | DOUBLE PRECISION NULLABLE | test-set accuracy |
| `precision` | DOUBLE PRECISION NULLABLE | |
| `recall` | DOUBLE PRECISION NULLABLE | |
| `train_fraction` | DOUBLE PRECISION NULLABLE | null for seeded models |
| `trained_at` | TEXT NULLABLE | ISO date string |
| `formats` | JSONB NULLABLE | `{ joblib, pickle, onnx, pmml }` — filename or null |
| `features` | JSONB NULLABLE | ordered list of feature column names |
| `source` | TEXT NOT NULL DEFAULT `'seeded'` | `'seeded'` or `'trained'` |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `updated_at` | TIMESTAMPTZ NOT NULL | |

**Constraint:** `UNIQUE (dataset, slug)` — `uq_models_dataset_slug`
**Index:** `ix_models_dataset_slug` on `(dataset, slug)`

The `ON CONFLICT DO UPDATE` upsert preserves `source='trained'` if the row already carries it. A
registry sync never downgrades a trainer-produced model to `'seeded'`.

### `model_runs`

One row per finalized benchmark window. A window starts when a model becomes active and closes when
the user switches to a different model, or after 30 seconds of inactivity. Exactly one row per
`(dataset, model_slug)` carries `is_last = true`.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `dataset` | TEXT NOT NULL | |
| `model_slug` | TEXT NOT NULL | |
| `started_at` | TIMESTAMPTZ NOT NULL | when window opened |
| `ended_at` | TIMESTAMPTZ NULLABLE | when window was finalized |
| `total` | INTEGER NOT NULL | events processed in this window |
| `correct` | INTEGER NOT NULL | correct predictions in this window |
| `accuracy` | DOUBLE PRECISION NOT NULL | `correct / total` |
| `confusion` | JSONB NOT NULL | `{ tp, fp, tn, fn }` |
| `avg_latency_ms` | DOUBLE PRECISION NOT NULL | |
| `p95_latency_ms` | DOUBLE PRECISION NULLABLE | requires at least 1 sample |
| `throughput_per_sec` | DOUBLE PRECISION NOT NULL | `total / elapsed_seconds` |
| `is_last` | BOOLEAN NOT NULL DEFAULT `false` | exactly one `true` per `(dataset, model_slug)` |

**Indexes:**
- `ix_model_runs_dataset_slug_started` on `(dataset, model_slug, started_at)`
- `ix_model_runs_is_last` on `(dataset, model_slug, is_last)`

## Configuration (env vars)

| Variable | Default in `.env.example` | Notes |
|---|---|---|
| `POSTGRES_USER` | `mlops` | |
| `POSTGRES_PASSWORD` | `mlops_secret_change_me` | Change in production |
| `POSTGRES_DB` | `mlops` | |
| `POSTGRES_PORT` | `5432` | Host-side port; container always uses 5432 |

Inference reads `DATABASE_URL` (`postgresql+psycopg2://...`).
Trainer constructs its DSN from `POSTGRES_USER/PASSWORD/DB` in `docker-compose.yml`
(`postgresql+psycopg://...`) — two different driver prefixes, one Postgres instance.

## Port

`5432` (mapped from host `POSTGRES_PORT`).

## Key files

- `inference/app/db.py` — schema definitions (`Table`, `Index`), `init_db()`, `get_engine()`
- `inference/app/catalog.py` — `sync_registry_to_db()`, `fetch_catalog()`, related query helpers
- `inference/app/benchmark.py` — `_write_run_to_db()`, `BenchmarkRecorder`
- `inference/app/metrics.py` — `fetch_metrics()`, `fetch_history()`, `fetch_progress()`
- `trainer/app/training.py` — `upsert_model_to_db()`

## How it fits the pipeline

```
inference startup
  → init_db() creates tables with checkfirst=True
  → sync_registry_to_db() upserts model rows

Per prediction event (hot path)
  → _db_insert() writes a predictions row (runs in thread pool, off event loop)
  → run_recorder.update() accumulates stats in memory

Model switch (POST /control)
  → run_recorder.finalize_and_reset() writes model_runs row, resets accumulator

Trainer job completion
  → upsert_model_to_db() writes models row with source='trained'
  → inference /reload → sync_registry_to_db() re-syncs catalog
```

## Healthcheck

```
pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}
```

Interval: 5 s, timeout: 5 s, retries: 10, start period: 10 s.
Inference and trainer both wait for `postgres: service_healthy` before starting.

## Gotchas / operational notes

- **No migrations tool** — `create_all(checkfirst=True)` is idempotent on a blank database but will
  not add columns to an existing schema. If you change the schema, drop and recreate the volume
  (`docker compose down -v`) or write a manual `ALTER TABLE`.
- **Driver mismatch** — inference uses `psycopg2-binary` (`postgresql+psycopg2://` DSN); trainer
  uses `psycopg[binary]` v3 (`postgresql+psycopg://` DSN). The DSN prefix must match the installed
  driver or SQLAlchemy will raise `NoSuchModuleError`. See `architecture/04-decisions.md` ADR-012.
- **Volume** — data lives in the `postgres_data` named volume. Removing it with `docker compose
  down -v` wipes all predictions and benchmark history.
- The `DATABASE_URL` in `.env.example` uses the internal Docker hostname `postgres`, not
  `localhost`. Do not use it from your host machine directly.
