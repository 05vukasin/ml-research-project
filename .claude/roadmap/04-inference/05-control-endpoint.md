# T15 — Control endpoint

**Goal:** Let the dashboard change speed/pause/dataset/model live.

**Prerequisites:** T14.

**Steps:**
1. `POST /control` accepts `{interval_ms?, paused?, dataset?, model?}`.
2. Apply `dataset`/`model` locally (switch `active_*`) and publish the command to Redis `control`.
3. Validate inputs (known dataset/model, sane interval bounds).

**Skills/Agent:** `inference-engineer`; `security-best-practices`.

**Acceptance criteria:**
- Posting a dataset/model switch updates active selection and publishes to `control`.
- Invalid dataset/model/interval is rejected with a clear error.

**Status:** ☑ done — POST /control validates dataset/model/interval, switches active_* locally, publishes to Redis control channel; verified switch from fraud to iot/rotormind-v1 reflected in /registry.
