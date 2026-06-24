# T06 — Train the intrusion model

**Goal:** Train the network-intrusion model reusing `train.py`.

**Prerequisites:** T05.

**Steps:**
1. Adapt feature handling for the intrusion dataset (encode categorical protocol/service/flag columns;
   collapse labels to binary attack/normal).
2. Run: `python train.py --dataset intrusion --algo random_forest --name "NetGuard v1"`.
3. Verify `models/intrusion/` artifacts + metadata.

**Skills/Agent:** `ml-training-engineer`.

**Acceptance criteria:**
- `models/intrusion/` has loadable `.joblib`, `scaler.joblib`, valid `metadata.json` with metrics.
- Binary label mapping documented in metadata.

**Status:** ☑ done — intrusion model trained via train.py (accuracy=1.0000, precision=1.0000, recall=1.0000); models/intrusion/ contains netguard-v1.joblib, scaler.joblib, metadata.json; binary label mapped in dataset config.
