# T49 — API client + types for v2

**Goal:** Front-end data access for models, runs, monitoring, trainer stats, train_fraction.

**Prerequisites:** T42, T44, T46.

**Steps:**
1. `lib/api.ts`: add `fetchModels(dataset?)`, `fetchModelDetail(d,s)`, `fetchModelRuns(d,s)`,
   `fetchLastRun(d,s)`, `fetchMonitoring()`, trainer `fetchStats()`; extend `postTrain` with
   `train_fraction`.
2. `lib/types.ts`: add `ModelCatalogEntry`, `ModelRun`, `MonitoringSnapshot`, `TrainerStats`; extend
   `TrainProgressEvent`/train payloads with `train_fraction`.
3. Keep `cache:"no-store"` pattern; base URLs from env.

**Skills/Agent:** `dashboard-designer`; `next-best-practices`.

**Acceptance criteria:**
- Typecheck passes; functions hit the correct endpoints; types match the API JSON.

**Status:** ☑ done — lib/api.ts: fetchModels/ModelDetail/ModelRuns/LastRun/CurrentRun/Monitoring + trainer fetchTrainerStats; postTrain gains train_fraction. lib/types.ts: ModelCatalogEntry, ModelRun, CurrentRun, MonitoringSnapshot, TrainerStats. tsc + build clean.
