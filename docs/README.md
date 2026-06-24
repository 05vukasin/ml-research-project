# Documentation Index

This directory contains the full reference documentation for the MLOps Real-Time ML Monitoring
system. Start with the root [README.md](../README.md) for a quick overview and the one-command
quickstart, then use the pages below for deeper reference.

## Contents

| File | Description |
|---|---|
| [01-overview.md](01-overview.md) | Domain problems, system goals, feature tour with screenshots, glossary |
| [02-architecture.md](02-architecture.md) | Architecture diagram, 6-container table, data flow, design decisions (ADRs) |
| [03-workflow.md](03-workflow.md) | End-to-end workflows: streaming path, live control, training, monitoring loop |
| [04-getting-started.md](04-getting-started.md) | Prerequisites, one-command run, env var table, real dataset swap, troubleshooting |
| [05-data-model.md](05-data-model.md) | Postgres tables (predictions / models / model_runs), registry.json shape, Redis channels |
| [06-api-reference.md](06-api-reference.md) | Every HTTP endpoint on inference (:8000) and trainer (:8001) |
| [07-ml-lifecycle.md](07-ml-lifecycle.md) | Offline training, serialization formats, live training via trainer, benchmark runs |

## Per-service docs

These files are maintained by the service engineers and document internals, Dockerfile details,
and per-service configuration.

| File | Description |
|---|---|
| [services/inference.md](services/inference.md) | Inference service — model loading, SSE queue, thread pool, hot reload |
| [services/trainer.md](services/trainer.md) | Trainer service — incremental fit, job lifecycle, artifact writes |
| [services/streamer.md](services/streamer.md) | Streamer — CSV replay loop, control subscriber, heartbeat thread |
| [services/postgres.md](services/postgres.md) | PostgreSQL — schema, indexes, query patterns |
| [services/redis.md](services/redis.md) | Redis — pub/sub setup, channel payloads, heartbeat key |
| [services/dashboard.md](services/dashboard.md) | Dashboard — SSE client, components, React Flow pipeline |
