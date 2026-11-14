# Founder decision: no Electron written offer for v0.1.0 (2026-11-14)

**Decision.** On 2026-11-14 the founder confirmed that Electron's LGPL written offer (draft PR #457) is not needed for v0.1.0.

**Why.** Under the agent-first decision (`FOUNDER_DECISION_2026-11-14_AGENT_FIRST_HEADLESS.md`), v0.1.0 is the Ninerr Engine. The Release Evidence workflow publishes the engine's npm tarball, the evidence bundle and `SHA256SUMS`, and no desktop archive (#474). The engine contains no Electron runtime: `scripts/build-engine.mjs` leaves out the desktop app, and `tests/engine-package.test.mjs` checks that it does. With no Electron binary distributed, the LGPL obligation the offer would meet does not arise for this release.

**What changes.**
- #457 is closed without merging. Its branch stays, so the offer can be taken up again.
- The release gate for v0.1.0 has no written-offer item. `docs/HEADLESS.md` and the completion ledger record that.

**What does not change.** The earlier decision on the route (`FOUNDER_DECISION_2026-11-13_PENDING_BRIEF.md`, decision 6) still holds for any later release that distributes Electron binaries, such as the Desktop app if it resumes. Such a release needs the written offer, with the owner's name, contact and date, before it ships.
