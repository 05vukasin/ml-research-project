# Workflows

End-to-end step sequences for the four main operational paths.

Message shapes are canonical — see also [05-data-model.md](05-data-model.md) for the full
Redis channel and Postgres schema reference.

---

## A. Streaming / serving path

This path runs continuously from startup. No user action required.

**Actors:** streamer, Redis `transactions`, inference, PostgreSQL, dashboard SSE client.

1. Streamer reads the next row of the active dataset's CSV (`data/<slug>/sample.csv`).

2. Streamer builds a transactions message and publishes to Redis `transactions`:
   ```json
   { "dataset": "fraud", "features": { "v1": -1.36, "amount": 149.62 }, "actual": 0 }
   ```

3. Inference (subscribed to `transactions`) receives the message on its background thread.
   It validates `dataset`, `features`, and `actual`, then selects the active model slug for
   the dataset.

4. Inference scales the feature dict (`scaler.transform()`), calls `model.predict()` and
   `model.predict_proba()`.

5. Inference computes:
   - `latency_ms = (processed_at - received_at) * 1000`
   - `is_correct = prediction == actual`

6. Inference updates in-memory aggregate counters (total, correct, positive count, latency
   ring buffer) and the active benchmark accumulator.

7. Inference submits a parameterized `INSERT` into `predictions` to the thread-pool executor
   (off the asyncio event loop, so SSE throughput is unaffected).

8. Inference pushes an SSE event onto every active SSE queue:
   ```json
   {
     "id": 1234, "dataset": "fraud", "prediction": 0, "actual": 0,
     "is_correct": true, "probability": 0.031, "latency_ms": 3.8,
     "ts": "2026-06-24T10:00:00.123456+00:00",
     "running_accuracy": 0.942, "total_processed": 1234,
     "positive_count": 71, "throughput": 1.98, "avg_latency": 4.1
   }
   ```

9. Dashboard's `GET /stream` SSE connection receives the event and updates the gauge,
   live feed, and pipeline animation.

10. Streamer sleeps `interval_ms` milliseconds and moves to the next row. When the CSV is
    exhausted, it wraps back to row 0 and continues.

**REST reads (parallel, polled by the dashboard):**

- `GET /metrics?dataset=fraud` — accuracy over time, confusion matrix, latency, throughput (reads `predictions` table).
- `GET /history?dataset=fraud&limit=50` — most recent 50 prediction rows.
- `GET /progress?dataset=fraud` — rows processed / total rows for the dataset progress widget.

---

## B. Live control path

Triggered by operator action in the settings popup or live feed controls.

**Actors:** browser, inference `POST /control`, Redis `control`, streamer.

1. Operator changes one or more settings: stream speed, pause state, dataset, or model.

2. Dashboard sends:
   ```
   POST http://localhost:8000/control
   Content-Type: application/json

   { "interval_ms": 200, "paused": false, "dataset": "iot", "model": "rotormind-v1" }
   ```
   Fields are optional — send only the fields that changed.

3. Inference validates the request (model must exist in the registry for the given dataset).

4. If the active `(dataset, model)` pair is changing, inference finalizes the current
   benchmark accumulator: writes a `model_runs` row with `is_last=true` for the outgoing
   model, clears `is_last` on the prior run.

5. Inference updates in-memory `active_dataset` and `active_model`.

6. Inference publishes the control command to Redis `control`:
   ```json
   { "interval_ms": 200, "paused": false, "dataset": "iot", "model": "rotormind-v1" }
   ```

7. Streamer's control subscriber thread receives the message:
   - Updates `interval_ms` and/or `paused` immediately.
   - On `dataset` change: sets `switch_requested = true` in shared state.

8. Main publish loop in streamer detects `switch_requested`, loads the new dataset CSV
   (`data/iot/sample.csv`), resets row index to 0, and continues streaming.

**Speed / pause only (no dataset switch):** steps 4 and 8 are skipped.

---

## C. Training workflow (Training Lab)

