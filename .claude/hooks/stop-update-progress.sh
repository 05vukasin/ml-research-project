#!/usr/bin/env bash
# Stop hook: remind to update roadmap status when a task is finished.
set -euo pipefail
echo "[roadmap] If you completed a task: set Status: ☑ done in its task file AND update the status table"
echo "[roadmap] + CURRENT TASK pointer in .claude/roadmap/00-INDEX.md so the next session knows where we are."
exit 0
