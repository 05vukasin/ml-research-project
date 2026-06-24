# T45 — Streamer heartbeat

**Goal:** Publish streamer liveness/stats for the Monitoring page.

**Prerequisites:** T17.

**Steps:**
1. In `streamer/streamer.py`, every ~2s `HSET streamer:heartbeat` (or SET a JSON key with short TTL) with
   `{dataset, paused, interval_ms, messages_sent, rate, uptime_s, ts}`.
2. Track `messages_sent`, `uptime_start`, rolling `rate` in the existing state/loop.
3. Keep it cheap; don't disrupt publishing cadence.

**Skills/Agent:** `streamer-engineer`.

**Acceptance criteria:**
- `redis-cli HGETALL streamer:heartbeat` (or GET) shows fresh values updating ~every 2s.
- Values reflect current dataset/paused/interval and a sane rate.

**Status:** ☑ done
