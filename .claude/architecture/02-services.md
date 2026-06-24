# 02 — Services

Per-service contract: responsibility, I/O, env vars, ports, Dockerfile summary.

## streamer (Python)

- **Responsibility:** replay the active dataset CSV to Redis at a controllable rate; obey control commands.
- **In:** CSV files under `DATA_DIR`; `control` channel.
- **Out:** `transactions` channel; `streamer:heartbeat` Redis key (STRING, TTL=6s, written every ~2s).
- **Env:** `REDIS_URL`, `DATA_DIR=/data`, `START_DATASET=fraud`, `START_INTERVAL_MS=500`.
- **Port:** none (worker).
- **Dockerfile:** python-slim, install `pandas`, `redis`; copy `streamer.py`; `CMD python streamer.py`.
- **Heartbeat:** a daemon thread writes `{ dataset, paused, interval_ms, messages_sent, rate, uptime_s, ts }`
  to `streamer:heartbeat` with a 6-second TTL. The `/monitoring` endpoint in inference reads this key; a
  missing or stale (> 6 s old) key marks the streamer as `down`.

## inference (FastAPI)

- **Responsibility:** consume stream, run pre-loaded models, persist to Postgres, serve SSE + REST.
- **In:** `transactions` channel; `models/**` (read-only mount); Postgres.
- **Out:** Postgres writes; `control` publishes (relays UI commands); HTTP (SSE + REST).
- **Env:** `REDIS_URL`, `DATABASE_URL`, `MODELS_DIR=/models`.
- **Port:** `8000`.
- **Endpoints:**
  - `GET /stream` — SSE live feed
  - `GET /metrics`, `/history`, `/registry`, `/progress` — DB-backed REST
  - `GET /models[?dataset=]` — DB-backed catalog (with last-run summary per model)
  - `GET /models/{dataset}/{slug}` — full model detail
  - `GET /models/{dataset}/{slug}/runs` — all benchmark runs, most recent first
  - `GET /models/{dataset}/{slug}/last-run` — the `is_last=true` run (or null)
  - `GET /models/{dataset}/{slug}/current-run` — live accumulator snapshot for the active model
  - `GET /models/{dataset}/{model}/export?format=` — pre-generated file download
  - `GET /monitoring` — aggregated health/stats for postgres, redis, streamer, inference
  - `POST /control` — applies dataset/model switch; finalizes the active benchmark run
  - `POST /reload` — re-reads registry and joblib.loads new/changed models
  - `GET /health`
- **Dockerfile:** python-slim, install requirements (`fastapi`, `uvicorn`, `sse-starlette`, `redis`,
  `sqlalchemy`, `psycopg2-binary`, `scikit-learn`, `joblib`, `pandas`); `CMD uvicorn app.main:app`.
- **Startup:** read `registry.json`, `joblib.load` every model+scaler into memory, then call
  `sync_registry_to_db()` to upsert/prune the `models` table. Fail loudly if models are missing.
  **Never** trains.
- **Psycopg driver:** uses `psycopg2-binary` (`postgresql+psycopg2://` DSN). See ADR-012.

## postgres

- **Responsibility:** durable store of every prediction, the model catalog, and per-model benchmark runs.
- **Env:** `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
- **Port:** `5432`.
- **Init:** `predictions`, `models`, and `model_runs` tables auto-created by inference at startup via
  `metadata.create_all(checkfirst=True)`. Healthcheck `pg_isready`.

## redis

- **Responsibility:** pub/sub broker for `transactions` and `control`.
- **Port:** `6379`. Healthcheck `redis-cli ping`.

## trainer (FastAPI) — live Training Lab

- **Responsibility:** on user request, train a new model **incrementally** while streaming progress, then
  export all formats, update the registry, and tell inference to hot-reload. Separate from serving.
- **In:** dataset CSVs (read-only); `POST /train` requests.
- **Out:** model artifacts in `models/<dataset>/`; `registry.json` updates; `POST inference:/reload`.
- **Env:** `MODELS_DIR=/models`, `DATA_DIR=/data`, `INFERENCE_URL`.
- **Port:** `8001`.
- **Endpoints:**
  - `POST /train` — `{ dataset, algo, name, train_fraction }` → starts a background training job, returns `job_id`.
    `train_fraction` controls the data split (0.05–1.0, default 0.7); `test_size = 1 - train_fraction`.
  - `GET /train/stream?job_id=` — **SSE**: progress events `{ step, total, accuracy, status }` ending with
    final metrics + `train_fraction` in the result event.
  - `GET /algos` — available algorithms for the Training Lab.
  - `GET /stats` — `{ active_jobs, last_trained: { slug, dataset, accuracy, train_fraction, ts }, uptime_s }`.
  - `GET /health`.
- **DB write:** on job completion, upserts a `models` row with `source='trained'` and `train_fraction`.
  Tolerates Postgres being unreachable (logs, does not fail the job).
- **Metadata:** writes `<slug>.metadata.json` per model, not the shared `metadata.json` (which belongs to
  seeded models). The slug-prefixed file prevents collisions when multiple trained models coexist.
- **Psycopg driver:** uses `psycopg[binary]` v3 (`postgresql+psycopg://` DSN constructed from
  `POSTGRES_*` env vars at compose time). See ADR-012.
- **How "live" works:** use an incremental learner so accuracy genuinely climbs over steps —
  `RandomForestClassifier(warm_start=True)` adding estimators in batches, or `SGDClassifier.partial_fit`
  over mini-batches — emitting test accuracy after each batch. This is the model "getting smarter" on screen.
- **Dockerfile:** python-slim + training requirements (`scikit-learn`, `joblib`, `skl2onnx`, `onnx`,
  `sklearn2pmml` optional, `fastapi`, `uvicorn`, `sse-starlette`, `pandas`). **Mounts `./models` read-write.**
- **Boundary:** the trainer is the ONLY service that writes new model artifacts at runtime. Inference
  still never trains; it only reloads finished artifacts on `/reload`.

## dashboard (Next.js)

- **Responsibility:** animated real-time UI + controls + export.
- **In:** inference SSE + REST.
- **Env:** `NEXT_PUBLIC_INFERENCE_URL` (or Next rewrites proxy to `inference:8000`).
- **Port:** `3000`.
- **Stack:** Next.js App Router, shadcn/ui, Tailwind, Motion, Recharts, `@xyflow/react`.
- **Dockerfile:** node base, `npm ci`, `npm run build`, `CMD npm start` (multi-stage for slim image).

## Dependency order (compose `depends_on` + healthchecks)

`redis`, `postgres` (healthy) → `inference` (healthy) → `dashboard`; `streamer` waits on `redis`;
`trainer` waits on `inference` **and** `postgres` (it calls `/reload` and writes to the `models` table).
`dashboard` also talks to `trainer` (port 8001) for Training Lab + `/stats`.
