# T21 — SSE client hook

**Goal:** Consume the live stream with batching for 60fps.

**Prerequisites:** T20, T14.

**Steps:**
1. Implement `useLiveStream` (`"use client"`): single `EventSource` to `/stream`, cleanup on unmount,
   reconnect with backoff, connection-status state.
2. Buffer events in a ref; flush to state on `requestAnimationFrame`/~100ms. Keep latest aggregates +
   a bounded recent-events list.
3. Surface a connection-status pill in the header.

**Skills/Agent:** `dashboard-designer`; `realtime-ui`, `web-perf`.

**Acceptance criteria:**
- Live events arrive and update state without per-event re-render storms.
- Reconnects cleanly after an inference restart; status pill reflects state.

**Status:** ☑ done — useLiveStream hook in hooks/useLiveStream.ts: single EventSource, rAF batching, exponential backoff reconnect, connection status state; ConnectionPill wired in DashboardHeader.
