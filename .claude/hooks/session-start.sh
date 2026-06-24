#!/usr/bin/env bash
# SessionStart hook: inject current roadmap task + key standards into context.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INDEX="$ROOT/.claude/roadmap/00-INDEX.md"

echo "=== MLOps project — session context ==="
echo "Workflow: roadmap-driven, ONE numbered task at a time (.claude/roadmap/00-INDEX.md)."
echo "Rule: model is NEVER trained at runtime; inference only .predict()."
echo "Use the mandated skills (see .claude/CLAUDE.md §5). For UI: design-taste + realtime-ui + shadcn."
if [ -f "$INDEX" ]; then
  echo "--- CURRENT TASK (from roadmap INDEX) ---"
  grep -i "CURRENT TASK" "$INDEX" 2>/dev/null || echo "(no CURRENT TASK marker yet — pick lowest ☐)"
fi
echo "Run /next-task to start the current task, /service-status for an overview."
exit 0
