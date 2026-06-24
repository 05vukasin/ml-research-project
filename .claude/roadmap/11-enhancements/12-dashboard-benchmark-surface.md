# T52 — Dashboard benchmark surface (current/last run)

**Goal:** Show the active model's live "current run" and its saved "last run" on the dashboard.

**Prerequisites:** T43, T49.

**Steps:**
1. A compact panel on the Dashboard tab for the active model: current-run accuracy/throughput/latency
   (from SSE aggregates / `current-run`) and the previous `last-run` for comparison.
2. Selecting a model (settings popup or a model card) switches it; the run is recorded server-side (T43);
   reflect "recording…" state.
3. Keep it secondary to the hero gauge.

**Skills/Agent:** `dashboard-designer`; `realtime-ui`, `design-taste`.

**Acceptance criteria:**
- The panel shows live current-run stats and the model's last-run; updates on model switch.
- No clutter; gauge stays the focal point.

**Status:** ☑ done — BenchmarkSurface.tsx: current-run polled every 2s; last-run fetched on model change; pulsing "recording…" indicator (Motion, respects prefers-reduced-motion); accuracy delta vs last run; resets on model switch; subordinate to hero gauge. Mounted in Dashboard tab below MetricsCharts.
