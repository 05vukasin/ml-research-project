# T32 — One-command run

**Goal:** `docker compose up --build` brings up the whole working system, no manual steps.

**Prerequisites:** T31.

**Steps:**
1. From a clean checkout (`.env` copied from `.env.example`), run `docker compose up --build`.
2. Confirm dashboard at :3000 shows live data end to end.
3. Fix any ordering/build/runtime issues until it's truly one command.

**Skills/Agent:** `devops-engineer`; `verify`.

**Acceptance criteria:**
- Single command yields a fully working system with the dashboard animating live.
- Works on a clean machine with only Docker installed (committed samples + models).

**Status:** ☑ done — `docker compose up --build` (after `cp .env.example .env`) brings all 6 services up cleanly in correct dependency order. Evidence: HTTP 200 from dashboard, inference health ok, trainer health ok, predictions table growing, NEXT_PUBLIC URLs (localhost:8000, localhost:8001) confirmed baked into the JS bundle.
