# T22 — Accuracy gauge (HERO)

**Goal:** Build the central, spring-animated running-accuracy gauge — the focal point.

**Prerequisites:** T21.

**Steps:**
1. Radial gauge (Recharts `RadialBarChart` or custom SVG arc) bound to `running_accuracy`.
2. Animate value with a Motion spring (`stiffness ~120, damping ~20`); count-up percentage label with
   `tabular-nums`. Fill uses the active dataset accent.
3. Largest, centered element; subtle track; respect `prefers-reduced-motion`.

**Skills/Agent:** `dashboard-designer`; `design-taste`, `realtime-ui`, `vercel-react-view-transitions`.

**Acceptance criteria:**
- Gauge is the unmistakable hero; value animates smoothly (never snaps).
- Label uses tabular figures; reduced-motion sets value instantly.

**Status:** ☑ done — Custom SVG radial arc gauge in AccuracyGauge.tsx; framer-motion spring (stiffness 120, damping 20) via useMotionValueEvent; dataset accent fill from registry; prefers-reduced-motion instant snap; tabular-nums count label.
