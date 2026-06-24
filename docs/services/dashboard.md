# Dashboard

![Main dashboard](../img/dashboard.png)
![Training Lab](../img/training-lab.png)
![Model settings popup](../img/model-settings.png)
![Monitoring tab](../img/monitoring.png)

## Purpose

Animated real-time UI built with Next.js (App Router). Renders live model performance as it happens,
lets operators switch datasets and models, trigger training jobs, and download serialized model
artifacts.

## Responsibilities

- Maintain a persistent SSE connection to inference `GET /stream`; buffer events in a ref and flush
  to React state on `requestAnimationFrame` (~60 fps, never per-event).
- Animate the hero accuracy gauge and pipeline flow diagram in sync with the stream.
- Display a scrollable live feed of recent predictions.
- Fetch DB-backed metrics, history, and progress via REST on demand.
- Let operators change speed, pause, swap dataset/model, and download exports via `SettingsPopup`.
- Provide a Training Lab tab for user-triggered model training with a live accuracy curve.
- Show a Monitoring tab with a bento-style grid of service health and Redis pub/sub stats.
- Render full-width model cards (newest first) with expandable benchmark details, formats, and a
  live loading card while a training job is in progress.

## Inputs / Outputs

| Direction | Endpoint | Content |
|---|---|---|
| IN | `GET inference:8000/stream` (SSE) | Live prediction events + running aggregates |
| IN | `GET inference:8000/metrics` | DB accuracy, confusion, latency, throughput |
| IN | `GET inference:8000/history` | Recent prediction rows |
| IN | `GET inference:8000/progress` | Dataset row-processing progress |
| IN | `GET inference:8000/registry` | Full model registry + active selection |
| IN | `GET inference:8000/models[?dataset=]` | Model catalog with last-run summaries |
| IN | `GET inference:8000/models/{ds}/{slug}/*` | Model detail, runs, current-run |
| IN | `GET inference:8000/monitoring` | Aggregated service health snapshot |
| IN | `GET trainer:8001/algos` | Available algorithms for Training Lab |
| IN | `GET trainer:8001/train/stream?job_id=` | SSE training progress |
| OUT | `POST inference:8000/control` | Speed / pause / dataset / model change |
| OUT | `POST trainer:8001/train` | Start a training job |
| OUT (download) | `GET inference:8000/models/{ds}/{slug}/export?format=` | Model file download |

## Configuration (env vars)

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_INFERENCE_URL` | Browser-reachable URL for the inference service. Baked into the JS bundle at `docker build` time via `ARG`; cannot be changed at container runtime. Default in `.env.example`: `http://localhost:8000`. |
| `NEXT_PUBLIC_TRAINER_URL` | Browser-reachable URL for the trainer service. Same bake-at-build constraint. Default: `http://localhost:8001`. |

Both variables must point to host-reachable ports, not internal Docker network names, because the
browser makes the SSE and REST calls directly from the user's machine.

## Port

`3000` (mapped from host `DASHBOARD_PORT`).

## Key files

| File | Role |
|---|---|
| `dashboard/app/page.tsx` | Server Component root; SSR-fetches `/registry` and `/health` for initial hydration |
| `dashboard/app/layout.tsx` | HTML shell, global CSS |
| `dashboard/hooks/useLiveStream.ts` | SSE client: single `EventSource`, rAF batching, exponential-backoff reconnect |
| `dashboard/lib/api.ts` | All fetch calls to inference and trainer endpoints |
| `dashboard/lib/types.ts` | TypeScript interfaces matching the inference + trainer API contracts |
| `dashboard/components/dashboard/DashboardClient.tsx` | Top-level client shell; owns tabs, health poll, SSE distribution |
| `dashboard/components/dashboard/TopNav.tsx` | Tab bar (Dashboard / Training Lab / Monitoring) + settings popup trigger + connection pill |
| `dashboard/components/dashboard/AccuracyGauge.tsx` | Hero accuracy gauge; spring-animated on each SSE flush |
| `dashboard/components/dashboard/PipelineFlow.tsx` | React Flow animated pipeline diagram; pulses with live throughput |
| `dashboard/components/dashboard/LiveFeed.tsx` | Fixed-height (420 px) scrollable prediction feed; click row to open detail dialog |
| `dashboard/components/dashboard/ProgressWidget.tsx` | Dataset row-processing progress bar |
| `dashboard/components/dashboard/KpiCards.tsx` | Four KPI cards: accuracy, throughput, latency, positive-rate |
| `dashboard/components/dashboard/MetricsCharts.tsx` | Recharts line/bar charts: accuracy over time, confusion matrix, latency distribution |
| `dashboard/components/dashboard/BenchmarkSurface.tsx` | Current-run live stats + last finalized run for the active model |
| `dashboard/components/dashboard/TrainingLab.tsx` | Training form (dataset, algo, name, train_fraction slider); live SSE accuracy curve; ETA |
| `dashboard/components/dashboard/ModelCards.tsx` | Full-width model catalog cards (newest first); expandable per-card details; live loading card for in-flight jobs |
| `dashboard/components/dashboard/Monitoring.tsx` | Bento grid: Postgres stats, Redis pub/sub subscriber counts, streamer liveness, inference uptime |
| `dashboard/components/dashboard/SettingsPopup.tsx` | Modal: dataset/model switch, speed slider, pause toggle, export buttons per format |
| `dashboard/Dockerfile` | Three-stage build (deps → builder → runner); `NEXT_PUBLIC_*` vars baked via `ARG` in builder stage; runs as non-root `nextjs` user; uses Next.js standalone output |

