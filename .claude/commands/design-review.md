---
description: Review dashboard changes against design taste + web guidelines + react-doctor
---

Run a design/quality pass on the current dashboard changes.

1. Apply the `design-taste` project skill's pre-ship checklist to the changed UI.
2. Invoke the `web-design-guidelines` skill to audit accessibility/UX of the changed components.
3. Invoke the `react-doctor` skill for React quality/architecture/bundle checks.
4. Optionally run `web-perf` if animation smoothness or load is in question.
5. Report findings grouped by severity (critical / should-fix / nice-to-have) with concrete fixes.
   Do not mark any dashboard task done while critical issues remain.
