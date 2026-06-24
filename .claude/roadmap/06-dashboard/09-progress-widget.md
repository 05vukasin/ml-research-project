# T28 — Dataset progress widget + speed control

**Goal:** Side widget for "% of dataset processed" and the stream speed/pause control.

**Prerequisites:** T21, T15.

**Steps:**
1. Progress widget (radial or linear) bound to `GET /progress` → percent of rows processed; secondary
   to the hero gauge.
2. Speed `Slider` + pause/resume button → `POST /control {interval_ms|paused}`.

**Skills/Agent:** `dashboard-designer`; `design-taste`, `realtime-ui`.

**Acceptance criteria:**
- Progress advances toward 100% as the stream runs.
- Slider changes arrival rate live; pause/resume works; widget stays visually secondary.

**Status:** ☑ done — ProgressWidget.tsx polls /progress (~2s), compositor scaleX bar, secondary to the hero gauge; speed slider/pause in settings.
