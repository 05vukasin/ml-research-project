# T02 — Env & config

**Goal:** Define all configuration via a single `.env.example` so every service reads env vars.

**Prerequisites:** T01.

**Steps:**
1. Create `.env.example` with: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`,
   `REDIS_URL`, `MODELS_DIR`, `DATA_DIR`, `START_DATASET=fraud`, `START_INTERVAL_MS=500`,
   `NEXT_PUBLIC_INFERENCE_URL`, and host port mappings.
2. Document each var with a short inline comment.
3. Note in the file that `.env` is created by copying `.env.example`.

**Skills/Agent:** main loop; `mlops-architecture`.

**Acceptance criteria:**
- `.env.example` is complete and self-documenting.
- No service will need a hardcoded host/port/credential.

**Status:** ☑ done — `.env.example` complete (postgres/redis/paths/streamer/inference/trainer/dashboard), self-documented.
