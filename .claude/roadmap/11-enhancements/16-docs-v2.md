# T56 — Docs (v2)

**Goal:** Document the new benchmarking + observability features.

**Prerequisites:** v2 features built (T41–T55).

**Steps:**
1. Update `.claude/architecture/`: `02-services.md` (trainer DB + /stats, /monitoring), `03-data-model.md`
   (`models`, `model_runs` tables, heartbeat key), `04-decisions.md` (ADRs for DB catalog, benchmark
   runs, monitoring), `05-ml-lifecycle.md` (train_fraction).
2. Update `README.md`: train-fraction benchmarking, model catalog in DB, model cards, last-run
   benchmarks, Monitoring tab, the new nav.

**Skills/Agent:** `docs-writer`; `stop-slop`.

**Acceptance criteria:**
- Docs accurately describe the shipped v2 system; README explains the new features + how to use them.

**Status:** ☑ done
