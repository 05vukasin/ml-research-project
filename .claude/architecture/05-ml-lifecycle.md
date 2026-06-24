# 05 — ML Lifecycle

The model is treated as a **stateful object that is trained once and only consumed at runtime**.

## 1. Train (offline, in `training/`)

```bash
python train.py --dataset fraud --algo random_forest --name "FraudGuard v1"
```

Steps inside `train.py`:
1. Load the dataset CSV (full dataset for real numbers; sample committed for out-of-the-box runs).
2. Brief EDA (shapes, class balance) — printed/logged, full EDA in `analysis.ipynb`.
3. Preprocess: `StandardScaler` on numeric features; train/test split (stratified).
4. Fit a `RandomForestClassifier` (or `DecisionTreeClassifier`) with `class_weight="balanced"`.
5. Evaluate on the test split → accuracy / precision / recall.

## 2. Serialize / export (all formats)

| Format | Library | File | Purpose |
|---|---|---|---|
| **joblib** | `joblib.dump` | `<slug>.joblib` | Primary — what inference loads (efficient for sklearn) |
| pickle | `pickle` | `<slug>.pkl` | Generic Python serialization |
| ONNX | `skl2onnx` + `onnx` | `<slug>.onnx` | Portable, language-agnostic (onnxruntime) |
| PMML | `sklearn2pmml` (+ Java) | `<slug>.pmml` | XML standard; skipped → `null` if no Java |

Also write `scaler.joblib` and `metadata.json` (name, algo, features, classes, metrics, date, available
formats). Update `models/registry.json`.

> Why metadata matters: a `.joblib` file does not know column names or what label `1` means. The
> metadata makes the model usable and drives the dashboard's labels/colors and the export buttons.

## 3. Consume (runtime, in `inference/`)

- At startup: `joblib.load` every model+scaler listed in the registry into memory.
- Per event: scale features → `model.predict()` + `predict_proba()`. **Never** `.fit()`.
- The serialized object is treated as read-only operational state.

## 4. Export to the user (dashboard)

`GET /models/{dataset}/{model}/export?format=joblib|pickle|onnx|pmml` streams the pre-generated file as
a download. The settings popup shows one button per available format; `null` formats are disabled.

## Live training (the `trainer` service + Training Lab)

In addition to the offline pre-training above, the system exposes **interactive live training** as a
feature — without ever making the *serving* path train.

Flow:
1. In the dashboard **Training Lab**, the user picks `dataset`, `algo`, `name`, and a **train fraction**
   (5%–100%, default 70%), then clicks Train.
2. Dashboard `POST trainer:/train` with `{ dataset, algo, name, train_fraction }` → returns a `job_id`;
   dashboard opens `GET /train/stream?job_id=`.
3. The trainer computes `test_size = 1 - train_fraction`, splits the data, and fits the model
   **incrementally**, emitting an SSE progress event after each batch:
   `{ step, total, accuracy, status }`. The dashboard renders an animated segmented progress bar with a
   live accuracy readout and ETA.
   - Incremental strategy: `RandomForestClassifier(warm_start=True)` growing `n_estimators` in steps.
4. On completion the trainer **exports all formats** (joblib/pickle/onnx/pmml), writes
   `<slug>.metadata.json` (slug-prefixed to avoid overwriting seeded metadata), upserts `registry.json`,
   writes a `models` row to Postgres (`source='trained'`, includes `train_fraction`), and
   `POST inference:/reload`.
5. Inference reloads the registry and re-runs `sync_registry_to_db()`. The new model appears in the
   settings popup and in the model cards, is usable in the live stream, and is downloadable in every
   format. The final SSE result event includes `train_fraction` for display in the dashboard.

This keeps the hard rule intact: inference never calls `.fit()`. Training is an explicit, isolated,
user-triggered pipeline in its own service.

## Production note (documented, not implemented)

In a real deployment you'd add: model versioning + a registry service (e.g. MLflow), drift detection on
the live stream, automated retraining pipelines, and ONNX serving for cross-language inference. Out of
scope here but worth mentioning in the README.
