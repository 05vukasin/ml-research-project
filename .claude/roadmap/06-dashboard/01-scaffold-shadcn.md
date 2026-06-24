# T20 — Dashboard scaffold + shadcn

**Goal:** Stand up the Next.js app with the design system and base layout.

**Prerequisites:** T14 (endpoints exist to point at).

**Steps:**
1. Create a Next.js App Router app in `dashboard/` with TypeScript + Tailwind.
2. Initialize `shadcn/ui` (use the `shadcn` skill); add base components (Card, Button, Dialog, Slider,
   Badge, Tooltip). Configure `next/font` (Geist/Inter).
3. Build the page shell: header (project title + active model name slot), a responsive grid with a
   prominent hero slot for the gauge and supporting slots.
4. Add an API client lib pointing at `NEXT_PUBLIC_INFERENCE_URL` (or Next rewrites to inference).

**Skills/Agent:** `dashboard-designer`; `shadcn`, `next-best-practices`, `design-taste`.

**Acceptance criteria:**
- App builds and renders the empty shell with on-scale spacing and clean light theme.
- shadcn primitives available; layout reserves the hero slot as the focal point.

**Status:** ☑ done — Next.js 16.2.9 App Router in dashboard/, shadcn initialized (Card, Button, Badge, Tooltip, Skeleton, Slider, Dialog), Inter/JetBrains_Mono via next/font, page shell with header + responsive hero grid, lib/api.ts + lib/types.ts wired to NEXT_PUBLIC_INFERENCE_URL.
