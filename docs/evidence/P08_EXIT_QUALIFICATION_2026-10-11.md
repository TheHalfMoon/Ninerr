# P08 exit qualification

Issue: #230 (P08 umbrella). Date: 2026-10-11.

**Status: P08 is not closed.** Every engineering exit criterion is met, with the limits and deviations stated in the table. One decision is the founder's: accepting, changing or rejecting the P08-G4 stress budgets, and where gate 13's budgets are judged (#275).

P09 does not start before that decision. v1.0.0 is not authorized.

*Update 2026-10-13: the founder resolved both decisions below and authorized P09, P10 and the release gate (`docs/provenance/FOUNDER_AUTHORIZATION_2026-10-13_COMPLETION.md`). Gate 13 is judged on the reference machine by the protocol of #275, the P08-G4 budget framework is accepted, and #268 is to be resolved with a Windows-only native boundary. P08 closes with its closeout record, against current measurements. This replaces the statements below that P09 waits and that v1.0.0 is not authorized.*

*Updated after #283 was fixed (#296, #298, #301; main `6309cf9`). It had been proposed for the founder to move out of P08. That proposal is withdrawn.*

## The exit criteria (founder, #230)

| Criterion | State | Evidence |
|---|---|---|
| No known critical correctness defect | met | No open issue is a critical correctness defect. The open correctness issues are minor and none loses data: #294 (style shorthand order), #291 (write-back conflict follow-ups), #235 (HTML and code imports keep text in different places). #172 (live and reloaded drawing differed) is fixed by #293. |
| No unresolved data-loss risk | met, with stated limits | The data-loss findings of P08 are fixed and their issues closed: #239 (a journal cut between whole lines, fixed by #243), #258 (a journal that reached its cap and refused edits, #262), #260 (an edit landing in another project, #263) and #261 (two hosts on one projects folder losing records, #264). Storage growth (#244) is fixed by #290. The limits, recorded where they were decided: after a crash, or a close that cannot write, whole journal lines lost since the last checkpoint still cannot be told from changes never made (#239, `docs/MIGRATION.md`); a snapshot reference restored on its own from an earlier session no longer opens, and objects from sessions before #290 are not swept (#290). |
| #185 resolved with evidence | met | Done in N0 (#198). |
| End-to-end journeys green | met | P08-G1 (`docs/evidence/P08_G1_JOURNEYS_2026-10-09.md`); `tests/journeys.test.mjs` in CI on Linux, macOS and Windows; and the seven-project dogfooding, journeys A–F (`docs/evidence/P08_G11_DOGFOODING_2026-10-11.md`). |
| Cross-platform evidence green | met, with recorded deviations | P08-G7 (`docs/evidence/P08_G7_CROSS_PLATFORM_2026-10-10.md`). Every PR's exact-head CI runs the suite on ubuntu-latest, macos-latest and windows-latest. Windows skips 6 tests, each with its reason stated where it runs. Gate-13 timing budgets fail now and then on shared runners (#275). |
| Migration corpus green | met | P08-G10 (`docs/evidence/P08_G10_MIGRATION_CORPUS_2026-10-10.md`), `tests/migration-corpus.test.mjs`. #290 regenerated, with their generator, the 14 cases derived from the current-format golden: only the orphaned creation-time object left them. The legacy and historical cases are byte-identical. |
| Stress budgets accepted | **founder decision** | The P08-G4 budgets are proposed (`docs/evidence/P08_G4_SCALE_2026-10-10.md`) and not yet accepted. Gate 13's existing budgets are unchanged; #275 asks where they are judged, and its comment proposes a reference-hardware protocol. See below. |
| Security qualification green | met | P08-G9 (`docs/evidence/P08_G9_SECURITY_2026-10-10.md`). The dogfooding's journey F held on every project. The open security items are scoped deviations (below). |
| Real dogfooding completed | met | Seven public projects; every journey that applies passes, and every run is complete (`docs/evidence/P08_G11_DOGFOODING_2026-10-11.md`). |
| Major functional workflow gaps fixed | met | Fixed: codebase import of real components (#282, by #284, #285 and #287), conflict values (#236: #289), history after a reopen (#231: #288), selection after an insert (#274: #286), imported stylesheets (#283: #296, #298, #301). |

## The founder's decisions
**1. The P08-G4 stress budgets.** Accept, change or reject them. Two points the proposals table no longer reflects:
- **Disk.** "The object store bounded by a few snapshots of the document" read "no: #244" in G4. Since #290, the object store holds one snapshot document plus the journal's archived segments. The segments are the project's history, about 1 MiB each, and are kept on purpose.
- **Edits.** The proposal for an edit at 10,000 layers is p95 ≤ 300 ms now, and ≤ 100 ms after #252. #252 stays open.
  - The dogfooded documents held 24 to 1,857 layers.
  - At 1,857 layers, a repeated text edit in the editor took p50 268 ms and p95 330 ms (run at `6309cf9`, with its stylesheets). That p95 is above the 300 ms proposed for 10,000 layers. It is a different measure, though: the editor's whole step, including selecting the layer in the tree, where G4 measured the edit through the host's API.
  - On the other six projects, the same step's p50 was 81–126 ms.
  - #252's full fix (copy-on-write nodes, incremental validation; also #108) is a performance grain the founder may place before or after P09.

**2. Where gate 13's budgets are judged (#275).** The options:
- shared CI runners, as now, with each failure re-run and disclosed;
- stated reference hardware, by the protocol proposed in #275;
- the runner's own measured speed.

The budgets are unchanged. On 2026-10-11, these exact-head runs failed gate 13 on shared runners:

| Run | Runner | Measure | Result (budget 750 ms) | What followed |
|---|---|---|---|---|
| main 6390ee6, after #287 | windows-latest | end-to-end edit p95 | 1,297 ms | passed on re-run |
| #288 at 1218886 | windows-latest | end-to-end edit p95 | 1,060 ms | not re-run; the next head that ran CI, 41dacf1 (a code change and a merge of main), passed |
| #289 at 3b39fab | macos-latest | deleting a layer, p95 | 1,013 ms | not re-run; the next head, bf6b516 (a merge of main), passed |
| #290 at 74bd26b | macos-latest | deleting a layer, p95 | 803 ms | passed on re-run |
| #296 at 50bb2c6 | macos-latest | deleting a layer, p95 | 798 ms | not re-run; the next head, a1c18ee, passed |
| #295 at a3d705b (docs only) | macos-latest | deleting a layer, p95 | 843 ms | passed on re-run |
| main 46b58b1, after #298 | macos-latest | deleting a layer, p95 | 838 ms | passed on re-run; locally 358 and 410 ms |

Locally, the same test passes with wide margins.

## Open issues, classified
| Issue | Class | Disposition |
|---|---|---|
| #297 `#id` selectors in imported stylesheets do not apply (the canvas draws no element ids) | fidelity | P09/P10 |
| #299 frame stylesheet follow-ups (global names, file matching, export, budget) | fidelity, limits | P09/P10 |
| #302 the editor is ready before its change stream connects | race | P09/P10. The likely cause of #300. |
| #300 editor reload tests time out now and then locally | test flake, tracking | with #302 |
| #252 edit cost grows with the document; #108 the same structural-sharing design | performance | the founder places it (above). Halved by #273. |
| #275 gate 13 on shared runners | gate decision | the founder (above) |
| #235 HTML and code imports keep text in different places | coherence | P09 |
| #291 write-back conflict follow-ups | minor UX and correctness | P09/P10 |
| #294 style shorthand and longhand order | design-model decision | P09/P10 |
| #268 Windows: host files trusted without an owner check | security, scoped | only when `NINERR_PROJECTS` is a shared or world-writable folder. The default, inside the user's profile, is protected by its inherited access lists. A recorded platform deviation. |
| #266 browser scans not policy-enforced on Windows | security, scoped | recorded platform deviation (P08-G7) |
| #270 evidence-store edge cases | hardening | recorded |
| #176 intermittent desktop-shell CI failure | flake, tracking | cause unknown; not reproduced locally |
| #139 release umbrella | release | the founder release gate, after P10 |
| #78, #79 | parity gaps from P05 (component states bound to source; token drift) | not re-qualified in P08; proposed for the parity disposition the completion definition requires (`docs/MASTER_PLAN.md`) |
| #135, #132, #94, #89, #64 | earlier-phase follow-ups | non-blocking, as each issue records |

**UX for P09, from the dogfooding:**
- An agent's change is undone with Revert in the history, not with the editor's Undo, and a person may not look there.
- The editor has no control to reorder, group or move a layer to another parent.
- The inspector cannot edit an element's classes.

## What P09 needs
The master plan sets the order P08, then P09 (Ninerr UI and UX), then P10 (release candidate hardening), then the founder release gate. P08 closes on the founder's decision above. The founder's directive of 2026-10-10 (the message recorded in `docs/provenance/FOUNDER_AUTHORIZATION_2026-10-10_DOGFOODING.md`) says: "Do not assume P09 is authorized merely because G11 is finished."
