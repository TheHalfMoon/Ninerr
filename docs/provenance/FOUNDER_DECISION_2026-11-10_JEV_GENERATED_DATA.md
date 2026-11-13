# Founder decision: Jev and generated component records (2026-11-10)

**Decision.** The founder chose the narrow workflow change: the Jev exact-head workflow gives Jev a checked summary of each generated component-records file instead of its text.

**Why.**
- PR #415 adds `packages/component-sources/src/astryx-records.mjs`, about 1.1 MB of records generated from Meta Astryx at a pinned commit.
- Jev's model reads about 32,000 tokens. That diff is about 300,000, so Jev answered `max_tokens_exceeded` and could judge nothing.
- The rest of that PR is about 97 KB, the size of earlier PRs Jev qualified.

**What changes** (`.github/workflows/jev-exact-head.yml`). A step before the candidate is built checks every `packages/component-sources/src/*-records.mjs` at the exact head.
- The file must be data and nothing else: comment lines, then `export default <JSON>;`.
- It must have a components list.
- Its sha256 must be the one `docs/provenance/LICENSE_REGISTER.json` pins.

Any file that fails a check fails the job. A file that passes is left out of the diff Jev reads. Jev reads a `GENERATED_DATA` section instead, with each file's path, size, sha256, source, repository, commit, generator and component count.

The generator, the register entry and the tests that check the records stay in the diff Jev reads. `tests/jev-workflow.test.mjs` runs the workflow's own check.

**What does not change.**
- Every other file reaches Jev as before.
- The runner and its key still come from the base commit.
- The other required checks are unchanged.
