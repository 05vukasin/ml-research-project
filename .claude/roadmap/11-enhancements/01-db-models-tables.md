# T41 — DB: models + model_runs tables

**Goal:** Add a model catalog and per-model benchmark-run storage to Postgres.

**Prerequisites:** T09 (predictions schema pattern).

**Steps:**
1. In `inference/app/db.py`, define two `Table()`s alongside `predictions` (same SQLAlchemy Core pattern):
   - `models`: `id, dataset, slug, name, algo, accuracy, precision, recall, train_fraction,
     trained_at, formats(JSONB), features(JSONB), source(Text 'seeded'|'trained'), created_at, updated_at`.
     Unique `(dataset, slug)`; index `(dataset, slug)`.
   - `model_runs`: `id, dataset, model_slug, started_at, ended_at, total, correct, accuracy,
     confusion(JSONB), avg_latency_ms, p95_latency_ms, throughput_per_sec, is_last(Boolean)`.
     Index `(dataset, model_slug, started_at)`; partial/index to find `is_last=true` per model.
2. `metadata.create_all(checkfirst=True)` already creates them on startup — confirm.

**Skills/Agent:** `inference-engineer`; `postgres`.

**Acceptance criteria:**
- Both tables auto-create on a fresh DB; columns/types/indexes match the data-model doc.
- No change to existing `predictions` behavior.

**Status:** ☑ done — `models` + `model_runs` tables added to `inference/app/db.py` with correct types, UniqueConstraint, and indexes; auto-created via `metadata.create_all(checkfirst=True)` on startup.
