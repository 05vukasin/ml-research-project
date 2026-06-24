# 03 — Data Model

## PostgreSQL — table `predictions`

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `dataset` | TEXT | `fraud` / `iot` / `intrusion` |
| `model_name` | TEXT | active model slug at time of prediction |
| `received_at` | TIMESTAMPTZ | when inference received the event |
| `processed_at` | TIMESTAMPTZ | when prediction completed |
| `latency_ms` | DOUBLE PRECISION | `processed_at - received_at` in ms |
| `prediction` | SMALLINT | 0/1 |
| `actual_label` | SMALLINT | 0/1 ground truth from stream |
| `is_correct` | BOOLEAN | `prediction = actual_label` |
| `probability` | DOUBLE PRECISION | predicted prob of positive class |
| `payload` | JSONB (nullable) | feature snapshot for display/debug |

Indexes: `(dataset, received_at)` for time-series metrics; `(dataset, is_correct)` for accuracy rollups.

### Derived metrics (computed in SQL for `/metrics`)
- Running accuracy over time: window/cumulative `avg(is_correct)`.
- Throughput: count per second bucket on `received_at`.
- Confusion counts: TP/FP/TN/FN from `prediction` × `actual_label`, filtered by `dataset`.
- Latency: avg / p95 over `latency_ms`.

## PostgreSQL — table `models` (model catalog)

Inference upserts this table from `registry.json` on startup and after every `/reload`. The trainer also
writes here after a successful training job. Rows not present in `registry.json` are pruned on each sync,
so `/models` never returns phantoms.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `dataset` | TEXT | `fraud` / `iot` / `intrusion` |
| `slug` | TEXT | kebab-case model identifier |
| `name` | TEXT | human-readable display name |
| `algo` | TEXT | e.g. `RandomForestClassifier` |
| `accuracy` | DOUBLE PRECISION | test-set accuracy from training |
| `precision` | DOUBLE PRECISION | test-set precision |
| `recall` | DOUBLE PRECISION | test-set recall |
| `train_fraction` | DOUBLE PRECISION (nullable) | fraction of data used for training; null for seeded models |
| `trained_at` | TEXT (nullable) | ISO date string |
| `formats` | JSONB | `{ joblib, pickle, onnx, pmml }` — file names or null |
| `features` | JSONB | ordered list of feature column names |
| `source` | TEXT | `'seeded'` (committed pre-trained) or `'trained'` (produced by trainer service) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

Unique constraint: `(dataset, slug)`. Index: `(dataset, slug)`.

On conflict, the upsert preserves `source='trained'` if the row already carries it.

## PostgreSQL — table `model_runs` (per-model benchmark runs)

One row per finalized benchmark window for a model. A window starts when a model becomes active and ends
when the user switches to a different model, or after 30 seconds of idle (no incoming events). At most one
row per model carries `is_last=true` — the most recently finalized run.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `dataset` | TEXT | |
| `model_slug` | TEXT | |
| `started_at` | TIMESTAMPTZ | when this window opened |
| `ended_at` | TIMESTAMPTZ (nullable) | when this window was finalized |
| `total` | INTEGER | events processed in this window |
| `correct` | INTEGER | correct predictions in this window |
| `accuracy` | DOUBLE PRECISION | `correct / total` |
| `confusion` | JSONB | `{ tp, fp, tn, fn }` |
| `avg_latency_ms` | DOUBLE PRECISION | mean prediction latency |
| `p95_latency_ms` | DOUBLE PRECISION (nullable) | 95th-percentile latency (requires ≥ 1 sample) |
| `throughput_per_sec` | DOUBLE PRECISION | `total / elapsed_seconds` |
| `is_last` | BOOLEAN | exactly one `true` per `(dataset, model_slug)` at a time |

Indexes: `(dataset, model_slug, started_at)`; `(dataset, model_slug, is_last)`.

## Redis channels and keys

| Channel/Key | Direction/Type | Payload |
|---|---|---|
| `transactions` | channel — streamer → inference | `{ dataset, features, actual }` |
| `control` | channel — inference → streamer | `{ interval_ms?, paused?, dataset?, model? }` |
| `streamer:heartbeat` | STRING key (TTL=6s) | `{ dataset, paused, interval_ms, messages_sent, rate, uptime_s, ts }` |

The streamer writes `streamer:heartbeat` every ~2 seconds. The `/monitoring` endpoint in inference reads
this key; a key absent or with `ts` older than 6 seconds is reported as `down`.

## Model registry — `models/registry.json`

```jsonc
{
  "fraud": {
    "label": "Credit Card Fraud",
    "positive_label": "Fraud",
    "theme": { "accent": "#ef4444" },
    "models": [
      {
        "name": "FraudGuard v1",
        "slug": "fraudguard-v1",
        "algo": "RandomForestClassifier",
        "features": ["v1", "v2", "v3", "v4", "v5", "v6", "amount", "hour"],
        "classes": { "0": "Legit", "1": "Fraud" },
        "metrics": { "accuracy": 0.9342, "precision": 0.975, "recall": 0.3333 },
        "trained_at": "2026-06-23",
        "formats": { "joblib": "fraudguard-v1.joblib", "pickle": "fraudguard-v1.pkl",
                     "onnx": "fraudguard-v1.onnx", "pmml": null },
        "scaler": "scaler.joblib"
      }
    ]
  },
  "iot": {
    "label": "Predictive Maintenance",
    "positive_label": "Failure",
    "models": [{ "name": "RotorMind v1", "slug": "rotormind-v1",
                 "metrics": { "accuracy": 0.9258, "precision": 0.8444, "recall": 0.5033 }, "..." }]
  },
  "intrusion": {
    "label": "Network Intrusion Detection",
    "positive_label": "Attack",
    "models": [{ "name": "NetGuard v1", "slug": "netguard-v1",
                 "metrics": { "accuracy": 0.9442, "precision": 1.0, "recall": 0.8333 }, "..." }]
  }
}
```

`formats[fmt] = null` means that export was not generated (e.g. PMML without Java). The dashboard
disables download for null formats. PMML is null on this runtime — `sklearn2pmml` requires a Java
runtime, which is not installed in the trainer image.
