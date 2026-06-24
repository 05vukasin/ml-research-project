# T01 — Repo scaffold

**Goal:** Create the top-level repository skeleton so every later task has a home.

**Prerequisites:** none.

**Steps:**
1. Create directories: `data/{fraud,iot,intrusion}/`, `training/`, `models/`, `streamer/`,
   `inference/app/`, `dashboard/`.
2. Add a root `.gitignore` (ignore large CSVs except `sample.csv`, `__pycache__`, `node_modules`,
   `.next`, `*.pyc`, env files except `.env.example`).
3. Add placeholder `.gitkeep` where needed so empty dirs persist.
4. Create an empty `models/registry.json` with `{}`.

**Skills/Agent:** main loop; `mlops-architecture` for layout.

**Acceptance criteria:**
- Directory tree matches the plan's repo structure.
- `.gitignore` keeps sample CSVs but ignores full datasets and build artifacts.
- `models/registry.json` exists and is valid JSON.

**Status:** ☑ done — scaffold created (incl. trainer/), .gitignore keeps samples/ignores full data, registry.json `{}`, git initialized.
