# 04 — Decisions (ADR-style)

Short, append-only records of *why*. Don't reverse silently — add a superseding entry.

## ADR-001 — Redis pub/sub between streamer and inference
**Decision:** use Redis pub/sub (`transactions`, `control`) instead of direct HTTP or Kafka.
**Why:** gives a realistic message-queue/decoupling feel for an MLOps demo, trivial to run in Docker,
and the same broker cleanly carries the live control commands back to the streamer. Kafka is overkill
for a student project; direct HTTP couples the services and makes the control channel awkward.

## ADR-002 — SSE for live dashboard, REST for history
**Decision:** stream live events to the dashboard via Server-Sent Events; serve historical/aggregate
metrics via REST endpoints that read PostgreSQL.
**Why:** SSE is one-directional (server→client), simpler than WebSockets, and ideal for smooth
animation. REST-over-Postgres satisfies the assignment requirement that the dashboard reads metrics
from the database and provides aggregates SSE alone cannot.

## ADR-003 — Pre-load all models in memory at inference startup
**Decision:** read `registry.json` and `joblib.load` every dataset's model+scaler at boot.
**Why:** dataset/model switching from the UI must be instant (no restart, no disk load on the hot
path). Memory cost is small for these models. Reinforces the rule: never train at runtime.

## ADR-004 — Three datasets, all binary classification with labels
**Decision:** ship `fraud`, `iot`, `intrusion`, each binary with ground-truth labels.
**Why:** ground-truth labels make the hero "accuracy gauge" a *real* metric, not a fabricated one.
Multiple datasets make the demo more interactive and show the architecture is domain-agnostic.

## ADR-005 — Pre-generate all export formats at training time
**Decision:** `train.py` writes joblib, pickle, ONNX, and (if Java available) PMML; the export
endpoint just serves the files.
**Why:** avoids heavy conversion dependencies (and Java) on the inference hot path/runtime image, and
makes downloads instant. Missing formats are marked `null` in the registry and disabled in the UI.

## ADR-006 — Clean light theme, shadcn/ui
**Decision:** clean light design system with shadcn/ui + Tailwind; animations via Motion + view transitions.
**Why:** user preference; shadcn gives accessible, consistent primitives fast, leaving effort for the
animation polish that makes the dashboard feel premium. Enforced via the `design-taste` project skill.

## ADR-008 — Live training in a dedicated `trainer` service (not in inference)
**Decision:** add interactive, user-triggered live training as a separate `trainer` FastAPI service that
streams progress over SSE, exports artifacts, registers them, and asks inference to `/reload`. Inference
still never trains.
**Why:** the user wants to watch a model train live and then use/export it, but the assignment forbids
the serving path from training. A separate training pipeline is the correct MLOps shape: it isolates
`.fit()` from `.predict()`, keeps the serving image lean, and models real systems (train pipeline →
registry → serving reload). Incremental fit (`warm_start`/`partial_fit`) makes the accuracy genuinely
climb on screen rather than faking a curve.

## ADR-009 — Synthetic-by-default datasets, real datasets optional
**Decision:** ship committed synthetic-but-structured sample datasets (with a learnable signal) for
fraud/iot/intrusion so the whole system runs offline with one command; document how to drop in the real
Kaggle datasets.
**Why:** removes any Kaggle-account/network dependency for `docker compose up`, keeps the repo small, and
still demonstrates real accuracy/learning. Reproducible and CI-friendly.

## ADR-007 — Redis counts as auxiliary infra, not a 5th "logical unit"
**Decision:** run Redis as its own container alongside Postgres.
**Why:** the assignment's four logical units (DB, streamer, central app, dashboard) remain cleanly
separated; Redis is infrastructure like the database. Documented in the README.

## ADR-010 — inference `/reload` endpoint for hot model swap after training
**Decision:** add `POST /reload` to the inference service. It re-reads `registry.json` and
`joblib.load`s any new or changed model artifacts without restarting the process.
**Why:** the trainer service writes new artifacts and then calls `/reload`; users see the new
model available in the settings popup within seconds. A full container restart would clear the
in-memory SSE state and predictions aggregates, and require the dashboard to reconnect.

## ADR-012 — psycopg2 for inference, psycopg3 for trainer
**Decision:** inference uses `psycopg2-binary` (`postgresql+psycopg2://` DSN); trainer uses
`psycopg[binary]` v3 (`postgresql+psycopg://` DSN). The trainer compose service constructs its DSN from
`POSTGRES_*` env vars at runtime; no separate `TRAINER_DATABASE_URL` is needed in `.env`.
**Why:** the trainer was added later when psycopg3 was the preferred driver. Migrating inference to
psycopg3 is a straightforward future change, but mixing versions within the same service image is not
done — each service picks one. The different DSN prefixes (`+psycopg2` vs `+psycopg`) tell SQLAlchemy
which dialect to load.

## ADR-013 — DB-backed model catalog with registry-driven prune
**Decision:** inference syncs `models/registry.json` into a Postgres `models` table on startup and after
every `/reload`. Rows in the table with no matching entry in the registry are deleted ("pruned") in the
same sync transaction.
**Why:** `registry.json` is the authoritative list of available models. Keeping a DB mirror enables SQL
joins (e.g., catalog + last-run in one query), gives the dashboard a single queryable endpoint for model
metadata, and makes the trainer's DB write (`source='trained'`) visible without re-reading the filesystem.
Pruning prevents the `/models` endpoint from returning models whose artifacts have been removed.

## ADR-014 — Automatic benchmark run per active model window
**Decision:** inference maintains an in-memory accumulator for the active `(dataset, model_slug)` pair.
Whenever the active model changes (via `POST /control`) or the stream is idle for 30 seconds, the
accumulator is finalized — written as a `model_runs` row with `is_last=true`, clearing the previous
`is_last` for that model.
**Why:** persisting per-model runs lets the dashboard show "how did this model actually perform" for any
historically active model, not just the one currently selected. The automatic trigger (on switch or idle)
means benchmark data accumulates without any user action. Keeping only `is_last=true` as the prominent
row avoids unbounded growth in query cost while preserving the full run history.

## ADR-015 — /monitoring aggregator + streamer heartbeat
**Decision:** inference exposes `GET /monitoring` that collects health stats from postgres, redis,
streamer, and itself in one response. The streamer publishes `streamer:heartbeat` as a Redis STRING key
every ~2 seconds with a 6-second TTL. The monitoring endpoint reads this key and marks the streamer as
`down` if the key is absent or the `ts` field is more than 6 seconds old.
**Why:** the dashboard Monitoring tab needs live stats from all services. Pulling directly from each
service in the browser would require CORS headers on every service and parallel fetches. Routing through
the inference aggregator keeps the browser talking to one origin and lets inference be the single point
that understands cross-service state. The Redis-key heartbeat avoids adding an HTTP endpoint to the
streamer — the streamer has no HTTP server — while keeping latency and complexity low.

## ADR-011 — PMML export is null on this runtime
**Decision:** ship `"pmml": null` in `registry.json` for all three committed models; the dashboard
disables the PMML download button for null formats.
**Why:** `sklearn2pmml` requires a Java runtime (JVM). The trainer image does not install Java to
keep the image small and the build fast. PMML remains a documented, supported format — a user who
installs Java and `sklearn2pmml` in the trainer image will get the export automatically.
