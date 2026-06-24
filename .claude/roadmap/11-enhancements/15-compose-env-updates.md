# T55 — Compose + env updates (v2)

**Goal:** Wire the new env/config so the full v2 stack runs with one command.

**Prerequisites:** T44 (trainer DB), T46.

**Steps:**
1. Add `DATABASE_URL` to the trainer service in `docker-compose.yml` and `.env.example`.
2. Ensure trainer `depends_on` postgres healthy (in addition to inference).
3. Rebuild; confirm all 6 services still come up cleanly and the trainer reaches Postgres.

**Skills/Agent:** `devops-engineer`.

**Acceptance criteria:**
- `docker compose up --build` brings the whole v2 stack up; trainer connects to Postgres (logs/`/stats`).

**Status:** ☑ done
