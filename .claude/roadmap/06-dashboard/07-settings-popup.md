# T26 — Settings popup (dataset/model)

**Goal:** A popup to choose the active dataset and model, applied live.

**Prerequisites:** T21, T15.

**Steps:**
1. shadcn `Dialog` reads `GET /registry`; lets the user pick dataset (fraud/iot/intrusion) and a model
   within it (shows model name + metrics).
2. Optional field to set the display name shown in the header for the active model.
3. On apply → `POST /control {dataset, model}`; reset gauge/feed state and pull fresh labels/colors.

**Skills/Agent:** `dashboard-designer`; `shadcn`, `realtime-ui`, `design-taste`.

**Acceptance criteria:**
- Switching dataset/model updates the whole UI (theme/labels/data) live, no reload.
- Active model name + metrics visible; selection persists during the session.

**Status:** ☑ done — SettingsPopup.tsx (shadcn Dialog): dataset + model pick from /registry, display-name field, Apply→switchDataset(/control), theme/labels update live; speed Slider + Pause/Resume→postControl.
