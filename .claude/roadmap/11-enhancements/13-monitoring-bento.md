# T53 — Monitoring tab (bento + interactive Redis queue)

**Goal:** A monitoring view: every service as a card in a bento, Redis as a full-width interactive box.

**Prerequisites:** T46, T47, T49.

**Steps:**
1. New `components/dashboard/Monitoring.tsx` rendered in the Monitoring tab. Poll `fetchMonitoring()`
   (~1–2s) + trainer `fetchStats()`.
2. **Bento grid**: service cards **half-width** (postgres, inference, trainer, streamer; optional
   dashboard self) — each shows status dot + key live stats (up/down, latency, counts, memory, etc.).
3. **Full-width interactive Redis queue**: animate messages flowing Streamer→Redis→Inference (Motion),
   a live throughput sparkline, pubsub subscriber counts, memory/clients/ops. It spans the full width.
4. Down/stale services show a clear degraded state.

**Skills/Agent:** `dashboard-designer`; `design-taste`, `realtime-ui`.

**Acceptance criteria:**
- Bento renders half-width service cards + a full-width animated Redis box with live data.
- Stopping a service flips its card to down/stale within seconds; build passes.

**Status:** ☑ done — Monitoring.tsx: bento with half-width service cards (postgres/inference/trainer/streamer, status dots + live stats) + full-width interactive Redis panel (animated packets Streamer→Redis→Inference, throughput sparkline, pubsub/memory/clients/ops); polls /monitoring + /stats ~2s; degraded/stale states. Fixed sparkline history + packet-accumulation bugs. Build green.
