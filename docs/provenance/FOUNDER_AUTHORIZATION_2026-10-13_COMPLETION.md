# Founder authorization to complete Ninerr: 2026-10-13

On 2026-10-13 the founder authorized the program through P08 closeout, P09, P10 and the release gate, and resolved the decisions P08 was waiting on. The two excerpts below, sections 1 and 3 of the message, are verbatim. The rest of the message sets the operating procedure, summarized after them.

```text
1. Mission and authority
Continue Ninerr from the exact live GitHub frontier and complete the remaining project work. Do not stop after a progress report, one successful PR, a passing test run, or the completion of one phase.
I authorize you to continue through P08 closeout, P09 UI/UX, P10 release-candidate hardening, and the final release gate. I also authorize the bounded founder decisions recorded below so that you do not need to pause for routine confirmation.
Work autonomously until the project's acceptance criteria are satisfied. Do not repeatedly ask me whether to continue. If one genuinely external dependency cannot be resolved, isolate it and continue every independent task. Never use a missing optional tool as a reason to abandon the project.
This authorization does not permit you to bypass a security check, fabricate evidence, expand product authority beyond the approved plan, or misrepresent release readiness.
```

```text
3. Founder decisions — authorized by this instruction
A. P09 and P10
P09 is explicitly authorized. Do not wait for another authorization to start it.
After P08 is correctly closed, proceed through P09 and P10 according to the canonical plan. Keep each change bounded, tested, reviewed, and traceable to its acceptance criteria.
Do not use this authorization to reopen completed phases or introduce unrelated product features.
B. Issue #275 — performance-budget judging protocol
I ratify the reference-hardware protocol proposed in the discussion on [issue #275](https://github.com/TheHalfMoon/Ninerr/issues/275).
Keep the existing performance budgets unchanged. Judge absolute performance budgets on the stated reference machine rather than allowing transient shared-runner load to determine pass/fail.
Use the proposed reference configuration:

* Windows 11
* Intel Core i5-13420H, 12 logical cores
* 16 GiB RAM
* Node 24
* Microsoft Edge
* Plugged in, best-performance mode, with competing builds and browser tests stopped

Run `node --test tests/editor-performance.test.mjs` five times on the exact candidate commit from a clean checkout. A budget passes only when it holds in at least four of the five runs and the median of the five runs' p95 measurements is within the unchanged budget. Record all five runs automatically, including p50, p95, maximum, sample counts, machine details, Node version, browser version, and exact commit.
CI must continue to collect performance measurements on every PR. Shared-runner absolute timing is informational, not the release's absolute-budget judge. Investigate a regression greater than 50% against the last recorded baseline for the same runner OS. Do not silently discard failed measurements, repeatedly rerun until green without disclosure, or calibrate budgets to runner speed.
Accept the measured P08-G4 budget framework in `docs/evidence/P08_G4_SCALE_2026-10-10.md`, incorporating later merged fixes and current measurements. Preserve the documented size and recovery limits; do not lower thresholds merely to pass.
Important clarifications:

* Keep the 1,000-layer edit/undo/redo p95 target at 100 ms.
* Keep the 10,000-layer edit/undo/redo release target at 300 ms p95. Preserve the stated 100 ms improvement goal where the canonical plan still requires it, and do not claim that goal has passed unless the corresponding measurement proves it.
* Retain the 400 ms p95 target for agent edits at 10,000 layers, the documented reopen/close/recovery budgets, bounded HTML import and code write-back budgets, the 500 MiB indicative memory-growth limit at 50,000 layers, and the supported-size limits.
* Apply the corrected post-#290 disk model: the object store is one snapshot document plus intentionally retained archived history segments, not a few snapshots with no history growth.
* Distinguish editor readiness from launching a fresh browser. Do not attribute a new Edge launch's latency to Ninerr's editor-ready time.

For every proposed G4 criterion, compare the exact current evidence with the accepted threshold. Fix unmet criteria or document an honest, narrowly scoped supported limit; never mark a budget passed using unrelated measurements.
Record this decision in the appropriate issue and canonical evidence, and close #275 only after the decision and its testable protocol are correctly documented.
C. Issue #268 — Windows ownership and access-list security
I authorize the native-add-on approach if needed to verify Windows file ownership and ACLs while preserving Ninerr's existing no-child-process invariant.
Do not introduce `child_process` calls to `icacls.exe` or `whoami.exe` merely to bypass that invariant. Do not ship a warning-only fix for a credential-routing vulnerability.
Implement the smallest maintainable, auditable Windows-specific native boundary needed to inspect the owner and effective access-control permissions of trusted project files and folders. Keep platform-specific behavior isolated, dependencies pinned, and release provenance and licensing accounted for.
The qualification must cover at least:

* File owner and effective ACL checks, including inherited permissions.
* Relay discovery and agent-registry files.
* Long paths, reparse points, and unsupported or untrustworthy filesystems.
* Shared or world-writable locations.
* ACL changes and time-of-check/time-of-use risks.
* A hostile project folder attempting to redirect the relay and capture an agent credential.
* Clean packaged Windows behavior and explicit cross-platform fallbacks.

Fail closed before trusting sensitive relay-discovery data whenever ownership and permissions cannot be proven. A modal warning is not a substitute for enforcing the security boundary.
If the proposed native boundary proves incompatible with the project's security model, do not silently relax the no-process rule. Deliver the strongest fail-closed implementation consistent with the invariant and document any remaining, specific limitation. Do not report #268 as fixed unless the tests demonstrate the claimed protection.
D. Zero-cost release posture
Preserve Ninerr's local-first and zero-mandatory-paid-infrastructure principles.
Do not purchase signing certificates, require a paid inference service, or claim that an artifact is publisher-signed or notarized when it is not.
For the final release path, use checksums, the existing GitHub/Sigstore provenance workflow, accurate per-artifact manifests, and clear documentation of any publisher-signing limitation. Use the corresponding-source route that includes the required Electron/LGPL source alongside the release artifacts, with notices and provenance.
I authorize a clearly disclosed unsigned-package release posture rather than blocking the project on paid publisher certificates, provided the repository's actual security, licensing, packaging, and release qualification gates pass. Do not weaken any non-signing security gate to accommodate this decision.
```

