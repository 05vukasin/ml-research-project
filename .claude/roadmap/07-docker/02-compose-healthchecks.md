# T31 — docker-compose + healthchecks

**Goal:** Wire all five services together with correct ordering.

**Prerequisites:** T30.

**Steps:**
1. `docker-compose.yml` with `postgres`, `redis`, `streamer`, `inference`, `dashboard`.
2. Healthchecks: `pg_isready`, `redis-cli ping`, inference `/health`.
3. `depends_on` with `condition: service_healthy`: inference ← postgres+redis; dashboard ← inference;
   streamer ← redis. Mount `./models` (ro) into inference, `./data` into streamer. All env from `.env`.

**Skills/Agent:** `devops-engineer`.

**Acceptance criteria:**
- `docker compose config` is valid; services start in correct dependency order.
- No service starts before its dependencies are healthy.

**Status:** ☑ done — all 6 services (postgres, redis, inference, streamer, trainer, dashboard) wired with healthchecks and correct depends_on ordering.
