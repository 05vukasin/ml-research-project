# T17 — Stream publisher

**Goal:** Replay the active dataset CSV to Redis `transactions`.

**Prerequisites:** T03.

**Steps:**
1. Implement `streamer/streamer.py`: load `DATA_DIR/<START_DATASET>/sample.csv`, iterate rows,
   publish `{dataset, features, actual}` to `transactions`, sleep `START_INTERVAL_MS`, loop at end.
2. Split each row into the model's feature columns + the `actual` label column.
3. Reconnect to Redis on failure; log throughput.

**Skills/Agent:** `streamer-engineer`; `mlops-architecture`.

**Acceptance criteria:**
- `redis-cli subscribe transactions` shows well-formed JSON messages at the configured rate.
- `actual` label is included and separated from features.

**Status:** ☑ done — streamer.py publishes well-formed {dataset,features,actual} JSON to `transactions` at the configured rate; verified at ~3.3 msg/s with fraud CSV.
