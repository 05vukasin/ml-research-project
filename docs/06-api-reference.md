# API Reference

Two HTTP services: inference on port 8000 and trainer on port 8001.

All endpoints return JSON. All `dataset` parameters are validated against `fraud | iot | intrusion`.
CORS is open (`*`) on both services.

---

## Inference service (port 8000)

### `GET /stream`

SSE live feed. Opens a persistent connection. The server pushes one event per classified
prediction plus periodic heartbeat comments to keep the connection alive.

**Event shape:**
```json
{
  "id": 1234,
  "dataset": "fraud",
  "prediction": 0,
  "actual": 0,
  "is_correct": true,
  "probability": 0.031,
  "latency_ms": 3.8,
  "ts": "2026-06-24T10:00:00.123456+00:00",
  "running_accuracy": 0.942,
  "total_processed": 1234,
  "positive_count": 71,
  "throughput": 1.98,
  "avg_latency": 4.1
}
```

`running_accuracy` is cumulative correct / total for the active dataset since the service started.
`throughput` is a rolling events-per-second estimate. Each client gets its own queue (max 256
events); slow consumers drop events rather than blocking the publisher.

---

### `GET /metrics`

Aggregated accuracy, confusion matrix, latency, and throughput from PostgreSQL.

**Query params:**
- `dataset` (required) — `fraud | iot | intrusion`

**Response shape:**
```json
{
  "total": 5000,
  "correct": 4712,
  "accuracy": 0.9424,
  "positive_count": 287,
  "confusion": { "tp": 95, "fp": 3, "tn": 4617, "fn": 285 },
  "avg_latency_ms": 4.1,
  "p95_latency_ms": 8.3,
  "throughput_per_sec": 1.98
}
```

---

### `GET /history`

Recent prediction rows from PostgreSQL, most recent first.

**Query params:**
- `dataset` (required) — `fraud | iot | intrusion`
- `limit` (optional, default 50, max 1000) — number of rows to return

**Response:** array of prediction row objects (all `predictions` table columns).

---

### `GET /registry`

The full `models/registry.json` content with the current active selection annotated.

**Response:**
```json
{
  "registry": { "fraud": { ... }, "iot": { ... }, "intrusion": { ... } },
  "active_dataset": "fraud",
  "active_model": "fraudguard-v1"
}
```

---

### `GET /progress`

Dataset progress — rows processed versus total rows in the CSV.

**Query params:**
- `dataset` (required) — `fraud | iot | intrusion`

**Response:**
```json
{
  "dataset": "fraud",
  "rows_processed": 1234,
  "total_rows": 5000,
  "percent": 24.68
}
```

---

### `GET /models`

Full model catalog from the Postgres `models` table with each model's last benchmark run
summary joined in.

**Query params:**
- `dataset` (optional) — filter to one dataset

**Response:** array of model objects. Each object includes all `models` table columns plus a
`last_run` key (the `model_runs` row with `is_last=true`, or `null`).

---

### `GET /models/{dataset}/{slug}`

Full detail for one model from the catalog.

**Path params:**
- `dataset` — `fraud | iot | intrusion`
- `slug` — model slug, e.g. `fraudguard-v1`

**Response:** single model object with `last_run` included. 404 if not found.

---

### `GET /models/{dataset}/{slug}/runs`

All benchmark runs for a model, most recent first.

**Path params:**
- `dataset`, `slug` — as above

**Response:** array of `model_runs` rows.

---

### `GET /models/{dataset}/{slug}/last-run`

The most recently finalized benchmark run (`is_last=true`), or `null`.

**Path params:**
- `dataset`, `slug` — as above

**Response:**
```json
{
  "run": {
    "id": 5, "dataset": "fraud", "model_slug": "fraudguard-v1",
    "started_at": "...", "ended_at": "...",
    "total": 800, "correct": 754, "accuracy": 0.9425,
    "confusion": { "tp": 28, "fp": 1, "tn": 726, "fn": 45 },
    "avg_latency_ms": 3.9, "p95_latency_ms": 7.2,
    "throughput_per_sec": 1.97, "is_last": true
  }
}
```
`run` is `null` if no run has been finalized yet.

---

### `GET /models/{dataset}/{slug}/current-run`

Live accumulator snapshot for the currently active model window. Returns `null` if the
specified model is not currently active.

**Path params:**
- `dataset`, `slug` — as above

**Response:**
```json
{
  "current_run": {
    "dataset": "fraud", "model_slug": "fraudguard-v1",
    "started_at": "...", "total": 200, "correct": 189,
    "accuracy": 0.945, "avg_latency_ms": 4.0, "throughput_per_sec": 1.99
  }
}
```

---

### `GET /models/{dataset}/{slug}/export`

Download a pre-generated model artifact.

**Path params:**
- `dataset`, `slug` — as above

**Query params:**
- `format` (required) — `joblib | pickle | onnx | pmml`

**Response:** file stream with `Content-Disposition: attachment`. Returns 404 if the format
is `null` in the registry or the file is missing on disk. Returns 400 for invalid format or
slug values. Path traversal is blocked — the resolved path must stay inside
`models/<dataset>/`.

---

### `POST /control`