## Stack

- **Next.js 16** (App Router, standalone output mode)
- **React 19**
- **Tailwind CSS v4** + **shadcn/ui** (via `@base-ui/react`)
- **framer-motion** (Motion) — `AnimatePresence` tab transitions, spring-animated gauge
- **Recharts v3** — accuracy/latency/confusion charts
- **@xyflow/react** — animated pipeline flow diagram
- **lucide-react** — icons
- **TypeScript**

## Tab structure

### Dashboard tab

Rendered by `DashboardClient` when `activeTab === "dashboard"`.

1. Active dataset/model badge row
2. Two-column hero row: `AccuracyGauge` + `PipelineFlow` on the left; `LiveFeed` (fixed 420 px) + `ProgressWidget` on the right
3. `KpiCards` — four cards: running accuracy, throughput (msg/s), avg latency, positive-class rate
4. `MetricsCharts` — accuracy-over-time curve, confusion matrix, latency chart (fetches from `/metrics`)
5. `BenchmarkSurface` — live current-run stats + last finalized benchmark window for the active model

### Training Lab tab

Rendered when `activeTab === "training-lab"`.

1. `TrainingLab` — form with dataset selector, algorithm selector, model name field, train-fraction
   slider (5–100%), Train button. On submit: `POST trainer:/train` → opens `GET /train/stream` →
   renders animated segmented progress bar with per-step accuracy readout and ETA.
2. `ModelCards` — full-width cards for all models in the catalog. Newest-first. Each card is
   expandable: shows algo, features, accuracy/precision/recall, `train_fraction` (if `source='trained'`),
   trained-at date, format download buttons (disabled for `null` formats), and last benchmark run
   summary. While a training job runs, a live loading card appears at the top of the list showing
   real-time step/total/accuracy.

### Monitoring tab

Rendered when `activeTab === "monitoring"`.

`Monitoring` component polls `GET /monitoring` (via inference) and renders a bento-style grid:
- Postgres card: DB size, total predictions, predictions by dataset, active connections
- Redis card: version, memory, connected clients, ops/sec, subscriber counts for `transactions` and
  `control` channels
- Streamer card: live status (ok / down / unknown) derived from the `streamer:heartbeat` key;
  dataset, paused state, interval, messages sent, rate
- Inference card: models loaded, active dataset/model, throughput, avg latency, SSE subscriber count,
  uptime

### Settings popup (`SettingsPopup`)

Opens from the TopNav. Contains:
- Dataset selector radio group (fraud / iot / intrusion) — `POST /control { dataset }`
- Model selector for the active dataset — `POST /control { model }`
- Speed slider (`interval_ms` 50–5000 ms) — `POST /control { interval_ms }`
- Pause/resume toggle — `POST /control { paused }`
- Export buttons: one per format (joblib / pickle / onnx / pmml); disabled for `null` formats

## SSE client (`useLiveStream`)

`dashboard/hooks/useLiveStream.ts` manages a single `EventSource` to `GET /stream`.

- Events arrive at arbitrary rates; pushing each event directly to React state would cause
  excessive renders. Instead, `onmessage` pushes events into a `bufferRef` (plain ref, no renders)
  and schedules a `requestAnimationFrame` flush.
- `flush()` drains the buffer atomically: takes the last event's aggregates as the new gauge value
  and prepends all buffered events to the live feed list (capped at 40 items).
- On error: closes the `EventSource`, sets status to `disconnected`, and reconnects after an
  exponentially increasing delay (1 s → 30 s max).
