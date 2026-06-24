# T51 — Expandable model cards

**Goal:** Browse all models as cards; click to expand full charts/data per model.

**Prerequisites:** T42, T43, T49.

**Steps:**
1. New `components/dashboard/ModelCards.tsx` in the Training Lab: a list/grid of cards, one per model
   (name, dataset badge, algo, key metric, train_fraction) from `fetchModels()`.
2. Click → expand (Motion height/layout) to show: full metrics, **last-run benchmark** (accuracy,
   throughput, latency, confusion) via reused Recharts/`MetricsCharts`/`KpiCards` patterns, and the
   **export buttons** (joblib/pickle/onnx; pmml disabled).
3. Newly trained models appear here after training (catalog refresh).

**Skills/Agent:** `dashboard-designer`; `design-taste`, `shadcn`.

**Acceptance criteria:**
- All seeded + trained models render as cards; expanding shows charts + last-run + export.
- Layout clean and on-scale; build passes.

**Status:** ☑ done — ModelCards.tsx: 1/2/3-col responsive grid; card face (name, dataset badge, algo, accuracy, train_fraction, source); click-to-expand (Motion height, single open at a time); last-run benchmark via fetchLastRun; export buttons; "Use this model" → switchDataset. Refreshes on training completion via refreshKey prop.
