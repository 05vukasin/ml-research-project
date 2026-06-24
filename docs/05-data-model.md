# Data Model

## PostgreSQL tables

All three tables are created by `inference/app/db.py` via `metadata.create_all(checkfirst=True)`
at inference startup. They are idempotent — safe to run on an existing database.

See [services/postgres.md](services/postgres.md) for query patterns and index usage.

### `predictions`

One row per classified event. Every stream message produces exactly one row.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | Auto-increment |
| `dataset` | TEXT | `fraud` / `iot` / `intrusion` |
| `model_name` | TEXT | Active model slug at time of prediction |
| `received_at` | TIMESTAMPTZ | When inference received the Redis message |
| `processed_at` | TIMESTAMPTZ | When `model.predict()` returned |
| `latency_ms` | DOUBLE PRECISION | `(processed_at - received_at)` in milliseconds |
| `prediction` | SMALLINT | Model output: 0 or 1 |
| `actual_label` | SMALLINT | Ground-truth label from the stream: 0 or 1 |
| `is_correct` | BOOLEAN | `prediction = actual_label` |
| `probability` | DOUBLE PRECISION | `predict_proba` output for the positive class |
| `payload` | JSONB (nullable) | Raw feature dict snapshot for display and debug |

**Indexes:**
- `ix_predictions_dataset_received_at` on `(dataset, received_at)` — time-series queries, accuracy over time.
- `ix_predictions_dataset_is_correct` on `(dataset, is_correct)` — accuracy rollup and confusion matrix counts.

**Derived metrics** (computed by `/metrics` in `inference/app/metrics.py`):
- Running accuracy: `AVG(is_correct)` windowed or cumulative over `received_at`.
- Confusion matrix: TP/FP/TN/FN from `prediction` × `actual_label` filtered by `dataset`.
- Throughput: event count per second bucket on `received_at`.
- Latency: `AVG(latency_ms)` and approximate p95 over the selected window.

### `models` (model catalog)

Inference upserts this table from `registry.json` on startup and after every `POST /reload`.
The trainer also writes here after a successful training job (`source='trained'`). Rows not
present in `registry.json` are pruned in the same sync transaction.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `dataset` | TEXT | `fraud` / `iot` / `intrusion` |
| `slug` | TEXT | Kebab-case model identifier, e.g. `fraudguard-v1` |
| `name` | TEXT | Human-readable display name |
| `algo` | TEXT | Algorithm class name, e.g. `RandomForestClassifier` |
| `accuracy` | DOUBLE PRECISION | Test-set accuracy from training |
| `precision` | DOUBLE PRECISION | Test-set precision |
| `recall` | DOUBLE PRECISION | Test-set recall |
| `train_fraction` | DOUBLE PRECISION (nullable) | Fraction of data used for training; `null` for seeded models |
| `trained_at` | TEXT (nullable) | ISO date string, e.g. `2026-06-23` |
| `formats` | JSONB | `{ "joblib": "<file>", "pickle": "<file>", "onnx": "<file>", "pmml": null }` |
| `features` | JSONB | Ordered list of feature column names |
| `source` | TEXT | `'seeded'` (committed pre-trained) or `'trained'` (produced by trainer service) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Constraints:**
- Unique: `(dataset, slug)`.
- Index: `ix_models_dataset_slug` on `(dataset, slug)`.

On conflict, the upsert preserves `source='trained'` if the row already carries it (trainer-produced rows are not downgraded to `'seeded'` on a subsequent sync).

### `model_runs` (per-model benchmark runs)

