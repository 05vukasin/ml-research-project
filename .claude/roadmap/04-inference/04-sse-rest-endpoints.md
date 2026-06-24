# T14 — SSE + REST read endpoints

**Goal:** Expose live + historical data to the dashboard.

**Prerequisites:** T13.

**Steps:**
1. `GET /stream` (sse-starlette): emit each processed event + running aggregates (shape in
   `architecture/01-data-flow.md`).
2. `GET /metrics?dataset=`: DB-backed aggregates (accuracy over time, throughput/s, confusion
   TP/FP/TN/FN, latency avg/p95).
3. `GET /history?dataset=&limit=`: recent rows.
4. `GET /registry`: serve the registry for the settings popup.
5. `GET /progress?dataset=`: `{rows_processed, total_rows, percent}`.
6. `GET /health`.

**Skills/Agent:** `inference-engineer`; `postgres` (metrics queries).

**Acceptance criteria:**
- `curl -N /stream` shows live events; `/metrics`, `/history`, `/registry`, `/progress`, `/health`
  return correct JSON.
- Metrics read from Postgres (not just in-memory).

**Status:** ☑ done — /stream (SSE via sse-starlette), /metrics (DB-backed confusion/latency/throughput), /history, /registry, /progress, /health all verified returning correct JSON with 200 status.
