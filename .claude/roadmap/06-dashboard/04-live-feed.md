# T23 — Live transaction feed

**Goal:** Animated feed of incoming events.

**Prerequisites:** T21.

**Steps:**
1. `motion.ul` + `AnimatePresence`, rows keyed by event `id`; enter = fade + slide from top
   (250–300ms, ease-out), subtle stagger; cap rendered rows.
2. Positive class rows: accent left-border + a one-shot pulse (no looping pulse).
3. Show key fields: prediction vs actual (✓/✗), probability, latency — all `tabular-nums`.

**Skills/Agent:** `dashboard-designer`; `realtime-ui`, `design-taste`.

**Acceptance criteria:**
- Rows animate in smoothly; list stays bounded; positive rows clearly flagged (not color-only).
- No layout jitter as numbers update.

**Status:** ☑ done — LiveFeed.tsx: motion.ul + AnimatePresence, enter=fade+slide-from-top 280ms ease-out, positive-class rows have accent left-border + one-shot pulse, ✓/✗ text labels, tabular-nums probability/latency, bounded 40 rows.
