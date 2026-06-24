---
name: realtime-ui
description: Patterns for the live real-time layer of the dashboard — SSE client lifecycle, batching/throttling high-frequency updates, Motion AnimatePresence live feed, spring-animated accuracy gauge, and React Flow pipeline animation. Use when wiring the dashboard to the inference SSE/REST endpoints or building any live-updating component.
---

# Real-Time UI Patterns

How the dashboard consumes live data and animates it smoothly without melting the main thread.

## SSE client (live events)

- Use a single `EventSource` to `${INFERENCE_URL}/stream`, created in a `"use client"` hook
  (`useLiveStream`) inside `useEffect`; **always** close it on cleanup.
- Reconnect with backoff on `error`. Surface a connection status pill (connected / reconnecting).
- Parse each `data:` line as JSON (shape in `architecture/01-data-flow.md`).
- Keep two pieces of state: the **latest aggregates** (gauge/KPIs) and a **bounded recent-events list**
  (e.g. last 30) for the feed. Never grow the list unbounded.

## Throttling / batching (critical for 60fps)

- The stream can emit many events/sec. Do **not** `setState` per event.
- Buffer incoming events in a ref; flush to state on `requestAnimationFrame` or a ~100ms interval.
- Aggregates (running_accuracy, totals) come pre-computed from the server — just take the latest.
- Animate only `transform`/`opacity`. See `web-perf`.

## Accuracy gauge (hero, spring)

- Radial gauge: Recharts `RadialBarChart` or a custom SVG arc.
- Animate the displayed value with a Motion spring (`useSpring`, `stiffness ~120, damping ~20`); never
  snap to the new value.
- Count-up the percentage label with the same spring; render with `tabular-nums`.
- Color the fill with the active dataset accent; a subtle track behind it.
- Respect `prefers-reduced-motion` → set value instantly.

## Live feed (AnimatePresence)

- `motion.ul` + `AnimatePresence`; each row keyed by event `id`.
- Enter: fade + slide from top (y: -8 → 0, 250–300ms, ease-out); subtle stagger.
- Positive class rows: accent left-border + a one-shot pulse (don't loop pulses — distracting).
- Cap rendered rows; let exiting rows fade out as new ones push in.

## Pipeline flow (React Flow)

- Static nodes: `Stream → Model → DB`. Use `@xyflow/react`.
- Animated edges (`animated: true`) to imply continuous flow; bump edge intensity with throughput.
- Optional: a small in-flight counter/badge on the Model node reflecting recent events.
- Keep it schematic and calm — it's an ambient indicator, not the focal point.

## REST (history / metrics / progress)

- Fetch `GET /metrics`, `/history`, `/progress` on an interval (e.g. 2–5s) or on dataset change.
- These read Postgres → use for the time-series charts and the dataset-progress widget.
- Prefer Server Components for initial load where possible; client polling for refresh.

## Dataset/model switch

- On change in the settings popup → `POST /control {dataset, model}` then reset the local feed/gauge
  state so the UI reflects the new active dataset cleanly. Pull fresh labels/colors from `/registry`.
