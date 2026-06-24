# Trainer Service

![Training Lab](../img/training-lab.png)

## Purpose

Live Training Lab backend. Accepts user-triggered training requests from the dashboard, fits a model
incrementally while streaming per-step progress via SSE, exports all serialization formats on
completion, and tells inference to hot-reload. The trainer is the only service that calls `.fit()`
at runtime; the inference serving path is never involved.

## Responsibilities

- Accept `POST /train` requests with `{ dataset, algo, name, train_fraction }`.
- Run an incremental training job in a background thread, emitting progress events after each batch.
- Export the trained model to joblib, pickle, and ONNX (PMML is attempted but currently fails on
  this scikit-learn version, so it is skipped).
- Write a slug-prefixed metadata file (`<slug>.metadata.json`) and upsert `registry.json`.
- Upsert a `models` row in Postgres with `source='trained'` and `train_fraction`.
- `POST inference:/reload` so the new model is live immediately.
- Expose `/algos` (algorithm list) and `/stats` (uptime, active jobs, last trained).

## Inputs / Outputs

| Direction | Source / Consumer | Content |
|---|---|---|
| IN | Dashboard `POST /train` | `{ dataset, algo, name, train_fraction }` |
| IN | `DATA_DIR/<slug>/sample.csv` | Training data |
| OUT | `MODELS_DIR/<dataset>/` | `<slug>.joblib`, `<slug>.pkl`, `<slug>.onnx`, `<slug>.pmml` (skipped on this runtime), `<slug>.metadata.json`, `scaler.joblib` |
| OUT | `MODELS_DIR/registry.json` | Upserted with the new model entry |
| OUT | Postgres `models` | Row with `source='trained'`, `train_fraction` |
| OUT | inference `POST /reload` | Triggers in-memory model reload |
| OUT | SSE (`GET /train/stream?job_id=`) | Progress events + final result |

## Configuration (env vars)

| Variable | Default | Notes |
|---|---|---|
| `MODELS_DIR` | `/models` | Read-write mount; trainer writes artifacts here |
| `DATA_DIR` | `/data` | Read-only mount |
| `INFERENCE_URL` | `http://inference:8000` | Target for `POST /reload` |
| `DATABASE_URL` | `postgresql+psycopg://mlops:mlops@postgres:5432/mlops` | psycopg v3 DSN — note the `+psycopg` prefix, not `+psycopg2` |

The trainer constructs `DATABASE_URL` from `POSTGRES_USER/PASSWORD/DB` in `docker-compose.yml`
rather than from a `.env` variable directly.

## Port

`8001` (mapped from host `TRAINER_PORT`).

## Key files

