# T48 — Live feed fixed size + play/pause

**Goal:** Stop the feed from resizing as rows arrive; add a stream play/pause on the feed.

**Prerequisites:** T23 (live feed), T15 (control).

**Steps:**
1. `LiveFeed.tsx`: give the container a **fixed height** (e.g. `h-[420px]`, remove `min-h` growth); rows
   scroll/pop within without changing the card size.
2. Add a **play/pause** button by the CardTitle wired to `postControl({paused})`. Reflect the shared
   `paused` state (from `/health` poll or DashboardContext) so it stays in sync with the settings pause.
3. Keep AnimatePresence enter/exit; ensure no layout shift.

**Skills/Agent:** `dashboard-designer`; `realtime-ui`, `design-taste`.

**Acceptance criteria:**
- Feed height is constant regardless of row count.
- The button pauses/resumes the whole stream and matches the settings pause state.

**Status:** ☑ done — LiveFeed fixed at h-[420px] (no resize); play/pause button wired to shared paused state in DashboardContext (single source of truth with SettingsPopup) → postControl({paused}).
