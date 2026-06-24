# T47 — Nav refactor (delete header, slim TopNav, Monitoring tab)

**Goal:** Remove the big header; one slim bar with tab links + settings on the right.

**Prerequisites:** T20 (dashboard scaffold).

**Steps:**
1. Delete `components/dashboard/DashboardHeader.tsx` and its usage.
2. Build a slim **TopNav**: left = tab links `Dashboard · Training Lab · Monitoring` (keep the Motion
   `layoutId="tab-underline"` from `DashboardClient.tsx:33` TABS); right corner = `ConnectionPill` +
   the **settings gear** (move the `SettingsPopup` trigger here).
3. Add the `Monitoring` tab id + an empty panel shell (filled in T53).
4. Relocate the active-model name into a small badge within the Dashboard tab content.

**Skills/Agent:** `dashboard-designer`; `design-taste`, `shadcn`.

**Acceptance criteria:**
- No separate header; a single bar shows the three tabs (left) and settings+pill (right corner).
- Switching tabs keeps the SSE connection alive; `next build` passes.

**Status:** ☑ done — DashboardHeader deleted; new TopNav.tsx (tab links left, ConnectionPill+SettingsPopup right); Monitoring tab shell added; SSE stays connected across tabs; skip-link + reduced-motion guard applied.
