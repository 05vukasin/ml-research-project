# T10 — DB init & connection

**Goal:** Ensure the table exists on startup and the service connects reliably.

**Prerequisites:** T09.

**Steps:**
1. Provide either a Postgres `initdb` SQL script mounted into the container, or an idempotent
   `create_all`/`CREATE TABLE IF NOT EXISTS` on inference startup.
2. Implement `inference/app/db.py`: engine/session from `DATABASE_URL`, with connection retry/backoff
   (Postgres may still be starting).

**Skills/Agent:** `inference-engineer`; `postgres`.

**Acceptance criteria:**
- Fresh DB gets the `predictions` table automatically.
- Inference waits/retries until Postgres is reachable instead of crashing.

**Status:** ☑ done — inference/app/db.py init_db() retries with exponential backoff (up to 10 attempts), then calls metadata.create_all(checkfirst=True). Verified: table auto-created on fresh DB.
