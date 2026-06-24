# T13 — Persist predictions to Postgres

**Goal:** Write every prediction to the `predictions` table without blocking the hot path.

**Prerequisites:** T10, T12.

**Steps:**
1. On each prediction, INSERT a row (all columns per data-model doc) via `db.py`.
2. Do DB writes off the event loop (threadpool/async) so streaming stays smooth.
3. Use parameterized statements; handle transient DB errors with retry.

**Skills/Agent:** `inference-engineer`; `postgres`; `security-best-practices`.

**Acceptance criteria:**
- Row count in `predictions` grows as messages flow.
- Stored values (latency, is_correct, probability) are correct for sampled rows.
- No SQL injection surface; writes don't stall the subscriber.

**Status:** ☑ done — _db_insert() runs in ThreadPoolExecutor; parameterized INSERT via SQLAlchemy Core predictions.insert(); verified 2 rows written to DB during e2e test with correct latency/is_correct/probability.
