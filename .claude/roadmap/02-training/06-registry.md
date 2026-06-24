# T08 — Build the model registry

**Goal:** Produce a complete `models/registry.json` describing all datasets and models.

**Prerequisites:** T04, T05, T06, T07.

**Steps:**
1. Have `train.py` upsert each trained model into `models/registry.json` per the schema in
   `architecture/03-data-model.md` (label, positive_label, theme accent, models[] with slug/algo/
   features/classes/metrics/trained_at/formats/scaler).
2. Validate the JSON and that every referenced file exists on disk.

**Skills/Agent:** `ml-training-engineer`; `mlops-architecture`.

**Acceptance criteria:**
- `registry.json` is valid and lists all three datasets with at least one model each.
- Every `formats`/`scaler` path in the registry resolves to a real file.
- Themes/labels present for dashboard consumption.

**Status:** ☑ done — models/registry.json populated with all 3 datasets; schema matches architecture/03-data-model.md; all referenced files verified on disk by verify.py (all checks pass).
