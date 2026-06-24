# T25 — Charts + KPI cards

**Goal:** Time-series charts and KPI summary cards from DB-backed metrics.

**Prerequisites:** T22, T14.

**Steps:**
1. Recharts line/area charts: throughput (req/s), latency (ms), accuracy over time — polling `/metrics`.
2. KPI cards: total processed, positives caught, avg latency, positive rate — from SSE aggregates.
3. Confusion counters (TP/FP/TN/FN) from `/metrics`.

**Skills/Agent:** `dashboard-designer`; `design-taste`.

**Acceptance criteria:**
- Charts update on the polling interval and on dataset switch.
- KPI numbers match the stream; all numbers `tabular-nums`.

**Status:** ☑ done — MetricsCharts.tsx: accuracy-over-time from /metrics polling (3s), throughput/latency charts from SSE rolling buffer; KpiCards.tsx: 4 KPI cards from SSE aggregates; confusion TP/FP/TN/FN from /metrics. All tabular-nums.
