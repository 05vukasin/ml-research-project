# T27 — Model export buttons

**Goal:** Download the active model in any available format.

**Prerequisites:** T26, T16.

**Steps:**
1. In the settings popup (or a model-info panel), render one download button per format:
   joblib / pickle / ONNX / PMML → `GET /models/{dataset}/{model}/export?format=...`.
2. Disable buttons for formats marked `null` in the registry; tooltip explains why (e.g. PMML needs Java).

**Skills/Agent:** `dashboard-designer`; `design-taste`.

**Acceptance criteria:**
- Each available format downloads the correct file; unavailable formats are disabled with a reason.

**Status:** ☑ done — per-format download buttons (joblib/pickle/onnx/pmml) via modelExportUrl; null formats disabled with tooltip (PMML needs Java).
