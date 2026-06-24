# T11 — Model loader (registry → memory)

**Goal:** Load every model+scaler into memory at startup from the registry.

**Prerequisites:** T08.

**Steps:**
1. Implement `inference/app/model.py`: read `MODELS_DIR/registry.json`, `joblib.load` each model and
   scaler into a dict keyed by `(dataset, slug)`. Track `active_dataset` + `active_model`.
2. Provide `predict(dataset, model, features) -> (label, probability)` that scales then predicts.
3. Fail loudly if any referenced file is missing. **Never** call `.fit()`.

**Skills/Agent:** `inference-engineer`; `mlops-architecture`.

**Acceptance criteria:**
- All registry models load at startup; missing file → clear startup error.
- `predict()` returns correct label + probability for a sample row.
- No training code anywhere in the runtime path.

**Status:** ☑ done — inference/app/model.py: ModelStore loads all registry models+scalers at startup via joblib.load; predict() scales then predicts; fails loudly on missing file; never calls .fit(); reload() is thread-safe.
