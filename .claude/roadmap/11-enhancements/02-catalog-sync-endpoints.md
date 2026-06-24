# T42 — Model catalog sync + endpoints

**Goal:** Mirror the registry into the `models` table and expose catalog/run reads.

**Prerequisites:** T41.

**Steps:**
1. On inference startup and in `model.py reload()`, upsert every registry model into `models`
   (`source='seeded'` for the 3 committed; `'trained'` when added by the trainer). Idempotent.
2. New endpoints in `main.py`:
   - `GET /models[?dataset=]` → catalog rows joined with each model's `last-run` summary if present.
   - `GET /models/{dataset}/{slug}` → full detail (metadata + formats + metrics).
   - `GET /models/{dataset}/{slug}/runs` → list of `model_runs` (most recent first).
   - `GET /models/{dataset}/{slug}/last-run` → the `is_last=true` run (or null).
   All parameterized SQL; sanitize slug/dataset.

**Skills/Agent:** `inference-engineer`; `postgres`; `security-best-practices`.

**Acceptance criteria:**
- After startup, `SELECT * FROM models` lists the 3 seeded models.
- The new endpoints return correct JSON; unknown model → 404/empty.

**Status:** ☑ done — `inference/app/catalog.py` added with idempotent `sync_registry_to_db()` (called at startup + after `/reload`); GET `/models`, `/models/{ds}/{slug}`, `/models/{ds}/{slug}/runs`, `/models/{ds}/{slug}/last-run` all working; export route not shadowed (fixed-suffix registered first).
