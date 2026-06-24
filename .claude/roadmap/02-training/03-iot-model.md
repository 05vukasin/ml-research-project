# T05 — Train the IoT model

**Goal:** Train the predictive-maintenance (iot) model reusing `train.py`.

**Prerequisites:** T04.

**Steps:**
1. Adapt feature handling for the iot dataset (numeric sensor columns; encode any categoricals).
2. Run: `python train.py --dataset iot --algo random_forest --name "RotorMind v1"`.
3. Verify `models/iot/` artifacts + metadata.

**Skills/Agent:** `ml-training-engineer`.

**Acceptance criteria:**
- `models/iot/` has loadable `.joblib`, `scaler.joblib`, valid `metadata.json` with metrics.
- No changes required to runtime services (registry-driven).

**Status:** ☑ done — iot model trained via train.py (accuracy=0.9958, precision=0.9691, recall=0.9792); models/iot/ contains rotormind-v1.joblib, scaler.joblib, metadata.json.
