# T38 — Trainer: export, register, trigger reload

**Goal:** On training completion, persist the model in all formats, register it, and refresh inference.

**Prerequisites:** T37, T36, T07/T08.

**Steps:**
1. On job completion: export `joblib` + `pickle` + `onnx` (+ `pmml` if Java) and `scaler.joblib`,
   write `metadata.json`, upsert `models/registry.json` (new model under its dataset).
2. `POST inference:/reload` so the new model is immediately usable.
3. Surface the new slug + available formats in the final SSE event.

**Skills/Agent:** `ml-training-engineer`; `mlops-architecture`.

**Acceptance criteria:**
- After a Training Lab run, the new model appears in `/registry`, is selectable in the stream, and is
  downloadable in every available format — no restart.
- Registry remains valid; all referenced files exist.

**Status:** ☑ done — on completion exports joblib/pickle/onnx/pmml(null, no Java in test), writes metadata.json, upserts registry.json, calls POST inference:/reload; verified formats + registry upsert; test artifacts reverted.