One row per finalized benchmark window. A window opens when a model becomes active and closes
when the user switches to a different model, or after the stream has been idle for 30 seconds.
Exactly one row per `(dataset, model_slug)` carries `is_last=true` at any time.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `dataset` | TEXT | |
| `model_slug` | TEXT | |
| `started_at` | TIMESTAMPTZ | When this window opened |
| `ended_at` | TIMESTAMPTZ (nullable) | When this window was finalized |
| `total` | INTEGER | Events processed in this window |
| `correct` | INTEGER | Correct predictions in this window |
| `accuracy` | DOUBLE PRECISION | `correct / total` |
| `confusion` | JSONB | `{ "tp": 0, "fp": 0, "tn": 0, "fn": 0 }` |
| `avg_latency_ms` | DOUBLE PRECISION | Mean prediction latency for this window |
| `p95_latency_ms` | DOUBLE PRECISION (nullable) | 95th-percentile latency; `null` if fewer than 1 sample |
| `throughput_per_sec` | DOUBLE PRECISION | `total / elapsed_seconds` |
| `is_last` | BOOLEAN | `true` for the most recently finalized run per `(dataset, model_slug)` |

**Indexes:**
- `ix_model_runs_dataset_slug_started` on `(dataset, model_slug, started_at)` — run history queries.
- `ix_model_runs_is_last` on `(dataset, model_slug, is_last)` — fast last-run lookup.

---

## Model registry (`models/registry.json`)

`registry.json` is the authoritative list of available models. Inference and the trainer both
read and write it. The Postgres `models` table is a sync'd mirror.

Top-level structure:

```jsonc
{
  "<dataset_slug>": {
    "label": "Human-readable dataset name",
    "positive_label": "Label for class 1",
    "theme": { "accent": "#hex" },
    "models": [
      {
        "name": "FraudGuard v1",
        "slug": "fraudguard-v1",
        "algo": "RandomForestClassifier",
        "features": ["v1", "v2", "v3", "v4", "v5", "v6", "amount", "hour"],
        "classes": { "0": "Legit", "1": "Fraud" },
        "metrics": { "accuracy": 0.9342, "precision": 0.975, "recall": 0.3333 },
        "trained_at": "2026-06-23",
        "train_fraction": null,
        "formats": {
          "joblib": "fraudguard-v1.joblib",
          "pickle": "fraudguard-v1.pkl",
          "onnx": "fraudguard-v1.onnx",
          "pmml": null
        },
        "scaler": "scaler.joblib"
      }
    ]
  }
}
```

**Format values:** a non-null string means the file exists at `models/<dataset>/<filename>`.
A `null` value means the format was not generated (PMML — `sklearn2pmml` fails on this scikit-learn version). The dashboard disables
download buttons for null formats.

**Scaler:** each dataset directory has a single `scaler.joblib` shared by all models in that
dataset. The scaler is fit on the same training split used for the first seeded model.

**Trained models:** the trainer writes a slug-prefixed `<slug>.metadata.json` file rather
than clobbering the shared `metadata.json`. Multiple trained models can coexist in the same
dataset directory.

---

## Redis channels and keys

| Name | Type | Direction | Payload |
|---|---|---|---|
| `transactions` | pub/sub channel | streamer → inference | `{ "dataset": "fraud", "features": { ... }, "actual": 0 }` |
| `control` | pub/sub channel | inference → streamer | `{ "interval_ms": 500, "paused": false, "dataset": "iot", "model": "rotormind-v1" }` |
| `streamer:heartbeat` | STRING key (TTL=6s) | streamer → inference `/monitoring` | `{ "dataset": "fraud", "paused": false, "interval_ms": 500, "messages_sent": 12345, "rate": 1.98, "uptime_s": 3600.0, "ts": "2026-06-24T10:00:00+00:00" }` |

**`transactions` channel:** every field is required. `features` is a flat dict of numeric
values keyed by column name (lowercase). `actual` is 0 or 1.

**`control` channel:** all fields are optional. Inference publishes only the fields that
changed. The streamer ignores unknown fields. A `model` field without a `dataset` field
applies the model to the current dataset.

**`streamer:heartbeat` key:** written every ~2 seconds with a 6-second TTL. The TTL ensures
the key disappears within 6 seconds if the streamer stops. The inference `/monitoring`
endpoint reads this key; it reports `status: "down"` if the key is absent or the `ts` field
is more than 6 seconds in the past.

See [services/redis.md](services/redis.md) for Redis configuration details.
See [06-api-reference.md](06-api-reference.md) for the endpoints that read these tables.
