# Streamer

## Purpose

Replays a dataset CSV row-by-row to the Redis `transactions` channel at a controllable rate.
The streamer is a long-running Python worker with no HTTP port; it communicates only through Redis.

## Responsibilities

- Read the active dataset CSV from `DATA_DIR/<slug>/sample.csv`.
- Serialize each row as a JSON message and `PUBLISH` it to `transactions`.
- Sleep `interval_ms` between publishes.
- Subscribe to the `control` channel and apply speed/pause/dataset changes immediately.
- Write a liveness heartbeat to the `streamer:heartbeat` Redis key every ~2 seconds.

## Inputs / Outputs

| Direction | Channel / Source | Content |
|---|---|---|
| IN | `control` (Redis pub/sub) | `{ interval_ms?, paused?, dataset? }` |
| IN | `DATA_DIR/<slug>/sample.csv` | CSV file with feature columns + label column |
| IN | `models/registry.json` | Feature list for each dataset (used to identify the label column) |
| OUT | `transactions` (Redis pub/sub) | `{ dataset, features, actual }` per row |
| OUT | `streamer:heartbeat` (Redis STRING, TTL=6 s) | Live stats: dataset, paused, interval\_ms, messages\_sent, rate, uptime\_s, ts |

### `transactions` message shape

```json
{
  "dataset": "fraud",
  "features": { "v1": -1.36, "v2": 0.13, "amount": 149.62, "hour": 14 },
  "actual": 0
}
```

- `features` keys match the `features` array in `registry.json` for the active dataset.
- `actual` is the integer ground-truth label (0 or 1) taken from the CSV label column.
- The label column is identified by excluding all feature column names from the CSV headers. If
  `registry.json` is unavailable, the streamer assumes the last column is the label.

## Configuration (env vars)

| Variable | Default | Notes |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `DATA_DIR` | `/data` | Root directory; datasets live at `<DATA_DIR>/<slug>/sample.csv` |
| `START_DATASET` | `fraud` | Initial dataset slug on startup |
| `START_INTERVAL_MS` | `500` | Initial publish interval in milliseconds |

All env vars are read once at startup. `interval_ms` and `dataset` change at runtime via the
`control` channel.

## Port

None. The streamer is a pure worker process.

## Key files

- `streamer/streamer.py` — entire service; three threads:
  - `publish_loop()` — main thread; reads CSV, publishes, sleeps
  - `control_subscriber()` — daemon thread; listens on `control`
  - `heartbeat_writer()` — daemon thread; writes `streamer:heartbeat` every 2 s

## How it fits the pipeline

The streamer is the source of all data. Inference is passive until the streamer publishes. The
CSV loops at end-of-file, so the stream runs indefinitely. A dataset switch (from the dashboard)
takes effect on the next loop iteration without restarting the process.

```
sample.csv → publish_loop → PUBLISH transactions → inference
control_subscriber ← SUBSCRIBE control ← inference (relays dashboard commands)
heartbeat_writer → SET streamer:heartbeat (TTL=6s) → /monitoring reads this
```

## Gotchas / operational notes

- **End-of-file looping** — when the streamer exhausts the CSV, it wraps to row 0. The same rows
  repeat. This is intentional for a continuous demo; do not expect unique events over time.
- **Dataset switch atomicity** — `switch_requested` is a flag in shared state guarded by a
  `threading.Lock`. The publish loop checks it before each row and reloads the CSV only at the
  loop boundary, so the current row finishes before the switch happens.
- **Invalid dataset guard** — the control subscriber validates the incoming `dataset` against
  `KNOWN_SLUGS = {"fraud", "iot", "intrusion"}` and logs a warning for unknown values without
  crashing.
- **Redis reconnect** — `connect_redis()` retries with exponential backoff (1 s → 30 s). All three
  threads use independent Redis connections so a publish failure does not stall the heartbeat.
- **Full dataset swap** — by default, only `data/<slug>/sample.csv` is loaded (a representative
  sample). To stream the full dataset, replace the sample CSV with the full file. See the root
  README for dataset sources.
- The `models` volume is mounted read-only in the streamer container so it can read `registry.json`,
  but the streamer never reads model artifacts.
