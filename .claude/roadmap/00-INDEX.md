# Roadmap — Master Index

Work **one task at a time, in the order below** (rows are listed in execution order; the `#` column is the
task's stable id). The current task is marked `CURRENT TASK` and `▶`. When a task is done: set
`Status: ☑ done` in its file, flip its row here to `☑`, and move the pointer.

Legend: `☐` todo · `▶` in progress · `☑` done. Use the `roadmap-workflow` skill. `/next-task` to start.

> **CURRENT TASK: ALL DONE (v1 + v2)**
> v1 (T01–T40) complete. v2 (T41–T57) complete. All 57 tasks done.

## Linear order (execution order)

| # | Status | Task file | Agent / skills |
|---|---|---|---|
| T01 | ☑ | `01-foundation/01-repo-scaffold.md` | (main) mlops-architecture |
| T02 | ☑ | `01-foundation/02-env-and-config.md` | (main) mlops-architecture |
| T03 | ☑ | `02-training/01-data-acquisition.md` | ml-training-engineer |
| T04 | ☑ | `02-training/02-fraud-model.md` | ml-training-engineer |
| T05 | ☑ | `02-training/03-iot-model.md` | ml-training-engineer |
| T06 | ☑ | `02-training/04-intrusion-model.md` | ml-training-engineer |
| T07 | ☑ | `02-training/05-export-formats.md` | ml-training-engineer |
| T08 | ☑ | `02-training/06-registry.md` | ml-training-engineer |
| T09 | ☑ | `03-database/01-schema.md` | inference-engineer + postgres |
| T10 | ☑ | `03-database/02-init-scripts.md` | inference-engineer + postgres |
| T11 | ☑ | `04-inference/01-model-loader.md` | inference-engineer |
| T12 | ☑ | `04-inference/02-redis-subscriber.md` | inference-engineer |
| T13 | ☑ | `04-inference/03-db-writer.md` | inference-engineer + postgres |
| T14 | ☑ | `04-inference/04-sse-rest-endpoints.md` | inference-engineer |
| T15 | ☑ | `04-inference/05-control-endpoint.md` | inference-engineer |
| T16 | ☑ | `04-inference/06-export-endpoint.md` | inference-engineer |
| T36 | ☑ | `04-inference/07-reload-endpoint.md` | inference-engineer |
| T17 | ☑ | `05-streamer/01-publisher.md` | streamer-engineer |
| T18 | ☑ | `05-streamer/02-control-channel.md` | streamer-engineer |
| T19 | ☑ | `05-streamer/03-dataset-switching.md` | streamer-engineer |
| T37 | ☑ | `10-trainer/01-trainer-service.md` | ml-training-engineer |
| T38 | ☑ | `10-trainer/02-export-register-reload.md` | ml-training-engineer |
| T20 | ☑ | `06-dashboard/01-scaffold-shadcn.md` | dashboard-designer |
| T21 | ☑ | `06-dashboard/02-sse-client.md` | dashboard-designer + realtime-ui |
| T22 | ☑ | `06-dashboard/03-accuracy-gauge.md` | dashboard-designer + design-taste |
| T23 | ☑ | `06-dashboard/04-live-feed.md` | dashboard-designer + realtime-ui |
| T24 | ☑ | `06-dashboard/05-pipeline-flow.md` | dashboard-designer + realtime-ui |
| T25 | ☑ | `06-dashboard/06-charts-kpis.md` | dashboard-designer |
| T26 | ☑ | `06-dashboard/07-settings-popup.md` | dashboard-designer |
| T27 | ☑ | `06-dashboard/08-export-buttons.md` | dashboard-designer |
| T28 | ☑ | `06-dashboard/09-progress-widget.md` | dashboard-designer |
| T39 | ☑ | `06-dashboard/11-training-lab.md` | dashboard-designer + realtime-ui |
| T29 | ☑ | `06-dashboard/10-design-polish.md` | dashboard-designer + /design-review |
| T30 | ☑ | `07-docker/01-dockerfiles.md` | devops-engineer |
| T31 | ☑ | `07-docker/02-compose-healthchecks.md` | devops-engineer |
| T40 | ☑ | `07-docker/04-trainer-container.md` | devops-engineer |
| T32 | ☑ | `07-docker/03-one-command-run.md` | devops-engineer |
| T33 | ☑ | `08-docs/01-readme.md` | docs-writer + stop-slop |
| T34 | ☑ | `08-docs/02-architecture-finalize.md` | docs-writer |
| T35 | ☑ | `09-verification/01-e2e-checklist.md` | qa-verifier |
| — | — | **— v2: benchmarking & observability (11-enhancements) —** | |
| T41 | ☑ | `11-enhancements/01-db-models-tables.md` | inference-engineer + postgres |
| T42 | ☑ | `11-enhancements/02-catalog-sync-endpoints.md` | inference-engineer + postgres |
| T43 | ☑ | `11-enhancements/03-benchmark-recorder.md` | inference-engineer |
| T44 | ☑ | `11-enhancements/04-trainer-fraction-and-db.md` | ml-training-engineer |
| T45 | ☑ | `11-enhancements/05-streamer-heartbeat.md` | streamer-engineer |
| T46 | ☑ | `11-enhancements/06-monitoring-endpoint.md` | inference-engineer + postgres |
| T47 | ☑ | `11-enhancements/07-nav-refactor.md` | dashboard-designer |
| T48 | ☑ | `11-enhancements/08-livefeed-fixed-playpause.md` | dashboard-designer + realtime-ui |
| T49 | ☑ | `11-enhancements/09-api-types-extend.md` | dashboard-designer |
| T50 | ☑ | `11-enhancements/10-training-fraction-progress.md` | dashboard-designer + realtime-ui |
| T51 | ☑ | `11-enhancements/11-model-cards.md` | dashboard-designer + design-taste |
| T52 | ☑ | `11-enhancements/12-dashboard-benchmark-surface.md` | dashboard-designer + realtime-ui |
| T53 | ☑ | `11-enhancements/13-monitoring-bento.md` | dashboard-designer + design-taste |
| T54 | ☑ | `11-enhancements/14-design-review-v2.md` | dashboard-designer + /design-review |
| T55 | ☑ | `11-enhancements/15-compose-env-updates.md` | devops-engineer |
| T56 | ☑ | `11-enhancements/16-docs-v2.md` | docs-writer + stop-slop |
| T57 | ☑ | `11-enhancements/17-verify-v2.md` | qa-verifier |

## Progress by service

| Service | Done / Total |
|---|---|
| 01 foundation | 2 / 2 |
| 02 training | 6 / 6 |
| 03 database | 2 / 2 |
| 04 inference | 7 / 7 |
| 05 streamer | 3 / 3 |
| 10 trainer | 2 / 2 |
| 06 dashboard | 11 / 11 |
| 07 docker | 4 / 4 |
| 08 docs | 2 / 2 |
| 09 verification | 1 / 1 |
| 11 enhancements (v2) | 17 / 17 |
| **Total** | **57 / 57** |
