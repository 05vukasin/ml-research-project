# T37 — Trainer service (live incremental training + SSE progress)

**Goal:** A FastAPI `trainer` service that trains a model incrementally and streams progress.

**Prerequisites:** T08 (datasets + train logic exist to reuse).

**Steps:**
1. Create `trainer/app/` FastAPI with `POST /train {dataset, algo, name}` → starts a background job,
   returns `job_id`; `GET /train/stream?job_id=` SSE; `GET /algos`; `GET /health`.
2. Implement incremental fit so accuracy genuinely climbs:
   - `random_forest`: `warm_start=True`, grow `n_estimators` in batches; eval on held-out test each step.
   - `sgd`: `SGDClassifier.partial_fit` over mini-batches; eval each step.
3. Emit SSE events `{step, total, accuracy, status}` per batch; final event includes test
   accuracy/precision/recall and the registered slug.
4. Reuse the preprocessing from `training/` (shared module or copied scaler logic).

**Skills/Agent:** `ml-training-engineer` + `inference-engineer` patterns; `mlops-architecture`,
`security-best-practices`.

**Acceptance criteria:**
- `POST /train` then consuming `/train/stream` shows accuracy increasing over steps to a final value.
- Job runs in the background without blocking the API; invalid dataset/algo rejected.

**Status:** ☑ done — FastAPI trainer service built with /health, /algos, POST /train, GET /train/stream SSE; RF warm_start and SGD epoch-based incremental training verified in Docker.
