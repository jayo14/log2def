# Agent Standing Rules for Log2Def

These standing rules apply to every future session on this repository:

1. **docs/MVP_SCOPE.md is the source of truth.** If a task conflicts with it, stop and ask.
2. **The logbook is the authoritative source.** Never write code or prompts that let AI invent activities, tools, projects, skills or achievements. Every AI-generated statement must be traceable to a logbook record, or be clearly marked as inferred, or be flagged as missing.
3. **Out-of-scope features must be disabled in the backend (endpoints return 404/403), not only hidden in the UI.**
4. **Report templates are versioned.** A generated report is pinned to the template version it was generated with.
5. **Memory-safety on mobile is a hard requirement:** bounded concurrency, no loading all images into memory, release object URLs.
6. **Do not refactor unrelated code.** Preserve working functionality.
7. **Every change ships with tests, or an explicit note on why it can't be tested.**
8. **Finish each task by listing files changed, tests run with results, and known gaps.**
