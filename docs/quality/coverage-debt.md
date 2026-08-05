# Unit coverage debt

## COVERAGE-001: legacy server packages below 90%

- Owner: ZME maintainers
- Recorded: 2026-08-04
- Current report: `pnpm test:coverage` passes 316 tests and reports 59.80% statements overall; `server` is 70.07%, `server/usecases` is 72.93%, and `shared` is 65.12%.
- Task-owned logic: the task gate runs the complete Unit profile, then derives changed production modules from the exact release-base Git diff and untracked-file inventory. It discovered 22 Unit-owned files, including every changed usecase plus the generated ZPan client surface, required every file to cover at least 90% of its changed executable lines, and covered 687/718 lines in aggregate (95.68%). Current-task repository concurrency is proved in real D1, and browser behavior is measured separately; neither is used to inflate the unit denominator.
- Enforcement: `pnpm test:coverage:task` generates LCOV from the full Unit profile and applies a blocking per-file 90% changed-executable-line threshold to every mechanically discovered Unit-owned production module. A mechanically discovered file with no changed executable denominator fails instead of being silently omitted. CI checks out full Git history and supplies the exact PR base SHA to every verification invocation so a shallow or guessed base cannot omit files.
- Baseline direction: the first complete task report was 53.44% statements; the final full-unit report is 59.80%. CI enforces a 55% repository regression floor and the separate per-file 90% changed-line threshold. No threshold or exclusion was weakened.
- Uncovered behavior: pre-existing provider adapters, repository CRUD mechanics, HTTP route wiring, unmodified generated ZPan transport branches, worker lifecycle wiring, and older music/tagging branches.
- Architectural cause: older packages combine orchestration, persistence mapping, and external protocol handling, so isolated unit tests require a larger port extraction. Repository mechanics and HTTP wiring are already exercised through the D1 API suite but still appear in the unit denominator.
- Refactoring direction: move remaining business decisions behind usecase-owned ports, keep generated transports excluded as generated code, add focused tests per extracted unit, and raise one package at a time to 90% without moving behavior into integration-only layers.
- Removal condition: close this debt when every production package and the repository-wide Unit denominator are at least 90% statements; touched executable lines already remain subject to the blocking 90% gate.
- Risk: missed error branches in legacy provider and music workflows remain more likely than in the new identity/resource workflows. The risk is bounded for this release by the unchanged legacy behavior, the full Vitest suite, D1 request-flow tests, and critical Chromium journeys.

This record is both the legacy coverage exception and the established Markdown refactoring work item required by the project quality policy. It does not waive the 90% requirement for added or modified Unit-owned logic.
