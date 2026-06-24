# T46 — Inference /monitoring aggregator

**Goal:** One endpoint that reports the health/stats of every backend service for the Monitoring tab.

**Prerequisites:** T45 (heartbeat), T41.

**Steps:**
1. `GET /monitoring` in `inference/app/main.py` returns:
   - `postgres`: up?, db size MB, predictions total + by dataset, connection count.
   - `redis`: up?, version, used_memory MB, connected_clients, instantaneous_ops_per_sec,
     pubsub numsub for `transactions` + `control`.
   - `streamer`: read `streamer:heartbeat`; mark `stale/down` if `ts` older than ~6s.
   - `inference`: models_loaded, active dataset/model, throughput, avg latency, SSE subscriber count, uptime.
2. Parameterized SQL; tolerate a service being down (report `status:"down"` rather than 500).

**Skills/Agent:** `inference-engineer`; `postgres`.

**Acceptance criteria:**
- `curl /monitoring` returns all four sections with live values.
- Stopping the streamer flips its section to stale/down within a few seconds.

**Status:** ☑ done — GET `/monitoring` added to `main.py`; all four sections (postgres, redis, streamer, inference) tolerant of service failures; streamer reports `unknown` (heartbeat absent, pending T45); postgres and redis sections live-verified.
