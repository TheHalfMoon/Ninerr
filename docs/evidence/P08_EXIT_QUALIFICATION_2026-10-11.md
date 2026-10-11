# P08 exit qualification

Issue: #230 (P08 umbrella). Date: 2026-10-11.

**Status: every engineering exit criterion is met, with its evidence below. One criterion, "stress budgets accepted", is the founder's. Until the founder decides it, P08 is not closed and P09 does not start.** v1.0.0 is not authorized.

## The exit criteria (founder, #230)

| Criterion | State | Evidence |
|---|---|---|
| No known critical correctness defect | met | No open issue is a critical correctness defect. The open correctness issues are minor and none loses data: #294 (style shorthand order), #291 (write-back conflict follow-ups), #235 (HTML and code imports keep text in different places). #172 (live and reloaded drawing differed) is fixed by #293. |
| No unresolved data-loss risk | met | The data-loss findings of P08 are fixed and their issues closed: #239 (a journal cut between whole lines, fixed by #243), #258 (a journal that reached its cap and refused edits, #262), #260 (an edit landing in another project, #263) and #261 (two hosts on one projects folder losing records, #264). Storage growth (#244) is fixed by #290. |
| #185 resolved with evidence | met | Done in N0 (#198). |
| End-to-end journeys green | met | P08-G1 (`docs/evidence/P08_G1_JOURNEYS_2026-10-09.md`), `tests/journeys.test.mjs` in CI on Linux, macOS and Windows, and the seven-project dogfooding (journeys A–F, `docs/evidence/P08_G11_DOGFOODING_2026-10-11.md`). |
| Cross-platform evidence green | met, with recorded deviations | P08-G7 (`docs/evidence/P08_G7_CROSS_PLATFORM_2026-10-10.md`). Every PR's exact-head CI runs the suite on ubuntu-latest, macos-latest and windows-latest. Windows skips 6 tests, each with its reason stated where it runs (P08-G7). Gate-13 timing budgets fail now and then on shared runners (#275). |
| Migration corpus green | met | P08-G10 (`docs/evidence/P08_G10_MIGRATION_CORPUS_2026-10-10.md`), `tests/migration-corpus.test.mjs`. #290 regenerated the 14 cases derived from the current-format golden by their generator: only the orphaned creation-time object left them. The legacy and historical cases are byte-identical. |
| Stress budgets accepted | **founder decision** | P08-G4 proposed budgets (`docs/evidence/P08_G4_SCALE_2026-10-10.md`), not yet accepted. Gate 13's existing budgets are unchanged; #275 asks where they are judged, and its comment proposes a reference-hardware protocol. See below. |
| Security qualification green | met | P08-G9 (`docs/evidence/P08_G9_SECURITY_2026-10-10.md`). Journey F of the dogfooding held on every project. The open security items are scoped deviations, below. |
| Real dogfooding completed | met | Seven public projects, all journeys that apply passing, every run complete (`docs/evidence/P08_G11_DOGFOODING_2026-10-11.md`). |
| Major functional workflow gaps fixed | met | Codebase import of real components (#282: #284, #285, #287), conflict values (#236: #289), history after a reopen (#231: #288), selection after an insert (#274: #286). What stays is UX for P09, below. |

## The founder's decision
**1. Accept, change or reject the P08-G4 budget proposals.** Two points the proposals table no longer reflects:
- "Disk: the object store bounded by a few snapshots of the document" read "no: #244" in G4. Since #290, the object store holds one snapshot document plus the journal's archived segments. Those segments are the project's history, about 1 MiB each, and are kept on purpose.
- "Edit at 10,000 layers: p95 ≤ 300 ms now; ≤ 100 ms after #252." #252 stays open, which still holds:
  - The dogfooded documents held 24 to 1,857 layers.
  - At the largest, a repeated text edit in the editor took p50 288 ms and p95 382 ms. On the others, its p50 was 81–126 ms.
  - #252's full fix (copy-on-write nodes, incremental validation) is a performance grain the founder may place before or after P09.

**2. Where gate 13's budgets are judged (#275).** The options are:
- shared CI runners, as now, with each failure re-run and disclosed;
- stated reference hardware, by the protocol proposed in #275;
- the runner's own measured speed.

The budgets are unchanged. On 2026-10-11, three exact-head runs failed gate 13 on shared runners: two on windows-latest, at 1,297 ms and 1,060 ms against 750, and one on macos-latest, a delete at 803 ms against 750. Each passed when re-run, and locally the same test passes with wide margins.

## Open issues, classified
| Issue | Class | Disposition |
|---|---|---|
| #252 edit cost grows with the document | performance | founder places it (above). Halved by #273. |
| #275 gate 13 on shared runners | gate decision | founder (above) |
| #283 an HTML import's linked stylesheets | fidelity, designed enhancement | P09/P10. The design model has no stylesheets; scoped frame stylesheets are the designed route. Not a P08 blocker. |
| #235 text kept in different places by HTML and code imports | coherence | P09 |
| #291 write-back conflict follow-ups | minor UX and correctness | P09/P10 |
| #294 style shorthand and longhand order | design-model decision | P09/P10 |
| #268 Windows: host files trusted without an owner check | security, scoped | only when `NINERR_PROJECTS` is a shared or world-writable folder. The default, inside the user's profile, is protected by its inherited access lists. A recorded platform deviation. |
| #266 browser scans not policy-enforced on Windows | security, scoped | recorded platform deviation (P08-G7) |
| #270 evidence-store edge cases | hardening | recorded |
| #176 intermittent desktop-shell CI failure | flake, tracking | cause unknown, not reproduced locally |
| #139 release umbrella | release | the founder release gate, after P10 |
| #135, #132, #108, #94, #89, #79, #78, #64 | earlier-phase follow-ups | non-blocking, as recorded in their issues |

**UX for P09, from the dogfooding:**
- An agent's change is undone with Revert in the history, not with the editor's Undo, and a person may not look there.
- The editor has no control to reorder, group or move a layer to another parent.

## What P09 needs
The master plan sets the order P08 → P09 (Ninerr UI and UX) → P10 (release candidate hardening) → the founder release gate. P08 closes when the founder decides the budgets above. P09 is not started before that: the founder's directive says not to assume P09 is authorized because G11 is finished.
