# T39 — Dashboard: Training Lab (live training UI)

**Goal:** A UI to launch training and watch the model learn live, then use/export it.

**Prerequisites:** T20, T37, T38, T26 (settings/registry).

**Steps:**
1. A "Training Lab" view/tab: form to pick `dataset`, `algo` (from `GET trainer:/algos`), and a model
   `name`; Train button → `POST trainer:/train`.
2. Open `GET /train/stream?job_id=`; animate a **live accuracy curve** climbing (Recharts) + a progress
   bar + status; use `realtime-ui` patterns (batching, springy updates).
3. On completion: show final metrics, and make the new model immediately selectable (refresh `/registry`)
   and exportable (reuse the export buttons).

**Skills/Agent:** `dashboard-designer`; `design-taste`, `realtime-ui`, `shadcn`, `vercel-react-view-transitions`.

**Acceptance criteria:**
- Starting a job shows accuracy genuinely climbing in real time to a final value.
- The freshly trained model is usable in the live stream and downloadable, without reload.
- Meets the `design-taste` checklist; passes `/design-review`.

**Status:** ☑ done — TrainingLab.tsx: dataset/algo(/algos)/name form → POST /train, SSE /train/stream animates a live accuracy curve climbing + progress bar; on done shows metrics and refreshes /registry so the new model is selectable + exportable.
