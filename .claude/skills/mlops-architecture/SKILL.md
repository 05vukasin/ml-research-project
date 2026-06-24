---
name: mlops-architecture
description: Architecture conventions for this MLOps system — service boundaries, naming, env vars, Redis channels, DB schema, model registry, and the no-training-at-runtime rule. Use when writing or changing any Python service (streamer/inference/training), the registry, or how services talk to each other.
---

# MLOps Architecture Conventions

Keep every service inside its boundary and talking only through the defined contracts.

## Service boundaries (don't cross them)

- **streamer** only reads CSVs and publishes to Redis `transactions`; subscribes to `control`. It never
  touches Postgres or the models.
- **inference** owns the models and the database. It is the only writer to Postgres and the only loader
  of `models/**`. It relays UI commands to `control` but the streamer owns acting on them.
- **dashboard** never talks to Redis or Postgres directly — only to inference HTTP endpoints.

## The hard rule

**Never call `.fit()` at runtime.** Training lives only in `training/`. Inference loads serialized
models and calls `.predict()` / `.predict_proba()` only. If a model file is missing at startup, fail
loudly — do not train a fallback.

## Naming

- Dataset slugs: `fraud`, `iot`, `intrusion` (lowercase, stable keys everywhere).
- Model slugs: kebab-case derived from the display name (`"FraudGuard v1"` → `fraudguard-v1`).
- Redis channels: `transactions`, `control`. Postgres table: `predictions`.

## Contracts (canonical — see architecture/01 & 03)

- `transactions` payload: `{ dataset, features, actual }`.
- `control` payload: `{ interval_ms?, paused?, dataset?, model? }`.
- `predictions` columns: see `architecture/03-data-model.md`. Always write `dataset`, `model_name`,
  `received_at`, `processed_at`, `latency_ms`, `prediction`, `actual_label`, `is_correct`, `probability`.
- `registry.json` shape: see `architecture/03-data-model.md`. Treat it as the source of truth for what
  models exist, their labels/classes/colors, and which export formats are available.

## Config

- All config via env vars; no hardcoded hosts/ports/credentials. Keep `.env.example` in sync.
- Standard vars: `REDIS_URL`, `DATABASE_URL`, `MODELS_DIR`, `DATA_DIR`, `START_DATASET`,
  `START_INTERVAL_MS`, `NEXT_PUBLIC_INFERENCE_URL`.

## Python style

- Type hints on public functions; small, pure, testable units; explicit error handling on I/O
  (Redis/DB/file). Apply `security-best-practices` (no eval of payloads, parameterized SQL, validate
  inputs). Apply `postgres` skill for schema/queries.

## When adding a dataset

1. Add CSV + sample under `data/<slug>/`.
2. Train + export via `train.py --dataset <slug> ...` → updates `registry.json`.
3. No code change needed in streamer/inference/dashboard — they are registry-driven. If a change *is*
   needed, that's a smell: push the variation into metadata, not into branching code.
