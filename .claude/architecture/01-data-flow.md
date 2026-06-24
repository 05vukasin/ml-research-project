# 01 — Data Flow

End-to-end path of a single event, and the live control path.

## Forward path (one event)

1. **Streamer** reads the next row of the active dataset's CSV.
2. It builds a JSON message: `{ dataset, features {...}, actual }` and `PUBLISH`es it to the Redis
   `transactions` channel, then sleeps `interval_ms`.
3. **Inference** is subscribed to `transactions`. On message:
   - Picks the in-memory model for `dataset`.
   - Applies the dataset's `scaler`, calls `model.predict()` + `predict_proba()`.
   - Computes `latency_ms` (receive → result), `is_correct = (prediction == actual)`.
   - `INSERT`s a row into Postgres `predictions`.
   - Pushes a compact event onto an in-process SSE queue with running aggregates.
4. **Dashboard** consumes:
   - `GET /stream` (SSE) for live feed + gauge + flow animation (low latency).
   - `GET /metrics`, `GET /history`, `GET /progress` (REST, read from Postgres) for charts/widgets.

## Control path (live, from UI)

1. Operator changes speed / pause / dataset / model in the dashboard.
2. Dashboard `POST /control` to inference with the changed fields.
3. Inference:
   - Applies `dataset`/`model` locally (switches active model — already loaded in memory).
   - `PUBLISH`es the command to the Redis `control` channel.
4. Streamer is subscribed to `control`:
   - Updates `interval_ms` / `paused` immediately.
   - On `dataset` change, loads the other CSV and starts streaming it.

## Why two transports

- **SSE** = server→client push, perfect for smooth animation; no polling lag.
- **REST over Postgres** = satisfies the requirement that the dashboard reads metrics from the DB,
  and gives historical aggregates SSE alone can't.

## Message shapes (canonical)

```jsonc
// transactions channel
{ "dataset": "fraud", "features": { "V1": 0.1, "Amount": 12.5, ... }, "actual": 0 }

// control channel
{ "interval_ms": 500, "paused": false, "dataset": "iot", "model": "rotormind-v1" }

// SSE event (GET /stream)
{ "id": 1234, "dataset": "fraud", "prediction": 1, "actual": 1, "is_correct": true,
  "probability": 0.93, "latency_ms": 4.2, "ts": "...",
  "running_accuracy": 0.971, "total_processed": 1234, "positive_count": 17,
  "throughput": 2.0, "avg_latency": 3.8 }
```
