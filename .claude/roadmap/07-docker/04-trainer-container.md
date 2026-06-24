# T40 — Trainer container in compose

**Goal:** Add the `trainer` service to Docker so the Training Lab works via one command.

**Prerequisites:** T37, T38, T31.

**Steps:**
1. `trainer/Dockerfile` (python-slim + training/serving deps).
2. Add `trainer` to `docker-compose.yml`: port `8001`, mount `./models` (read-write) and `./data`,
   env `INFERENCE_URL`, `depends_on` inference healthy, healthcheck `/health`.
3. Wire dashboard env to reach the trainer (`NEXT_PUBLIC_TRAINER_URL` or rewrite).

**Skills/Agent:** `devops-engineer`.

**Acceptance criteria:**
- `docker compose up --build` brings up the trainer; Training Lab end-to-end works through the stack.
- Trainer can write models and reach inference `/reload`.

**Status:** ☑ done — trainer Dockerfile + compose service were already present; dashboard Dockerfile (multi-stage, standalone output, NEXT_PUBLIC_* baked as build ARGs) and dashboard compose service (depends_on inference+trainer healthy, healthcheck, port ${DASHBOARD_PORT}) added in this task.
