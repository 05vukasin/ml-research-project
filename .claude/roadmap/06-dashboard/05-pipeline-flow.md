# T24 — Pipeline flow (React Flow)

**Goal:** Schematic animated pipeline: Stream → Model → DB.

**Prerequisites:** T21.

**Steps:**
1. `@xyflow/react` with three static nodes and animated edges.
2. Scale edge intensity/speed with current throughput; optional in-flight counter on the Model node.
3. Keep it calm and ambient — secondary to the gauge.

**Skills/Agent:** `dashboard-designer`; `realtime-ui`.

**Acceptance criteria:**
- Flow renders, edges animate, and react to throughput.
- Visually subordinate to the hero gauge.

**Status:** ☑ done — PipelineFlow.tsx: @xyflow/react, 3 static nodes Stream→Model→Postgres, animated edges when throughput>0, edge color+width scales with throughput, in-flight counter badge on Model node.
