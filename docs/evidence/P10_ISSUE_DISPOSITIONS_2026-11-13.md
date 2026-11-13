# P10-6 issue dispositions, 2026-11-13

P10 criterion 6 asks that no critical correctness, data-loss, security or release-blocking issue remains open, and that every other open issue is resolved or carries a recorded disposition. This record gives each issue open on 2026-11-13 its state, as checked against the code and tests on `main` that day, and its disposition. It is the input to P10-6, not its pass: P10-6 is judged on the exact candidate.

**No open issue is critical.** None is a correctness, data-loss or security failure in shipped behaviour, and none blocks a release on its own. The nearest was #349, a hardening of an already fail-closed write; the founder decided it, and it is fixed (#456).

## Resolved by pull requests in review

| Issue | State | Disposition |
| --- | --- | --- |
| #94 Import-stack hardening follow-ups | Four of its five items were already in place, with tests: `fetchPinnedHttp` is off the public surface, inherited request fields are refused, refusal tests carry matchers, and the test helper was rewritten. The fifth, resolved addresses named in failure reasons, is fixed in #449. | Closes with #449. |
| #351 Soak test: one slow window fails the drift check | Fixed in #448: the check reads the smaller of the last two windows, tested on #351's own numbers. | Closes with #448. |
| #349 Windows trusted write: rename through the handle | The founder chose option (a) on 2026-11-13: the replacement is renamed over the target through the handle that wrote it, before it closes. | Closed with #456. |

## Waiting for the founder

| Issue | State | Disposition |
| --- | --- | --- |
| #405 Integrate the UI ecosystems as editable components | The Astryx source is complete on main (#415, #420, #429, #435). Registry fetching needs host network access, live previews need a React preview runner, and Aceternity UI and 21st.dev need their publishers' permission. | Open: each remaining part is a founder decision or a third party's. |
| #364 Headless local agent access | A proposal pending its review (its own text says so). The studio host already serves MCP on loopback with the desktop window open. | Post-1.0 proposal unless the founder places it in P10. |
| #366 Research UI and local MCP for reference packs | The local reference path M01 to M05 is merged; its packaged and offline gates have not been run (`docs/CURRENT.md`). | Founder places it: before the candidate, or after 1.0. |
| #139 P07 release: umbrella and artifact plan | Closes when every artifact is delivered or has a founder-approved disposition. The Electron LGPL corresponding-source route is the open artifact (completion ledger, blocker 1). | Open until the founder chooses the corresponding-source route. |

## Recorded limits (supported, measured, documented)

| Issue | State | Disposition |
| --- | --- | --- |
| #252 Edit cost grows with the document; #108 Sub-linear edits | One edit costs time proportional to the document (about 217 ms at 10,000 layers; halved by #273). The full fix is the structural-sharing design #108 describes. `docs/evidence/P08_EXIT_QUALIFICATION_2026-10-11.md` records it as the founder's placement. Schema v2's scale workloads are now guarded (#426). | Supported limit for 1.0 unless the founder places the design grain before the candidate. |
| #310 Drawn ids: follow-ups | Id rules are drawn as attribute selectors so the frame never gets named access; at a thousand id rules on a 10,000-node page first layout is slower than with real ids. Real pages have a few dozen. | Supported limit; reopen if a dogfooded page shows it. |
| #266 Policy-enforced browser scans unavailable on Windows | Fails closed: no scan runs without the policy. Recorded as a P08-G7 platform deviation. | Supported platform limit. |

## Waiting for evidence that only a run can give

| Issue | State | Disposition |
| --- | --- | --- |
| #377 Intermittent 409 from POST /api/selection in dogfooding | The driver records every failed answer with its body and counts each selection refusal itself (`scripts/dogfood/run.mjs`). The editor already catches the refusal. | Answered by the next dogfooding run (P10-1). |
| #376 Keyboard multi-select discovery, and criterion 4 | The hint and `aria-keyshortcuts` name Shift+Enter; focus after Classes and Group, the Text field at 320 px and focus rings at 320 px have tests (`tests/editor-accessibility.test.mjs`). Announcements with a real screen reader are not checked. | Manual check by a person with NVDA, JAWS or VoiceOver, before the candidate. |
| #300 Editor browser tests that reload time out now and then | Requests and editor evaluations now fail within a minute, naming the step (#440); no named occurrence yet. | Tracking: the next occurrence names its cause. |
| #176 Desktop shell test: intermittent failure creating a project | Tracking only; its cause is unknown. | Tracking. |

## Open design decisions, not release-blocking

| Issue | State | Disposition |
| --- | --- | --- |
| #383 Style values a browser rejects | Case 2 (escaped names) is fixed (#436). Case 1 (an invalid fallback wins) and the `@x { … }` item need a decision taken with #369: ask a browser, keep a property grammar, or keep every declaration. | Fidelity limit; decided with #369. |
| #373 Reference packs: decisions before a v1 pack ships | No reference pack has been released, so nothing in it is exposed yet. | Settled before any pack ships; not on the 1.0 path. |
| #64 Visual Git text and gate follow-ups | Items 1 (invisible-only names, stray variation selectors) and 3 (mixed SHA-1 and SHA-256 ids refused) are done, with tests. Item 2 (link commit versus snapshot commit) is a product decision; item 4 is a simplification; item 5 is an audit of the other packages' text rules. | Open for items 2, 4 and 5; none affects shipped behaviour. |
| #79 Token graph and drift detection; #78 Component states bound to source | Tokens are modelled (ADR-0004, schema v2); token drift detection is not built. Component states are declared and validated but not bound to source symbols. | P10-5 parity: each needs proof or a recorded disposition from the founder. |

## Umbrellas

| Issue | State | Disposition |
| --- | --- | --- |
| #230 P08: deep qualification and dogfooding | P08's closeout and exit qualification are recorded, with stated limits (`docs/CURRENT.md`, `docs/evidence/P08_EXIT_QUALIFICATION_2026-10-11.md`), and the frontier is P10; the umbrella's body still says "in progress". | Update its body to point at the exit record, or close it once the closeout's remaining conditions (#275, #300, #329) are recorded. |
