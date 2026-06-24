# T04 — Train the fraud model

**Goal:** Build `training/train.py` and train the first (fraud) model end to end.

**Prerequisites:** T03.

**Steps:**
1. Implement `train.py` with args `--dataset --algo --name` (per `ml-lifecycle` doc).
2. For `fraud`: load CSV, brief EDA, `StandardScaler`, stratified split, fit
   `RandomForestClassifier(class_weight="balanced")`, evaluate (accuracy/precision/recall).
3. Save `models/fraud/<slug>.joblib` + `scaler.joblib` + `metadata.json` (full schema).
4. Run: `python train.py --dataset fraud --algo random_forest --name "FraudGuard v1"`.

**Skills/Agent:** `ml-training-engineer`; `mlops-architecture`.

**Acceptance criteria:**
- `train.py` is parameterized and reusable for other datasets.
- `models/fraud/` contains a loadable `.joblib`, `scaler.joblib`, valid `metadata.json`.
- Test metrics printed and recorded in metadata.

**Status:** ☑ done — train.py built with --dataset/--algo/--name/--date CLI; fraud model trained (accuracy=0.9967, precision=1.0000, recall=0.9333); models/fraud/ contains fraudguard-v1.joblib, scaler.joblib, metadata.json.
