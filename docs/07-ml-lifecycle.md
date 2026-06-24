# ML Lifecycle

The system treats models as static artifacts: trained once, serialized to disk, loaded at
startup, and consumed read-only on every event. A separate training path (the trainer service)
handles user-triggered live training, but the serving path never calls `.fit()`.

---

## 1. Offline training (`training/train.py`)

Run once per dataset before building the Docker images. The results are committed to `models/`
so the system runs out of the box with no training at startup.

```bash
cd training
python train.py --dataset fraud     --algo random_forest --name "FraudGuard v1"
python train.py --dataset iot       --algo random_forest --name "RotorMind v1"
python train.py --dataset intrusion --algo random_forest --name "NetGuard v1"
```

Steps inside `train.py`:

1. Load `data/<dataset>/sample.csv`.
2. Identify feature columns from `models/registry.json` (or fall back to all-but-last).
3. Print basic EDA (shape, class balance).
4. Stratified train/test split (default 80/20 for offline training; configurable with `--test-size`).
5. Fit `StandardScaler` on the training split.
6. Fit `RandomForestClassifier` (or `DecisionTreeClassifier` if `--algo decision_tree`) with `class_weight="balanced"`.
7. Evaluate on the test split: accuracy, precision, recall.
8. Export all serialization formats (see section 2).
9. Write `scaler.joblib` and `metadata.json` to `models/<dataset>/`.
10. Update `models/registry.json`.

---

## 2. Serialization formats

| Format | File | Library | Notes |
|---|---|---|---|
| **joblib** | `<slug>.joblib` | `joblib.dump` | Primary format — what inference loads at startup. Efficient for numpy arrays inside sklearn objects. |
| pickle | `<slug>.pkl` | `pickle.dump` | Standard Python serialization. Less efficient than joblib for large estimators. |
| ONNX | `<slug>.onnx` | `skl2onnx` + `onnx` | Language-agnostic portable format. Can be served with `onnxruntime` in any language. |
| PMML | `<slug>.pmml` | `sklearn2pmml` | XML standard. A JRE is present, but conversion fails on this scikit-learn version — not generated. |

**PMML is `null` on this runtime.** The trainer image ships a JRE (`default-jre-headless`), but
`sklearn2pmml` fails to convert on this scikit-learn version, so PMML is skipped. Every committed
model has `"pmml": null` in `registry.json`. To enable PMML:

1. Pin a compatible `sklearn2pmml`/scikit-learn pairing in `trainer/Dockerfile`.
2. Retrain (offline or via the Training Lab).
3. The trainer will export `<slug>.pmml` and write the filename into `registry.json`.
4. The dashboard download button activates automatically.

**Metadata.** `train.py` writes `metadata.json` alongside the model files. It carries:
- `name`, `slug`, `algo` — display and identification.
- `features` — ordered list of column names the model expects.
- `classes` — mapping from integer label to human-readable string.
- `metrics` — accuracy, precision, recall from the test split.
- `trained_at` — ISO date.
- `formats` — dict with format keys and filenames (or `null`).

Without `metadata.json`, the `.joblib` file is opaque — the model has no record of what
columns it expects or what label `1` means.

---

## 3. Runtime consumption (inference)

At startup, inference reads `registry.json` and calls `joblib.load` on every model and scaler
into memory (ADR-003). All three datasets' models are loaded regardless of which dataset is
currently active, so switching datasets takes effect within one event cycle with no disk I/O.

Per-event hot path:

1. Receive `{ dataset, features, actual }` from Redis.
2. Validate `dataset`, `features`, `actual`.
3. Select the active model slug for the dataset.
4. `scaler.transform(feature_array)`.
5. `model.predict(scaled_array)` → label (0 or 1).
6. `model.predict_proba(scaled_array)` → probability for the positive class.
7. Compute `is_correct`, `latency_ms`.
8. Insert into `predictions`; push SSE event.

**Never `.fit()`.** The model object is read-only operational state. Any attempt to call
`.fit()` in the inference process is a bug.

---

## 4. Export to users (dashboard)

`GET /models/{dataset}/{slug}/export?format=joblib|pickle|onnx|pmml`

Inference resolves the filename from `registry.json`, validates that the path stays inside
`models/<dataset>/` (path traversal check), and streams the file as a download attachment.
PMML with `null` filename returns 404.

---

## 5. Live training (trainer service)

The Training Lab adds interactive model training on top of the offline lifecycle without
breaking the hard rule.

**Flow:**

1. Operator picks dataset, algorithm, name, and `train_fraction` (0.05–1.0, default 0.7) in the Training Lab.
2. `POST trainer:/train` starts a background job in the trainer's thread pool; returns `job_id`.
3. `GET /train/stream?job_id=` (SSE) streams progress.
4. Trainer splits the data: `test_size = 1 - train_fraction`.
5. Trainer fits incrementally:
   - **Random Forest:** `RandomForestClassifier(warm_start=True)`, growing `n_estimators` in batches.
   - **SGD:** `SGDClassifier.partial_fit` over mini-batches.
   - After each batch, emits `{ step, total, accuracy, status }`. Accuracy climbs visibly on screen.
6. On completion:
   - Exports joblib, pickle, ONNX (PMML skipped — `sklearn2pmml` incompatibility).
   - Writes `models/<dataset>/<slug>.metadata.json` (slug-prefixed to avoid overwriting shared `metadata.json`).
   - Upserts `registry.json`.
   - Writes a `models` row with `source='trained'` and `train_fraction`.
   - Calls `POST inference:/reload`.
7. Inference reloads. The new model is immediately usable and downloadable.

**train_fraction effect:** a lower fraction means less training data, so accuracy typically
starts lower and the incremental curve is steeper. The final SSE result event and the model
card both display the `train_fraction` used.

See [services/trainer.md](services/trainer.md) for trainer internals.

---

## 6. Benchmark runs (automatic, inference)

Inference maintains an in-memory accumulator for the active `(dataset, model_slug)` pair:
event count, correct count, confusion matrix, latency samples (bounded ring buffer for p95),
and a start timestamp.

**Finalization triggers:**
- `POST /control` changes the active dataset or model → the previous window is finalized.
- The stream is idle for 30 seconds (no incoming events) → the background idle-check task finalizes the window.

On finalization, inference writes a `model_runs` row with `is_last=true` and clears
`is_last` on the prior run for that model. No user action required.

**Reading benchmark data:**
- `GET /models/{dataset}/{slug}/last-run` — the most recently finalized run.
- `GET /models/{dataset}/{slug}/current-run` — live snapshot of the accumulator while the model is active.
- `GET /models/{dataset}/{slug}/runs` — full run history, most recent first.

The Dashboard tab shows the current-run panel (polled every 2 seconds) alongside the
last-run for comparison. Model cards in the Training Lab show the last-run metrics.

See [05-data-model.md](05-data-model.md) for the `model_runs` table schema.
See [06-api-reference.md](06-api-reference.md) for the endpoint response shapes.

---

## Production extensions (not implemented, worth noting)

In a production deployment you would add:

- **Model versioning registry** (e.g. MLflow) — tracks experiments, hyperparameters, and artifact lineage.
- **Drift detection** on the live stream — alert when feature distributions or accuracy degrade.
- **Automated retraining pipelines** — triggered by drift or a schedule, not manual clicks.
- **ONNX serving** — cross-language inference without a Python runtime.
- **Shadow mode** — run a new model in parallel without serving its predictions, compare accuracy before promoting.
