# T09 — Postgres schema

**Goal:** Define the `predictions` table and indexes.

**Prerequisites:** T02.

**Steps:**
1. Write SQL/SQLAlchemy model for `predictions` exactly per `architecture/03-data-model.md`.
2. Add indexes: `(dataset, received_at)` and `(dataset, is_correct)`.

**Skills/Agent:** `inference-engineer`; `postgres` skill.

**Acceptance criteria:**
- Schema matches the data-model doc (all columns + types).
- Indexes created for time-series and accuracy queries.

**Status:** ☑ done — predictions table + composite indexes (dataset,received_at) and (dataset,is_correct) defined in inference/app/db.py via SQLAlchemy Core; idempotent create_all on startup.