| File | Role |
|---|---|
| `trainer/app/main.py` | FastAPI app, `POST /train`, `GET /train/stream`, `/algos`, `/stats`, `/health` |
| `trainer/app/training.py` | Full training pipeline: load data, scale, split, incremental fit, export all formats, upsert registry, upsert DB, notify inference |
| `trainer/app/jobs.py` | In-memory job store (`TrainingJob` dataclass, `create_job`, `get_job`) |
| `trainer/app/config.py` | `ALGOS`, `DATASET_CONFIG`, `VALID_DATASETS`, `VALID_ALGOS`, env var reads |
| `trainer/requirements.txt` | `fastapi`, `uvicorn`, `sse-starlette`, `scikit-learn`, `joblib`, `pandas`, `numpy`, `skl2onnx`, `onnx`, `onnxruntime`, `sklearn2pmml`, `httpx`, `pydantic`, `sqlalchemy`, `psycopg[binary]` |
| `trainer/Dockerfile` | Installs `default-jre-headless` (for `sklearn2pmml`; PMML still fails on this scikit-learn version) |

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/train` | Start training job; returns `{ job_id }` with HTTP 202 |
| GET | `/train/stream?job_id=` | SSE stream: progress events, then a terminal done/error event |
| GET | `/algos` | List of available algorithms: `random_forest`, `sgd` |
| GET | `/stats` | `{ active_jobs, last_trained: { slug, dataset, accuracy, train_fraction, ts }, uptime_s }` |
| GET | `/health` | `{ status: "ok" }` |

### `POST /train` payload

```json
{
  "dataset": "fraud",
  "algo": "random_forest",
  "name": "My RF Model",
  "train_fraction": 0.7
}
```

- `dataset`: `fraud` | `iot` | `intrusion`
- `algo`: `random_forest` | `sgd`
- `name`: 1–80 characters; slugified to form the model slug (`"My RF Model"` → `"my-rf-model"`)
- `train_fraction`: 0.05–1.0, default 0.7. `test_size = 1 - train_fraction`.

### SSE progress event (`GET /train/stream?job_id=`)

Progress events during training:
```json
{ "step": 4, "total": 16, "accuracy": 0.912, "status": "training" }
```

Terminal event on completion:
```json
{
  "status": "done",
  "dataset": "fraud",
  "name": "My RF Model",
  "slug": "my-rf-model",
  "algo": "RandomForestClassifier",
  "accuracy": 0.934,
  "precision": 0.975,
  "recall": 0.612,
  "train_fraction": 0.7,
  "formats": { "joblib": "my-rf-model.joblib", "pickle": "my-rf-model.pkl", "onnx": "my-rf-model.onnx", "pmml": null },
  "reload_ok": true
}
```

Terminal event on failure:
```json
{ "status": "error", "error": "<message>" }
```

## Incremental training strategies

### `random_forest`

Uses `RandomForestClassifier(warm_start=True)`. Grows `n_estimators` from 1 to 120 across 16 steps.
Each step calls `.fit()` on the full training set with more trees. Test accuracy is emitted after
each step, producing a monotone-increasing accuracy curve on screen.

### `sgd`

Uses `SGDClassifier(loss='log_loss')` with `partial_fit()`. Runs 16 epochs over the full training
set. Each epoch shuffles the data independently. Balanced class weights are computed once from the
full training set and applied per batch via `sample_weight`.

## How it fits the pipeline

```
Dashboard POST /train
  → create_job() → TrainingJob stored in memory
  → run_in_executor(_executor, _run_job_in_thread, job)
  → run_training_job():
      load CSV → StandardScaler → train_test_split
      → incremental fit (emit progress per step)
      → export: joblib / pickle / onnx / pmml
      → write <slug>.metadata.json
      → upsert registry.json
      → upsert_model_to_db() → Postgres models row (source='trained')
      → notify_reload() → POST inference:/reload
  → inference: reload() → sync_registry_to_db() → new model live

Dashboard GET /train/stream?job_id=
  → _sse_generator() polls job.events list
  → yields progress events until status=done/error
```

## Metadata file vs shared metadata

The trainer writes `<slug>.metadata.json` (e.g. `my-rf-model.metadata.json`) per model, not the
shared `metadata.json` used by seeded models. This prevents collisions when multiple trainer-produced
models coexist in the same dataset directory. Inference does not read these files at runtime; it reads
`registry.json` and the joblib artifacts only.

## Gotchas / operational notes

- **psycopg v3** — `DATABASE_URL` must use `postgresql+psycopg://` (not `postgresql+psycopg2://`).
  The trainer's `requirements.txt` pins `psycopg[binary]==3.2.3`. See `architecture/04-decisions.md`
  ADR-012.
- **DB tolerance** — `upsert_model_to_db()` catches all exceptions and logs a warning rather than
  failing the job. A training run succeeds even if Postgres is unreachable; the model is still saved
  to disk and registered. The Postgres row can be recovered by triggering `POST inference:/reload`.
- **PMML is skipped** — the Dockerfile installs `default-jre-headless`, but `sklearn2pmml`
  conversion still fails on this scikit-learn version. The trainer catches the error, logs a
  warning, and sets `formats.pmml = null`. The job completes normally; joblib/pickle/ONNX are
  always produced.
- **ONNX bool coercion patch** — `training.py` patches `onnx.helper.make_attribute` at import time
  to coerce `numpy.bool_` values to `int`. This works around a serialization mismatch between
  `skl2onnx` and the protobuf backend. The patch is applied before any `skl2onnx` import.
- **One job at a time** — `ThreadPoolExecutor(max_workers=2)` allows two concurrent jobs, but the
  models directory is a single write target. Simultaneous training of two models for the same
  dataset and slug will corrupt each other's artifacts. The dashboard serializes training requests
  by design.
- **Job store is in-memory** — `TrainingJob` objects live in a module-level dict. Restarting the
  trainer container clears all job history. Jobs in flight at restart time are lost silently.
- **Models volume is read-write** — unlike inference (`:ro`), the trainer mounts `./models`
  without the `:ro` flag. Any process in the trainer container can write to `MODELS_DIR`.
