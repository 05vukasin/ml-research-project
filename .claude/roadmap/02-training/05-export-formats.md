# T07 — Export all serialization formats

**Goal:** Extend `train.py` to export every format the dashboard offers for download.

**Prerequisites:** T04 (and re-run for T05/T06 models).

**Steps:**
1. After fitting, export: `joblib` (primary), `pickle` (`.pkl`), `onnx` (skl2onnx + onnx),
   `pmml` (sklearn2pmml; if Java missing, skip and set `null`).
2. Record available formats in each model's `metadata.json` (`formats` map; `null` for skipped).
3. Re-run training for all three datasets so every `models/<slug>/` has all available formats.

**Skills/Agent:** `ml-training-engineer`; see `architecture/05-ml-lifecycle.md`.

**Acceptance criteria:**
- Each model dir contains `.joblib`, `.pkl`, `.onnx`, and `.pmml` (or `pmml: null` recorded).
- `metadata.json.formats` accurately reflects what exists on disk.

**Status:** ☑ done — joblib + pickle + ONNX exported for all 3 models; PMML skipped gracefully (sklearn2pmml 0.108.0 subprocess fails on this runtime; pmml=null in metadata/registry); ONNX fix: numpy.bool_→int patch applied at module load time in train.py.
