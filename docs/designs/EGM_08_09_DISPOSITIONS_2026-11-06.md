# EGM stages 08 and 09: dispositions

Date: 2026-11-06. Findings: `egm-review-20261106/08-zoom-out-findings.md` and `09-implementation-readiness-findings.md`.

Both stages ran to completion on `opencode/pulse-alpha-free` in separate fresh read-only contexts. The earlier stage 08 attempt, stopped by a free-model quota, is not counted.

| Finding | Disposition |
| --- | --- |
| 08-B1, 09-1: R01 names `tests/text-layers.test.mjs`, absent at this branch's base | Moot. The file arrived with PR #362, merged as c3b4a22. The board now records `tests/code-expressions.test.mjs` too. |
| 08-B2, 09-2, 08-M5: M01 and M02 name files absent at the base | Corrected. Both packets now say to work from the PR head, not from `main`. |
| 08-B3: the board does not separate existing tests from proposed ones | Corrected. Proposed tests are marked `(new)` on the board. |
| 08-M1, 09-3: `--verify` and `--check` | Corrected. CI runs both: `--verify` for the census, `--check` for the identity gate. The board names both. |
| 09-4: R04 leaves the offline target undecided | Corrected. R04 now states the target. |
| 09-5: W01 names no replacement semantics | Corrected. `docs/design-platform/AGENT_CONTRACT.md` v2 is the normative source. |
| 09-6: R03 names no journey files | Corrected. R03 names the P09 section and existing journey files. |
| 09-7: R02 names no test or oracle | Corrected after the fact. `tests/style-order.test.mjs` compares browser computed styles. |
| 08-M2: M05 depends on M04 | Corrected. M05 depends on M03 alone, as plan section 5 says. |
| 08-M3, 09-8: M06 in another repository | Corrected. M06 consumes the merged M01 contract at a pinned Ninerr commit, and only its inventory and ledger may start before M01 merges. |
| 08-M4: W08 depends on M06, described as inventory only | Corrected. W08 needs M06's exporter output, not only its inventory. |
| 08-N1: bare filenames in the resolution matrix | Accepted, not fixed here: the files are findable under `docs/strategy/`. |
| 08-N2: value domains in plan section 4 | Corrected. Section 4 now defers to `reference-packs.mjs` as the exact contract. |
| 09-9, 09-10 | No action: the reviewer recorded them as verified facts. The 16-tool count becomes 18 when M04 merges. |

## Packets changed by implementation

Independent review of PRs #365 and #367 changed the wire contract before it froze: required `ownerScope`, `allowed` always false until a grant register exists, `metadataPermits`, and a stricter text policy. Plan section 4 records this.
