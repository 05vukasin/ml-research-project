# T54 — Design review (v2 UI)

**Goal:** Bring all new v2 UI to the premium bar and pass review.

**Prerequisites:** T47–T53.

**Steps:**
1. Apply the `design-taste` checklist across TopNav, live feed, training fraction/progress, model cards,
   benchmark surface, and the Monitoring bento.
2. Run `/design-review` (`web-design-guidelines` + `react-doctor`); fix critical/should-fix items.
3. `web-perf`: keep 60fps (rAF batching, transform/opacity only) across the animated monitoring + feed.

**Skills/Agent:** `dashboard-designer`; `design-taste`, `web-design-guidelines`, `react-doctor`, `web-perf`.

**Acceptance criteria:**
- `/design-review` reports no critical issues; `next build` clean; smooth at 60fps; responsive + a11y.

**Status:** ☑ done — design-review across all v2 UI (TopNav, LiveFeed, TrainingLab, ModelCards, BenchmarkSurface, Monitoring); critical fixes applied (sparkline hydration/history, inverted packet filter); design-taste checklist green (focal gauge, tabular-nums, reduced-motion, scaleX progress, focus-visible, skip link). `tsc` + `next build` clean.
