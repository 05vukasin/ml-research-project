---
name: design-taste
description: Enforce premium, clean, restrained visual taste for this MLOps dashboard — spacing scale, motion principles, color/contrast, typography, and a pre-ship checklist. Use whenever building or reviewing any dashboard UI (dashboard/**, *.tsx, *.css), choosing layout/colors/animation, or polishing visuals.
---

# Design Taste — MLOps Dashboard

The dashboard must feel like a premium, modern operations console: calm, legible, and alive with
purposeful motion. Taste = restraint + consistency + intentional motion. This skill is the bar.

## Non-negotiables

1. **One hero.** The accuracy gauge is the single focal point. Everything else is supporting. Don't
   let charts/widgets compete with it for size or saturation.
2. **Restraint.** Light, clean, lots of whitespace. Color is information, not decoration. At most one
   accent per dataset (from `registry.json` theme) plus neutrals. No gradients-on-gradients, no glow soup.
3. **Consistency.** Use the spacing/radius/shadow scale below everywhere. Use shadcn primitives — do
   not hand-roll buttons/dialogs/cards.

## Spacing & layout scale (Tailwind)

- Spacing: stick to `2, 3, 4, 6, 8, 12, 16, 24` (`gap-4`, `p-6`, etc.). No arbitrary one-offs.
- Radius: `rounded-xl` for cards, `rounded-lg` for controls, `rounded-full` for gauge/badges.
- Shadow: `shadow-sm` resting, `shadow-md` on hover for interactive cards. Avoid heavy shadows.
- Grid: responsive `grid` with a clear hierarchy — hero gauge spans more columns than KPI cards.
- Density: generous padding (`p-6`), `text-sm`/`text-base` body, numbers can go `text-2xl`+ and tabular.

## Color & contrast

- Base: white / `slate-50` surfaces, `slate-200` borders, `slate-700/900` text.
- Accent per dataset from registry theme (fraud → red, etc.) — used for the positive class, the gauge
  fill, and key highlights only.
- Positive/negative semantics: positive class = accent (alert), normal = muted neutral/green.
- Always meet WCAG AA contrast. Never encode meaning by color alone — pair with icon/label.

## Typography

- One sans family (Geist/Inter via `next/font`). Weights: 400 body, 500 labels, 600/700 numbers/titles.
- Use tabular figures (`tabular-nums`) for all live-updating numbers so they don't jitter.

## Motion principles (with `realtime-ui` + vercel-react-view-transitions)

- **Purpose:** motion communicates data change (a row arriving, the gauge rising), never decoration.
- **Duration:** micro 120–200ms; entrance 250–400ms. Nothing slower than ~500ms.
- **Easing:** `ease-out` for entrances, springs for the gauge (`stiffness ~120, damping ~20`).
- **Live feed:** `AnimatePresence` — new rows slide/fade in from top; cap list length; stagger subtly.
- **Gauge:** animate the value with a spring; never snap. Count-up numbers with the same timing.
- **Respect `prefers-reduced-motion`** — drop to instant/opacity-only.
- **Performance:** throttle/batch high-frequency SSE updates (rAF or ~10/s) so animation stays at 60fps.
  Animate `transform`/`opacity` only. See `web-perf`.

## Pre-ship checklist (run before marking any UI task done)

- [ ] Hero gauge is unmistakably the focal point.
- [ ] Spacing/radius/shadow all on-scale; no arbitrary values.
- [ ] Single accent per dataset; passes AA contrast; no color-only meaning.
- [ ] All live numbers use `tabular-nums`; no layout jitter on update.
- [ ] Animations purposeful, <500ms, springy gauge, `prefers-reduced-motion` handled.
- [ ] shadcn primitives used; responsive at md/lg; keyboard-focusable controls.
- [ ] Ran `/design-review` (`web-design-guidelines` + `react-doctor`) with no critical issues.

## Companion skills

`shadcn` (components), `web-design-guidelines` (audit), `vercel-react-view-transitions` (transitions),
`vercel-react-best-practices`, `next-best-practices`, `web-perf`, and the project `realtime-ui` skill.
