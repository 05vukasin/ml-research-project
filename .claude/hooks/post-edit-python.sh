#!/usr/bin/env bash
# PostToolUse (Edit|Write) hook: if a Python file was changed, remind about backend best practices.
set -euo pipefail
PAYLOAD="$(cat 2>/dev/null || true)"
if echo "$PAYLOAD" | grep -Eq '"file_path"[^,]*\.py'; then
  echo "[backend] Python file changed. Apply mlops-architecture (boundaries/contracts) + security-best-practices."
  echo "[backend] If touching SQL/Postgres, apply the postgres skill (parameterized queries, indexes)."
  echo "[backend] Reminder: NEVER call .fit() in inference/streamer — load serialized models, .predict() only."
fi
exit 0
