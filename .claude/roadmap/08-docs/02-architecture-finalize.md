# T34 — Finalize architecture docs

**Goal:** Ensure `.claude/architecture/` matches the final implementation.

**Prerequisites:** T33.

**Steps:**
1. Re-read `00`–`05` architecture docs against the built code; fix any drift (endpoints, schema,
   payloads, env vars).
2. Add any new ADR entries for decisions made during implementation.

**Skills/Agent:** `docs-writer`.

**Acceptance criteria:**
- Architecture docs accurately describe the shipped system.
- Decisions taken during the build are recorded in `04-decisions.md`.

**Status:** ☑ done
