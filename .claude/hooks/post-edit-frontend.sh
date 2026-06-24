#!/usr/bin/env bash
# PostToolUse (Edit|Write) hook: if a frontend file was changed, remind about design skills.
set -euo pipefail
PAYLOAD="$(cat 2>/dev/null || true)"
if echo "$PAYLOAD" | grep -Eq '"file_path"[^,]*(dashboard/|\.tsx|\.jsx|\.css)'; then
  echo "[design] Frontend file changed. Apply the design-taste checklist + realtime-ui patterns."
  echo "[design] Before marking the task done, run /design-review (web-design-guidelines + react-doctor)."
  echo "[design] Verify: hero gauge focal, on-scale spacing, tabular-nums, purposeful <500ms motion, AA contrast, prefers-reduced-motion."
fi
exit 0
