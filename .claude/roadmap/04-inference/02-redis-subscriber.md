# T12 — Redis transactions subscriber

**Goal:** Consume the `transactions` stream and run predictions.

**Prerequisites:** T11.

**Steps:**
1. Background task subscribes to Redis `transactions`.
2. Per message: parse `{dataset, features, actual}`, select model, run `predict`, compute `latency_ms`
   and `is_correct`.
3. Maintain in-memory running aggregates (total, correct, positive_count, throughput, avg_latency)
   per dataset for SSE.
4. Reconnect to Redis on failure; validate/skip malformed messages.

**Skills/Agent:** `inference-engineer`; `security-best-practices` (validate payloads).

**Acceptance criteria:**
- Publishing a test message to `transactions` produces a prediction + updated aggregates.
- Subscriber survives Redis restarts and bad messages.

**Status:** ☑ done — _redis_subscriber() background thread in main.py; validates all payload fields; reconnects with exponential backoff; skips malformed/invalid messages; updates in-memory aggregates per dataset.
