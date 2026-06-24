# T43 — Per-model benchmark recorder (auto last-run)

**Goal:** Record a benchmark "run" per active model as predictions flow; finalize on model switch.

**Prerequisites:** T41, T12/T13 (subscriber + db writer).

**Steps:**
1. Maintain an in-memory `current_run` keyed by active `(dataset, slug)`: accumulate total, correct,
   confusion (tp/fp/tn/fn), latency sum + p95 sample, started_at, throughput.
2. In `_handle_transaction` (after `agg_store.record`), update the current run for the active model.
3. On model switch (`POST /control` with new dataset/model) OR after an idle gap, **finalize**: upsert a
   `model_runs` row, set its `is_last=true` and clear the previous `is_last` for that model.
4. Optional: a `GET /models/{dataset}/{slug}/current-run` for the live panel; include current-run summary
   in the SSE aggregates or a light endpoint.

**Skills/Agent:** `inference-engineer`.

**Acceptance criteria:**
- Selecting a model then switching away writes a finalized `model_runs` row with `is_last=true`.
- The recorded accuracy/throughput/latency match the stream for that window.

**Status:** ☑ done — `inference/app/benchmark.py` added with `BenchmarkRecorder`; accumulates per (dataset, slug) with p95 sampling; finalized on model switch in `/control` and on 30s idle timeout; GET `/models/{ds}/{slug}/current-run` returns live snapshot; `model_runs` row written with `is_last=true` and prior rows cleared on finalize.
