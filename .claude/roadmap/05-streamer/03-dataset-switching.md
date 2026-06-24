# T19 — Live dataset switching

**Goal:** Switch the streamed dataset on command without restart.

**Prerequisites:** T18.

**Steps:**
1. On `control` message `{dataset}`, load that dataset's CSV and continue streaming it.
2. Reset row cursor; tag messages with the new `dataset`.
3. Guard against unknown dataset slugs.

**Skills/Agent:** `streamer-engineer`.

**Acceptance criteria:**
- Publishing `{dataset:"iot"}` switches the stream to iot rows live.
- Unknown slug is ignored with a logged warning.
- Backend smoke test: with inference + DB running locally, the full chain (stream → predict → DB row)
  works for all three datasets.

**Status:** ☑ done — live switching fraud→iot→intrusion verified; bogus slug logs WARNING and stream continues unchanged.
