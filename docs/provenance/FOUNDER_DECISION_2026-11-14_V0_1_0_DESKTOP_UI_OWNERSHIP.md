# Founder decision: first release v0.1.0, with Desktop and UI owned by the founder

Date: 2026-11-14

The founder has explicitly changed Ninerr's **first release target** from `v1.0.0` to **`v0.1.0`**. Earlier roadmaps, evidence records, and directives mentioning `v1.0.0` describe a former target. Do not rewrite their historical evidence. This decision supersedes that version target, **not** the existing security, provenance, privacy, accessibility, and release-verification gates.

## Ownership and parallel work

**Founder-owned and reserved (do not autonomously implement or alter):**
- The desktop application's user-facing design and interaction experience, visual design, layout, styling, editor canvas, component presentation, and other UI/UX implementation.
- User-facing desktop changes, including onboarding, installation experience, human acceptance criteria, and release visual decisions.
- Acceptance of the user-visible desktop/UI result; a real screen-reader review; clean-machine acceptance; adoption of legal commitments; final release and publication authorization.

**Engineering may continue independently, at zero cost and without changing founder-owned surfaces:**
- Core document/agent/model/assurance logic and correctness; MCP/CLI/API; secure integration boundaries and defensive tests.
- Automated CI, release evidence, checksums, build provenance, license and dependency audits, SBOM, threat modeling, non-UI performance and offline/egress checks.
- Documentation, recovery and migration logic, test harnesses and independent verification within the existing trust model.
- Reproducible candidate packaging and CI qualification against an exact commit, with no release tag or publication.

Where a critical security or cross-platform bug requires changing founder-owned Desktop/UI code, open a clearly scoped proposal or PR for the founder to review. Do not quietly take over their UI/desktop work or weaken an acceptance criterion to make a gate green. Do not block independent non-UI engineering while the founder works on the interface.

## Version semantics

- Public first release tag: `v0.1.0`; package/product version: `0.1.0`.
- The root private product package carries `0.1.0` in `package.json` and the npm lockfile. The private internal workspaces currently at `0.0.0` are internal implementation packages, **not separately published product versions**; they need not be independently bumped merely to align the first public release.
- `v0.1.0` is an initial pre-1.0 release, not a claim of complete parity or permanent API stability.
- Every artifact must identify the exact tested source commit. An older candidate's successful CI does not qualify a newer commit merely because it changes documentation or version metadata.
- No tag, draft release, npm publication, or public release is authorized by this decision alone.

## Release acceptance and blockers

The existing P10 checks remain valuable for v0.1.0: full multi-OS CI; offline smoke; packaged journeys and resilience; deterministic checksums and provenance; successful whole-process egress; verified license/corresponding-source route; and security/operational checks. Record evidence and exact tested heads.

Remaining founder-owned release gates include desktop/UI acceptance, a clean-machine install, a real screen-reader pass, the legally appropriate corresponding-source distribution commitment and its contact details, and the final approval of a specific v0.1.0 candidate/tag. Engineering may prepare these protocols and artifacts but may not claim the human tests occurred or make legal commitments on the founder's behalf.

Proceed with all technically actionable non-UI tasks; keep a concise evidence-backed ledger; do not use a repeated goal/stop hook as a substitute for actual work or for a reason to misreport completion.
