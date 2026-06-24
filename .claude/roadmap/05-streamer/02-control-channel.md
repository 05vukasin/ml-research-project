# T18 — Control channel (speed/pause)

**Goal:** React to live control commands for rate and pause.

**Prerequisites:** T17.

**Steps:**
1. Run a subscriber thread on Redis `control`.
2. On `{interval_ms}` update the sleep; on `{paused:true}` stop emitting (keep loop alive); resume on
   `{paused:false}`.
3. Make rate/pause changes take effect immediately (no restart).

**Skills/Agent:** `streamer-engineer`.

**Acceptance criteria:**
- Publishing `{interval_ms:100}` visibly speeds up the stream; `{paused:true}` halts it; resume works.

**Status:** ☑ done — control subscriber thread applies interval_ms (300→100 = 3.7→9.9 msg/s), pauses (0 msgs in 1.5s), and resumes (17 msgs in 1.5s) live without restart.