Triggered explicitly by the operator. Does not affect the serving path.

**Actors:** browser, trainer `POST /train`, trainer `GET /train/stream`, inference `POST /reload`.

1. Operator fills in the Training Lab form: dataset, algorithm, model name, train fraction (default 0.7), and clicks Train.

2. Dashboard sends:
   ```
   POST http://localhost:8001/train
   Content-Type: application/json

   { "dataset": "fraud", "algo": "random_forest", "name": "My Model", "train_fraction": 0.8 }
   ```
   Trainer validates the request and starts a background job in its thread pool. Returns:
   ```json
   { "job_id": "a3f8c2d1-..." }
   ```

3. Dashboard immediately opens:
   ```
   GET http://localhost:8001/train/stream?job_id=a3f8c2d1-...
   ```
   (SSE connection)

4. Trainer loads `data/<dataset>/sample.csv`, splits with `test_size = 1 - train_fraction`.
   For Random Forest it uses `RandomForestClassifier(warm_start=True)`, growing `n_estimators`
   in batches. For SGD it uses `SGDClassifier.partial_fit` over mini-batches.

5. After each batch, trainer emits an SSE progress event:
   ```json
   { "step": 3, "total": 10, "accuracy": 0.871, "status": "running" }
   ```
   The dashboard renders an animated segmented progress bar with a live accuracy readout.

6. On completion, trainer:
   - Exports joblib, pickle, ONNX (PMML is skipped on this runtime — `sklearn2pmml` incompatibility).
   - Writes `models/<dataset>/<slug>.metadata.json` (slug-prefixed, not the shared `metadata.json`).
   - Upserts `registry.json`.
   - Writes a `models` row to Postgres with `source='trained'` and `train_fraction`.
   - Calls `POST http://inference:8000/reload`.

7. Trainer emits the final SSE event:
   ```json
   {
     "status": "done", "slug": "my-model-abc123", "dataset": "fraud",
     "accuracy": 0.912, "train_fraction": 0.8, "formats": ["joblib", "pickle", "onnx"]
   }
   ```

8. Inference `/reload` re-reads `registry.json`, `joblib.load`s the new model and scaler,
   and re-syncs the `models` table (upsert + prune).

9. The new model appears in the settings popup and model cards. It is immediately usable in
   the live stream and downloadable in all available formats.

![Training Lab](img/training-lab.png)

---

## D. Monitoring loop

Runs continuously in the background once the Monitoring tab is open.

**Actors:** dashboard, inference `GET /monitoring`, trainer `GET /stats`.

1. Dashboard polls `GET /monitoring` every ~2 seconds. Inference collects four sections
   synchronously in a thread-pool executor:

   **postgres:** database size in MB, total prediction count, per-dataset count, active connections.

   **redis:** version, memory usage, connected clients, ops/sec, pubsub subscriber counts for
   `transactions` and `control`.

   **streamer:** reads `streamer:heartbeat` STRING key from Redis. Checks whether the key
   exists and whether the `ts` field is within the last 6 seconds. Returns `status: "ok"`,
   `"down"`, or `"unknown"` accordingly, plus all heartbeat fields (dataset, paused,
   interval_ms, messages_sent, rate, uptime_s).

   **inference:** models loaded count, active dataset, active model, throughput, avg latency,
   SSE subscriber count, uptime in seconds.

2. Dashboard polls `GET /stats` on the trainer service every ~2 seconds. Returns:
   ```json
   {
     "active_jobs": 0,
     "last_trained": { "slug": "my-model", "dataset": "fraud", "accuracy": 0.91, "train_fraction": 0.8, "ts": "..." },
     "uptime_s": 3600.0
   }
   ```

3. Dashboard renders four service cards and the Redis panel. Status dots update in real time.
   Stopping the streamer container causes its card to flip to `down` within 6 seconds.

See [06-api-reference.md](06-api-reference.md) for the full `/monitoring` and `/stats` response shapes.
See [services/redis.md](services/redis.md) for the `streamer:heartbeat` key format.
