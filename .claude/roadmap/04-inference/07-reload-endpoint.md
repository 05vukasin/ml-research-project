# T36 — Inference hot-reload endpoint

**Goal:** Let inference pick up newly trained models without a restart.

**Prerequisites:** T11, T14.

**Steps:**
1. `POST /reload`: re-read `registry.json` and `joblib.load` any models not already in memory (and
   refresh changed ones). Keep current active selection if still valid.
2. Make loading thread-safe vs the prediction hot path.
3. Return the updated registry summary.

**Skills/Agent:** `inference-engineer`; `mlops-architecture`.

**Acceptance criteria:**
- After the trainer writes a new model + updates the registry, `POST /reload` makes it available to
  `/registry` and the live stream without restarting inference.
- Still never calls `.fit()`.

**Status:** ☑ done — POST /reload re-reads registry.json and joblib.loads all models under threading.Lock; active selection preserved; returns {status,models_loaded,registry_summary}; verified in e2e test.
