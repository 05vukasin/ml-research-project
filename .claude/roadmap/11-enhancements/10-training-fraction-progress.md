# T50 — Training Lab: fraction slider + cool progress

**Goal:** Choose the training data fraction and watch a polished training progress.

**Prerequisites:** T44, T49.

**Steps:**
1. `TrainingLab.tsx`: add a **train-fraction slider** (5–100%, default 70%); pass to `postTrain`.
2. Upgrade the training progress to a **"cool"** treatment: animated gradient/segmented bar + live
   step/accuracy + simple ETA, keeping `realtime-ui` rAF batching and `prefers-reduced-motion`.
3. Show the chosen fraction in the running/final summary; on done refresh the catalog (`fetchModels`).

**Skills/Agent:** `dashboard-designer`; `realtime-ui`, `design-taste`.

**Acceptance criteria:**
- Fraction slider value reaches the trainer (verify final event/metadata `train_fraction`).
- Progress is smooth, informative, and on-brand; build passes.

**Status:** ☑ done — Fraction slider (5–100%, default 70%) with hint copy; segmented animated progress bar (scaleX, rAF, prefers-reduced-motion); ETA; train_fraction shown in final summary; onModelsTrained callback refreshes catalog.