- Returns `{ aggregates, events, status }`. Components subscribe to the specific slice they need;
  the hook is mounted once in `DashboardClient` and never remounts on tab switches.

## `lib/api.ts` surface

All network calls go through `lib/api.ts`. Key functions:

| Function | Target |
|---|---|
| `streamUrl()` | Builds `${NEXT_PUBLIC_INFERENCE_URL}/stream` |
| `fetchHealth()` | `GET /health` |
| `fetchRegistry()` | `GET /registry` (unwraps `body.registry`) |
| `fetchMetrics(dataset)` | `GET /metrics?dataset=` |
| `postControl(payload)` | `POST /control` |
| `modelExportUrl(dataset, slug, format)` | Builds export URL for `<a>` download |
| `fetchProgress(dataset)` | `GET /progress?dataset=` |
| `fetchModels(dataset?)` | `GET /models[?dataset=]` |
| `fetchModelDetail(dataset, slug)` | `GET /models/{dataset}/{slug}` |
| `fetchModelRuns(dataset, slug)` | `GET /models/{dataset}/{slug}/runs` |
| `fetchLastRun(dataset, slug)` | `GET /models/{dataset}/{slug}/last-run` |
| `fetchCurrentRun(dataset, slug)` | `GET /models/{dataset}/{slug}/current-run` |
| `fetchMonitoring()` | `GET /monitoring` |
| `fetchAlgos()` | `GET trainer:/algos` |
| `postTrain(payload)` | `POST trainer:/train` |
| `trainStreamUrl(jobId)` | Builds `${NEXT_PUBLIC_TRAINER_URL}/train/stream?job_id=` |

## Dockerfile

Three-stage build:

1. **deps** — `npm ci` (no scripts, for layer cache)
2. **builder** — receives `NEXT_PUBLIC_INFERENCE_URL` and `NEXT_PUBLIC_TRAINER_URL` as `ARG` values,
   sets them as `ENV`, then runs `npm run build`. The bundle is baked with the URLs at this stage.
3. **runner** — copies only `standalone/` output + static assets + `public/`; runs as non-root user
   `nextjs:nodejs`. Entrypoint is `node server.js`.

## How it fits the pipeline

The dashboard is a pure consumer. It reads from inference and trainer; it never talks to Postgres,
Redis, or the streamer directly. All writes go through `POST /control` (inference relays to Redis)
and `POST /train` (trainer runs the job).

```
useLiveStream → GET inference:8000/stream (SSE, persistent)
DashboardClient → GET inference:8000/health (every 5 s, sync active model)
MetricsCharts → GET inference:8000/metrics (on demand / interval)
ProgressWidget → GET inference:8000/progress (polled)
BenchmarkSurface → GET inference:8000/models/{ds}/{slug}/current-run (polled)
ModelCards → GET inference:8000/models (on mount + after training)
Monitoring → GET inference:8000/monitoring (polled)
TrainingLab → POST trainer:8001/train + GET /train/stream (SSE, one per job)
SettingsPopup → POST inference:8000/control
```

## Gotchas / operational notes

- **`NEXT_PUBLIC_*` baked at build time** — changing these env vars after `docker build` has no
  effect. If you move inference or trainer to different ports, rebuild the image.
  In `docker-compose.yml`, the `dashboard` service passes them as `build.args`.
- **CORS** — inference and trainer both allow all origins (`allow_origins=["*"]`). This is
  intentional for the local demo. Restrict origins for any production deployment.
- **SSE reconnect** — the connection pill in `TopNav` shows `connecting` / `connected` /
  `disconnected` status from `useLiveStream`. A `disconnected` state means the browser will retry
  automatically; no user action is needed.
- **`fetchTrainerStats`** — `lib/api.ts` maps `/stats` to `GET trainer:/health` because the trainer
  `/stats` endpoint returns `active_jobs` / `last_trained` only from in-memory state, not from the
  `TrainerStats` type. The comment in `types.ts` (`GET trainer:/health — minimal response`) reflects
  this. The `/stats` endpoint does exist in `trainer/app/main.py` but the dashboard currently only
  calls `/health` for liveness.
- **`ModelCards` refresh key** — after a training job completes, `DashboardClient` bumps
  `modelCatalogKey` by 1. `ModelCards` receives this as `refreshKey` and re-fetches `/models`.
  This avoids a shared global store for cross-component refresh signaling.
- The dashboard polls `/health` every 5 seconds to stay in sync with model switches made by other
  clients (or directly via the inference API). This is a simple polling approach, not a WebSocket.
