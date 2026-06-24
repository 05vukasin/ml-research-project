# T16 — Model export endpoint

**Goal:** Serve pre-generated model files for download.

**Prerequisites:** T11.

**Steps:**
1. `GET /models/{dataset}/{model}/export?format={joblib|pickle|onnx|pmml}`.
2. Resolve the file from the registry's `formats` map; stream with
   `Content-Disposition: attachment; filename=...`.
3. Return 404 with a clear message if the format is `null`/missing; sanitize path params (no traversal).

**Skills/Agent:** `inference-engineer`; `security-best-practices`.

**Acceptance criteria:**
- Each available format downloads correctly; a downloaded `.joblib` re-loads with `joblib.load`.
- Missing formats → 404; path-traversal attempts are blocked.

**Status:** ☑ done — GET /models/{dataset}/{model}/export?format= streams file as attachment; joblib 5.3 MB downloads and joblib.load() succeeds; pmml=null returns 404; path traversal safely rejected; slug whitelist applied.
