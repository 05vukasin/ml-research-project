# T30 — Dockerfiles per service

**Goal:** Containerize each service.

**Prerequisites:** services exist (T16, T19, T29).

**Steps:**
1. `streamer/Dockerfile` (python-slim + pandas/redis).
2. `inference/Dockerfile` (python-slim + requirements; runs uvicorn).
3. `dashboard/Dockerfile` (multi-stage node build → slim runtime; `npm start`).
4. Postgres/Redis use official images (configured in compose, no custom Dockerfile).

**Skills/Agent:** `devops-engineer`.

**Acceptance criteria:**
- Each image builds standalone.
- Images are slim (no dev cruft); only needed deps installed.

**Status:** ☑ done — all Dockerfiles complete including dashboard (multi-stage Node 20 slim + standalone output, 339MB final image).
