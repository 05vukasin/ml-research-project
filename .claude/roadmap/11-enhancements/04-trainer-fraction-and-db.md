# T44 — Trainer: train_fraction + DB write + /stats

**Goal:** Train on a chosen fraction of data, persist the model to Postgres, expose trainer stats.

**Prerequisites:** T41 (models table), T37/T38 (trainer).

**Steps:**
1. `trainer/app/main.py` `TrainRequest`: add `train_fraction: float` (validate 0.05–1.0, default 0.7).
2. `trainer/app/training.py`: thread `train_fraction` into `run_training_job`; set
   `test_size = 1 - train_fraction` in the `train_test_split` (line ~381). Add `train_fraction` to
   `metadata.json` and the final SSE result event.
3. Add DB libs to `trainer/requirements.txt` (sqlalchemy + psycopg[binary]) and `DATABASE_URL` to
   `trainer/app/config.py`. After `upsert_registry`, upsert a `models` row (`source='trained'`,
   including `train_fraction`). Tolerate DB being unreachable (log, don't fail the job).
4. `GET /stats`: active jobs count, last trained {slug, dataset, accuracy, train_fraction, ts}, uptime.

**Skills/Agent:** `ml-training-engineer`; `mlops-architecture`; `postgres`.

**Acceptance criteria:**
- Training with `train_fraction=0.3` uses ~30% for training; metadata/result carry `train_fraction`.
- A `models` row is inserted (`SELECT slug, train_fraction, source FROM models`).
- `GET /stats` returns valid JSON.

**Status:** ☑ done