## The rest of the message, summarized
- **Live state first.** Verify `main`, PRs, issues and workflow runs before work; the baseline it names is `main` `1987c771882fd93cdb682c4b3cb301dbf7cf9bd1` after PR #340, with the seven-project dogfood rerun passing on it. Refresh `docs/CURRENT.md` from verified evidence.
- **Tooling.** Use the project's pstack skills (`ps-doctor`, `ps-review`, `ps-dormammu`) against the canonical plan without replacing its documents; Jev exact-head qualification through the repository workflow; Alibaba Open Code Review through `.github/workflows/open-code-review-delegate.yml` (not CodeRabbit, Qodo, Cubic or paid services); Graft for navigation with telemetry off and without `--deep`; and the repository's own scripts and workflows for mechanical and end-to-end qualification.
- **Priorities.** P08 closure (#275, the G4 budget record, #268, #300 and #329); history and scale (#329, #252, #108); import and code fidelity (#94, #235); P09 UI and UX from the dogfooding feedback (undo and revert of an agent's change, layer reorder, group and reparent controls, class editing in the inspector); CSS and design-model decisions (#294, #64, #310); parity (#78, #79); P10 release qualification.
- **Merging.** Normal merge commits for PRs that pass every required exact-head check and review gate, without a separate approval for each; never squash, rebase, force-push or rewrite history; issues close only on their acceptance evidence and post-merge results.
- **Completion.** Ninerr is complete when N0 stays closed, P08 has an evidence-backed closeout, P09's criteria are exercised through the product, P10's release gates pass, the parity items are proven or dispositioned, no critical issue remains, the canonical documents match live state, and the release artifacts are bound to their exact commit with checksums, notices, corresponding source and accurate signing and provenance declarations. Then the release gate is completed and the release published under the authorized posture; `v1.0.0` is created only after the exact candidate passes its required checks.
