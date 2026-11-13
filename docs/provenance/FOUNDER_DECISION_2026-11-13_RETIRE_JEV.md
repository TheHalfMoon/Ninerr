# Founder decision: Jev is retired (2026-11-13)

**Decision.** The founder directed that Jev no longer be invoked for code reviews or engineering decisions, and that it stop being a mandatory gate in development and CI. Its useful checks are replaced by local deterministic validation and the existing independent review tools. The generated-data verification and pinned-SHA-256 check from #416 are kept. Release gates are not weakened.

**What changes.**
- `.github/workflows/jev-exact-head.yml` is removed, so no pull request calls the Jev API.
- The generated-records check from #416 moves to `scripts/check-generated-records.mjs`. `npm run check`, and so CI's Foundation checks on Linux, macOS and Windows, runs it on every pull request and on main. It now checks the whole repository rather than only a pull request's diff. Each `packages/component-sources/src/*-records.mjs` must be data only (comment lines, then `export default <JSON>;`), have a components list, and have the sha256 the license register pins. `tests/generated-records.test.mjs` tests it.
- `CLAUDE.md`, `AGENTS.md` and `CONTRIBUTING.md` no longer require Jev. The change workflow asks for an independent review of the exact candidate (a fresh-context reviewer over the diff) and mutation tests for the rules a change adds, beside the mechanical gate, Open Code Review and CI.

**What stays.**
- The license register's pin on each vendored file (`tests/license-register.test.mjs`).
- Open Code Review evidence on every pull request.
- The Foundation and Desktop checks on three platforms.
- The release workflow's gates.
- `.claude/skills/jev` stays vendored under its own license; nothing in the workflow runs it. The optional, unconfigured Jev adapter in `@ninerr/decision-router` is a user-configured integration, not a gate.
- Past evidence that cites Jev stays as recorded.

**Secret.** The repository Actions secret `TYPESAFE_API_KEY` is no longer read by any workflow. Removing it is the owner's choice.
