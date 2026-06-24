# T29 — Design polish & review

**Goal:** Bring the whole dashboard to the premium bar and pass review.

**Prerequisites:** T22–T28.

**Steps:**
1. Apply the `design-taste` pre-ship checklist across every component.
2. Run `/design-review` (`web-design-guidelines` + `react-doctor`); fix all critical/should-fix items.
3. Run `web-perf` on the live page; ensure 60fps under load (batching), animate transform/opacity only.
4. Verify responsiveness (md/lg), keyboard focus, and `prefers-reduced-motion`.

**Skills/Agent:** `dashboard-designer`; `design-taste`, `web-design-guidelines`, `react-doctor`, `web-perf`.

**Acceptance criteria:**
- `/design-review` reports no critical issues; checklist fully satisfied.
- Smooth at 60fps; accessible; hero gauge remains the focal point.

**Status:** ☑ done — design-review run (web-design-guidelines + react-doctor): 0 critical; should-fix items applied (compositor scaleX progress bars, focus-visible rings, role=status on pause warning). `tsc` + `next build` pass clean.
