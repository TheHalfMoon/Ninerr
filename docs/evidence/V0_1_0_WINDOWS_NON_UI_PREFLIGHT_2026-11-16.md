# Windows non-UI release preflight — 2026-11-16

This is engineering evidence on canonical `main` at `a515fdadb9ce9754b6943ec91c754677c5b18d30`, **not** the founder-approved v0.1.0 candidate, a cross-platform qualification, or human Desktop/UI acceptance.

- Clean `npm ci --ignore-scripts --no-audit --no-fund`: passed (38 packages installed; Node v24.19.0).
- `node --test tests/release-version.test.mjs tests/release-workflow.test.mjs tests/release-docs.test.mjs tests/doctor-hardening.test.mjs`: 17 passed, 0 failed. Includes malformed MCP JSON and initialize timeout refusals, version/tag/lockfile consistency, release-workflow permission boundaries and documentation references.
- `npm run smoke`: passed; six deterministic operations, zero network attempts; document SHA-256 `5a8a64868a84411d5d3620416d205963fa8f47e66749159cfebba6e805bd0785`.

The preflight does **not** satisfy the final-candidate P10 gates, three-platform checks, independent review, hardware performance, fresh-machine installation, screen-reader session, corresponding-source legal adoption, or founder release approval. No tag or release was created.
