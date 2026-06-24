# T03 — Data acquisition & samples

**Goal:** Make the three datasets available, with committed samples for out-of-the-box runs.

**Prerequisites:** T01.

**Steps:**
1. Document in `training/README` (or task notes) the source + download for each dataset:
   - fraud: Kaggle "Credit Card Fraud Detection" (`creditcard.csv`).
   - iot: "Machine Predictive Maintenance Classification" (AI4I 2020).
   - intrusion: NSL-KDD / "Network Intrusion Detection".
2. For each dataset, create a small `data/<slug>/sample.csv` (a few thousand rows, class-balanced enough
   to be meaningful) so the system runs without the full download.
3. Add `training/requirements.txt` (`pandas`, `scikit-learn`, `joblib`, `skl2onnx`, `onnx`,
   `sklearn2pmml`, `jupyter`).

**Skills/Agent:** `ml-training-engineer`.

**Acceptance criteria:**
- `data/<slug>/sample.csv` exists for all three datasets and loads in pandas.
- Sources + full-dataset instructions documented.
- `training/requirements.txt` present.

**Status:** ☑ done — synthetic sample CSVs (6000 rows each) committed to data/{fraud,iot,intrusion}/sample.csv; training/requirements.txt written; dataset sources documented in training/generate_data.py header.