Apply a control command. Updates the active dataset/model in inference memory, finalizes the
current benchmark run if the model is changing, and publishes the command to Redis `control`
for the streamer.

**Request body** (all fields optional, at least one should be present):
```json
{
  "interval_ms": 200,
  "paused": false,
  "dataset": "iot",
  "model": "rotormind-v1"
}
```

**Validation:** `model` must exist in the registry for the specified `dataset`
(or the current active dataset if `dataset` is omitted). Returns 400 on invalid input.

**Response:**
```json
{
  "status": "ok",
  "active_dataset": "iot",
  "active_model": "rotormind-v1",
  "command_published": { "interval_ms": 200, "dataset": "iot", "model": "rotormind-v1" }
}
```

---

### `POST /reload`

Hot-reload: re-reads `registry.json`, `joblib.load`s any new or changed models and scalers,
re-syncs the `models` table (upsert + prune). The active model is preserved if still in the
registry; otherwise inference falls back to the first available model.

Called by the trainer service after a training job completes. Can also be called manually.

**Response:**
```json
{
  "status": "ok",
  "models_loaded": 4,
  "registry_summary": {
    "datasets": ["fraud", "intrusion", "iot"],
    "active_dataset": "fraud",
    "active_model": "fraudguard-v1"
  }
}
```

---

### `GET /monitoring`

Aggregate health and stats from all backend services. Tolerates individual service failures —
never returns 500 due to a downstream error.

**Response:**
```json
{
  "postgres": {
    "status": "ok",
    "db_size_mb": 12.4,
    "predictions_total": 50000,
    "predictions_by_dataset": { "fraud": 20000, "iot": 18000, "intrusion": 12000 },
    "connections": 5
  },
  "redis": {
    "status": "ok",
    "version": "7.2.4",
    "used_memory_mb": 1.2,
    "connected_clients": 4,
    "ops_per_sec": 12,
    "pubsub": { "transactions": 1, "control": 1 }
  },
  "streamer": {
    "status": "ok",
    "dataset": "fraud", "paused": false, "interval_ms": 500,
    "messages_sent": 12345, "rate": 1.98, "uptime_s": 3600.0,
    "ts": "...", "age_s": 1.2
  },
  "inference": {
    "status": "ok",
    "models_loaded": 3,
    "active_dataset": "fraud",
    "active_model": "fraudguard-v1",
    "throughput": 1.98,
    "avg_latency_ms": 4.1,
    "sse_subscribers": 1,
    "uptime_s": 3601.4
  }
}
```

Each section returns `{ "status": "down", "error": "..." }` if its service is unreachable.

---

### `GET /health`

Basic liveness + readiness probe. Checks Postgres connectivity and Redis ping.

**Response:**
```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "models_loaded": 3,
  "active_dataset": "fraud",
  "active_model": "fraudguard-v1"
}
```

`status` is `"degraded"` if either `db` or `redis` is not `"ok"`.

---

## Trainer service (port 8001)

### `POST /train`

Start a background training job. Returns immediately with a `job_id`.

**Status:** 202 Accepted.

**Request body:**
```json
{
  "dataset": "fraud",
  "algo": "random_forest",
  "name": "My Model",
  "train_fraction": 0.8
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `dataset` | string | yes | `fraud | iot | intrusion` |
| `algo` | string | yes | must be in `/algos` list |
| `name` | string | yes | 1–80 characters, stripped |
| `train_fraction` | float | no (default 0.7) | 0.05–1.0 inclusive |

**Response:**
```json
{ "job_id": "a3f8c2d1-4b2e-4f3a-9c1d-..." }
```

Use `job_id` with `GET /train/stream` to follow progress.

---

### `GET /train/stream`

SSE progress stream for a training job.

**Query params:**
- `job_id` (required) — from `POST /train` response

**SSE events during training:**
```json
{ "step": 3, "total": 10, "accuracy": 0.871, "status": "running" }
```

**Final event on success:**
```json
{
  "status": "done",
  "slug": "my-model-abc123",
  "dataset": "fraud",
  "accuracy": 0.912,
  "precision": 0.93,
  "recall": 0.71,
  "train_fraction": 0.8,
  "formats": ["joblib", "pickle", "onnx"]
}
```

**Final event on failure:**
```json
{ "status": "error", "error": "Description of what went wrong" }
```

Returns 404 if `job_id` is not found.

---

### `GET /algos`

Available training algorithms for the Training Lab.

**Response:**
```json
[
  { "key": "random_forest", "label": "Random Forest" },
  { "key": "sgd", "label": "SGD Classifier" }
]
```

---

### `GET /stats`

Trainer service stats: active job count, last trained model summary, and uptime.

**Response:**
```json
{
  "active_jobs": 0,
  "last_trained": {
    "slug": "my-model-abc123",
    "dataset": "fraud",
    "accuracy": 0.912,
    "train_fraction": 0.8,
    "ts": "2026-06-24T10:00:00Z"
  },
  "uptime_s": 3600.1
}
```

`last_trained` is `null` if no job has completed since the service started.

---

### `GET /health`

Liveness probe.

**Response:**
```json
{ "status": "ok" }
```
