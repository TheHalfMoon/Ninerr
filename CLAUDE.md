# Claude Project Instructions

**Current founder directive (2026-11-14, agent-first):** Ninerr v0.1.0 is an agent-first, MCP-native, headless design engine (`docs/provenance/FOUNDER_DECISION_2026-11-14_AGENT_FIRST_HEADLESS.md`, plan in `docs/HEADLESS.md`). It supersedes the Desktop-first release direction of the same day. Build the headless project lifecycle, MCP and CLI; keep the Desktop and web-editor code working but freeze its UI/UX development, and do not delete or rewrite it. Keep every security, privacy, licensing and correctness gate that applies to the engine. Never approve a consequential operation silently. Do not publish an npm package, create a tag or publish a GitHub Release without the founder's explicit approval.


Ninerr repository governance and canonical evidence are authoritative. Read `AGENTS.md` and `docs/MASTER_PLAN.md` before changing product code. Do not restart completed phases or rewrite accepted architecture unless live evidence requires it.

## Cloud-ready project tooling

This repository vendors its Claude-facing tooling under `.claude/skills/`. Do not look for these tools only in a developer home directory, Windows path, npm, or PyPI.

Project-local skills:
- `.claude/skills/ps-start`
- `.claude/skills/ps-build`
- `.claude/skills/ps-review`
- `.claude/skills/ps-doctor`
- `.claude/skills/ps-close`
- `.claude/skills/ps-spec`
- `.claude/skills/ps-resume`
- `.claude/skills/ps-checkpoint`
- `.claude/skills/ps-init`
- `.claude/skills/ps-dormammu`

The existing project is already planned and implemented through the current canonical frontier. Do not run `ps-start` or use `ps-init` to replace established project documents merely because pstack was added. Use the relevant review/build/doctor/resume skills against the existing plan.

## Capabilities

- repository context: Graft when already available, with the constraints in `AGENTS.md`; otherwise normal repository tools
- pstack review/build workflow: project-local `ps-*` skills in `.claude/skills/`
- Alibaba Open Code Review evidence: `.github/workflows/open-code-review-delegate.yml`
- mechanical gate: repository `npm run check` (including `scripts/check-generated-records.mjs`) and required targeted tests
- independent review: a fresh-context reviewer (subagent) over the diff, and `ps-review`
- product plan: `docs/MASTER_PLAN.md`

Jev is no longer used for reviews, qualification or engineering decisions (founder decision 2026-11-13, `docs/provenance/FOUNDER_DECISION_2026-11-13_RETIRE_JEV.md`). Do not invoke it. Never print, echo, commit, or request `TYPESAFE_API_KEY`.

## Change workflow

For each implementation grain:

1. Verify live GitHub state and current canonical `main`; do not trust stale SHAs.
2. Read the applicable acceptance criteria in `docs/MASTER_PLAN.md` and issue/PR evidence.
3. Keep the branch scoped and reviewable.
4. Run repository mechanical tests and targeted tests.
5. Use `ps-review` for the diff. A missing optional review provider must degrade visibly according to the skill rather than silently skipping a review bar.
6. Run Alibaba Open Code Review evidence.
7. Get an independent review of the exact candidate (a fresh-context reviewer over the diff), and mutation-test the rules the change adds.
8. Repair findings and rerun affected qualification after any code-changing repair.
9. Merge only after required exact-head checks pass.
10. After merge, verify canonical `main` and post-merge CI before declaring the grain closed.

Use normal merge commits. Do not squash, rebase, force-push, or rewrite history. Never fabricate tests, review output, CI, tool execution, or release evidence.

## Current program direction

Continue from the live canonical frontier in `docs/CURRENT.md`. The current program is N0 (Ninerr independence and migration), then P08, P09, P10 and the release gate, as `docs/MASTER_PLAN.md` sets out. The founder authorized the original program through the release gate on 2026-10-13 (`docs/provenance/FOUNDER_AUTHORIZATION_2026-10-13_COMPLETION.md`). The 2026-11-14 founder decision supersedes the first-release version target with **v0.1.0**, while retaining the applicable P10, licensing, human acceptance and exact-candidate gates. The tag is created only with separate founder authorization after the candidate qualifies, and nothing is published until approval. Do not redo already closed work unless live evidence proves a regression.
