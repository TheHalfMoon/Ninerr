# Ninerr Desktop + Agent-Native Platform: Revised Engineering Design and Delivery Plan

Status: **R2 planning revision after EGM Goldfish stages 05–07. Not approved. Not implementation authority.**
Date: 2026-11-06
Owner repository: TheHalfMoon/Ninerr
Source base: `17edb22c283121c1e93bcd76d91f0fb918204ab5` (this worktree HEAD)
Companion evidence: `docs/designs/EGM_05_07_RESOLUTION_MATRIX_2026-11-06.md`

## 0. Document control

### 0.1 Status truth and non-claims

This document resolves the plan-level findings of independent Goldfish stages 05 (Zoom-Out), 06 (Comprehension) and 07 (Design Critic). It does **not** claim:

- a complete or approved five-stage EGM review; stages 08 (second Zoom-Out) and 09 (Implementation Readiness) have not run;
- that any planning statement has been implemented, tested, packaged or released;
- that P09, P10 or the v1.0.0 release gate has passed;
- that installed stdio/headless MCP, PNG/SVG/PDF export, Astro round-trip, agent redo/reapply, full GUI↔MCP parity, Skilit packs, Build Kits or a full OS-level offline guarantee exist;
- that third-party code, assets, models, marks or datasets may be rebranded or redistributed. The founder's copy-first statement is an assertion; source-specific grants remain unverified.

The only safe current claim is: **the existing Electron desktop and its merged local host/loopback MCP surface remain the v1 candidate, subject to the canonical P09/P10 exact-head gates.**

### 0.2 Exact sources and authority

| Role | Reference | Meaning |
|---|---|---|
| Source base for this revision | Ninerr `17edb22c283121c1e93bcd76d91f0fb918204ab5` | The tree read for this revision. `docs/designs/` is untracked in this worktree, so no design commit SHA is asserted. |
| Prior source anchors | `8cba15c4e4af40b12476433a49e20a1696cfc0f8`; `25145f2cf780474ad2cb133c432bcb0bcbbfa2fd` | Both verified ancestors of the base; not competing "main" definitions. |
| Canonical v1 program | `docs/MASTER_PLAN.md` | Authoritative for N0, P08, P09, P10 and the release gate. |
| Proposed post-v1 design | `docs/design-platform/{README,AGENT_CONTRACT,ARCHITECTURE,REUSE}.md`, ADRs 0001–0007 | Proposal only; no P11–P16 implementation is authorized until the founder records approval. |
| P11–P16 task plan | `docs/design-platform/PLAN.md` at commit `16f9d0f` (PR #359) | Absent at the source base. Its task IDs and estimates are inlined in §4 and §10 so no implementer depends on an absent path. |
| Program state | `docs/CURRENT.md` at `1987c77` (2026-10-13) | Stale relative to the 2026-11-06 sources; refresh is a P10 release-gate obligation, not a fourth design base. |

Authority order: `MASTER_PLAN.md` for v1 and release; this document for the post-v1 program shape only after founder approval; `AGENT_CONTRACT.md` and ADRs for the exact P11+ contract once approved. Where this document and an approved contract disagree, the approved contract wins and this document is corrected.

### 0.3 Maturity labels used below

| Label | Meaning |
|---|---|
| **SHIPPED-SCOPE** | Merged source on the base and included in the v1 candidate. It is still subject to P09/P10 exact-head qualification; no release is certified by this label. |
| **DRAFT** | Exists only on an unmerged branch or PR; not installable, qualified or claimed. |
| **PROPOSED** | No production implementation; requires founder approval, implementation and exact-head evidence. |

There is no verified public release in this worktree. "Shipped" in this document never means "released".

### 0.4 Label glossary (defined here, not by an absent path)

| Label | Definition |
|---|---|
| P09 | Ninerr UI/UX completion (canonical `MASTER_PLAN.md` criteria). |
| P10 | Release-candidate hardening and native packages (canonical criteria). |
| P11–P16 | Post-v1 design-platform proposal tasks: P11 agent editing, P12 layout, P13 tokens, P14 components, P15 AI creation, P16 vectors/export/prototyping. |
| M0–M5 | Skilit migration gates from the strategy: M0 inventory; M1 contracts/pack producer/store; M2 embedded Research/Lens/Assets/Design Intelligence; M3 reviewable apply; M4 migration qualification; M5 consolidation. |
| M3-BK | The Build Kits implementation grain under M3; a Ninerr-named addition, not a hosted inference product. |
| J1–J7 | Product journeys in §5; each has a `-v1` (existing subset) and `-p` (post-v1) form where applicable. |
| A-01–A-16 | Acceptance gates in §5.3. |
| V01–V03 | Competitive creative cases from the REA brief: vector logo export/reimport, brand composition with rights/metadata, responsive reference rebuild. They belong to A-12, not to a release gate. |

### 0.5 EGM review status

| Stage | Status | Output |
|---|---|---|
| 05 Zoom-Out | Completed | 10 findings (5 Blocker, 5 Major) |
| 06 Comprehension | Completed | 12 findings |
| 07 Design Critic | Completed | 12 findings |
| 08 Zoom-Out again | **Not run** | Required for a full cycle |
| 09 Implementation Readiness | **Not run** | Required for a full cycle |

This revision is an author response to 05–07, not independent review evidence. Stage 08/09 reviewers must use fresh contexts and inspect source directly.

## 1. Founder contract: binding requirements, honestly scoped

1. **Native installed desktop first.** Windows x64, macOS arm64 and Linux x64 packages; the existing Electron shell is the starting point, not a discarded prototype.
2. **Local-first core.** Creating, editing, saving, undo/recovery, project persistence and supported exports must work without a Ninerr account or hosted service. The absolute "all non-loopback traffic is blocked" claim is made only after the whole-process proof in §7.2; until then it is a design requirement, not a verified guarantee.
3. **No Ninerr cloud and no founder-funded inference.** The founder does not operate model inference, hosted workspaces, a multi-tenant database, hosted vector search, a relay, a GPU queue or user compute. Static installers and documentation hosting are not user computation. Users supply their own machine and any optional model endpoint/provider.
4. **Two supported client paths.** Users work through the installed desktop UI or through local MCP exposed by the installed app. "Parity" is a bounded, versioned matrix, not an unlimited claim (§6.3).
5. **No account to start.** A fresh user can install, create, edit, save, reopen and use the supported local MCP without an account, subscription, API key, external service, Ninerr server or paid model.
6. **External access is opt-in and direct.** A URL fetch or a user-supplied model/provider call may contact external hosts only as an explicit user action from the user's device, with consent and an egress list. It never routes through founder infrastructure. Strict Offline Mode denies it.
7. **Privacy by default.** No telemetry, hidden sync, crash upload, background scraping, automatic private-folder indexing, remote relay or secret exposure in MCP output, screenshots, logs, exports or diagnostics.
8. **One app identity.** Skilit capabilities become Ninerr Research, Lens, Assets, Design Intelligence and Build Kits. No second Skilit-branded editor or duplicate canonical document store ships. Provenance, notices and upstream licenses remain.
9. **Copy-first requires checked rights.** The founder's declaration is not independent proof. Every imported source, dependency, asset, dataset, model, mark and screenshot needs a rights-ledger decision before bundling or export. Unknown rights fail closed.
10. **Quality claims follow tests.** "World's best / only choice" is an aspiration. Each comparative advantage needs a same-case, dated, observed benchmark; failures and unknowns are disclosed.

## 2. Source-verified baseline: what exists, what is draft, what is proposed

### 2.1 Capability and work mapping

| Capability | Maturity | Source-verified state | v1 claim |
|---|---|---|---|
| Electron desktop shell + local studio host | SHIPPED-SCOPE | `packages/desktop/src/main.mjs` starts the host on `127.0.0.1:0`; renderer is sandboxed. | Installed desktop editor, subject to P09/P10. |
| Canonical document, snapshot + journal | SHIPPED-SCOPE | `packages/document-model`, `packages/persistence`, `packages/history`; document schema 1, project schema 3, journal format 1. | Create/edit/save/undo/reopen, subject to P09/P10. |
| Local MCP over authenticated loopback | SHIPPED-SCOPE | `packages/studio-host/src/mcp.ts`, `server.ts`; 16 tools; `/mcp`; loopback bind; bearer agent credential hashed at rest. | Supported while the app/host runs, with the exact limits in §3.1 and §6.1. |
| MCP stdio relay | DRAFT/checkout-only | `scripts/ninerr-mcp.mjs`, `packages/studio-host/src/relay.ts`; requires Node, a checkout and `NINERR_MCP_TOKEN`; **not copied into the installer** by `scripts/package-desktop.mjs`. | **Not a v1 installed acceptance path.** |
| GUI ↔ MCP command surface | SHIPPED-SCOPE, partial | 16 MCP tools versus the wider host route map (`server.ts`): import, codebase, project, history, agents, confirmations. | Only the 16-tool document subset; explicit omissions in §6.3. |
| JSX/TSX code export/import and source round-trip | SHIPPED-SCOPE, bounded | `/api/code/export`, `/api/code/import`, `packages/code-ir`, `codebase.ts`; JSX/TSX, CSS, Tailwind. | Supported JSX/TSX round-trip; unsupported source preserved or refused. |
| PNG/SVG/PDF layer export | PROPOSED | No implemented exporter; only JSX export exists. | **Not in v1.** Post-v1 W6 (P16 T16.1). |
| Astro import/edit/write-back | PROPOSED | `.astro` is only an allowlisted file extension; no parser/patch adapter. | **Not in v1.** JSX/TSX only; Astro is a separate post-v1 grain. |
| Agent undo/redo | SHIPPED-SCOPE, limited | Per-actor undo/redo; "Undo agent change" reverts the latest agent change; revert does not push a redo entry. | Apply → inspect → revert; **no redo of an agent revert claimed**. |
| Offline policy and tests | SHIPPED-SCOPE, partial | Renderer requests and Chromium background requests are blocked; `tests/offline-guarantee.test.mjs` traps Node primitives; `docs/DESKTOP.md` admits main-process connections are not watched. | "Zero non-loopback" is not claimed until §7.2 proof. |
| Skilit local reference packs | DRAFT | Draft branches `feat/local-reference-file-reader-20261106` and `test/offline-reference-packs-20261106` contain a bounded adapter; not merged or shipped. | **Not in v1.** |
| Skilit Research/Lens/Assets/Design Intelligence/Build Kits | PROPOSED | No production UI, pack producer or Build Kit implementation. | **Not in v1.** |
| P11–P16 tasks | PROPOSED | PLAN.md exists at `16f9d0f`, absent at base; PR #359 unmerged. | **Not in v1.** |

### 2.2 v1 supported subset (the only thing P09/P10 may qualify)

v1 is the existing installed desktop editor and its existing local host/MCP surface. It may claim only:

1. install and run on each supported OS from a package, without an account or API key;
2. create, edit, save, undo/reopen, and export the **currently implemented JSX source**;
3. import supported local HTML and round-trip supported JSX/TSX source; unsupported source is preserved or refused, never silently normalized;
4. connect an authorized agent through the **authenticated loopback MCP** while the host runs, use the existing 16 tools, inspect attribution, and use the existing **Undo agent change**/revert;
5. operate with no Ninerr-created cloud dependency and no founder-paid inference; the current offline evidence is limited to the measured renderer/host test target until §7.2 completes.

### 2.3 Explicit v1 exclusions

v1 does **not** include and must not advertise: packaged stdio/headless MCP without Node; agent redo of a revert; PNG/SVG/PDF export; Astro round-trip; full GUI/MCP parity; Skilit packs/Research/Lens/Assets/Build Kits; vectors/prototyping; a built-in model; cross-tenant pack export; or a proven whole-process zero-egress guarantee.

If the founder makes any excluded item mandatory for v1, its tested implementation must move before the release gate with an explicit schedule impact. Existing gates are never silently widened.

## 3. Architecture

```text
Human keyboard/pointer                         External agent on user's machine
         |                                                   |
 Electron main + hardened renderer                 MCP client
         |                                       /                    \
 Shared intent commands              authenticated loopback HTTP    separately packaged
         |                            (v1, while host runs)           stdio helper (post-v1)
         +----------- document mutation gateway -------------+
                                  |
                      canonical Ninerr document
                nodes, layout, tokens, components, revisions
                                  |
                       snapshot + append-only journal
                      user-chosen project folder + ACL
                                  |
             read-only local intelligence + reference packs
              (rights/tenant manifest, content-addressed files)
                                  |
                 optional user-owned model provider or Lens
                    (off by default; direct from user device)
```

No server-hosted API, hosted database, model service, relay or Ninerr multi-tenant backend is introduced.

### ADR-D1: desktop runtime
Keep the packaged Electron runtime and hardened local host. Record resource measurements and any future runtime change in a separate ADR. Existing Windows/macOS/Linux qualification targets remain.

### ADR-D2: one document authority
Ninerr's document IDs, schema, renderer, transactions and snapshot+journal remain the only editable-design truth. Skilit's PostgreSQL graph is never a second editable document owner. Post-v1 document schema 2 is additive and lazy (§9).

### ADR-D3: local intelligence storage
Ship reference packs as a **manifest + content-addressed local files**, with stable `ninerr-ref://` identifiers, rights/confidence metadata and hashes. `ninerr-ref://` is an identifier, not a transport. No PostgreSQL, Redis, pgvector, S3/R2, hosted crawler or login. Start with bounded in-process manifest search; **no SQLite/FTS5 requirement**. If measured search need justifies an index, it is a disposable, rebuildable cache with its own ADR; canonical pack content remains readable without it.

### ADR-D4: local MCP transports (exact)
- **v1 installed transport:** authenticated **loopback HTTP** at `127.0.0.1:<port>/mcp`, started by the app, with a bearer agent credential shown once, stored only as a hash, revocable in the app. It is long-lived per agent and may be shared if multiple clients share one agent credential. The user copies the credential into the MCP client configuration. This is the **only** v1 installed acceptance transport.
- **v1 stdio:** source-checkout relay only (`node scripts/ninerr-mcp.mjs`), needing Node and `NINERR_MCP_TOKEN`. It is **not bundled** in the installer and is not a fresh-user acceptance path.
- **Post-v1:** a **separately packaged, signed stdio helper or Electron utility process** with no user-installed Node; one reviewed credential handoff (owner-only discovery file, OS keychain, or short-lived exchange) with per-client identity, rotation and revocation; headless project list/open/access. This requires an ADR and packaged E2E before any claim.
- Never bind `0.0.0.0`; no tunnels or cloud relays. Loopback HTTP keeps CSRF/origin/Host checks and per-document authorization.

### ADR-D5: model provider and compute
Ninerr performs deterministic design operations; it does not host inference. A user may point Ninerr at a **user-owned** local or provider endpoint. The provider is off by default; only loopback endpoints or an explicitly allowlisted remote endpoint with consent and an egress list are permitted; credential references use the existing `env`/`os-keychain` stores; requests are bounded, cancellable and scoped to the user's explicit action. Ninerr never proxies inference through founder infrastructure and never silently downloads models or uses user GPU/CPU in the background. Any agent-powered-by-a-model may call Ninerr's MCP as an external client without Ninerr knowing or paying for that model.

### ADR-D6: safe research capture (reuse first)
Local image analysis is offline. URL analysis is optional online, user-initiated, and must reuse `packages/import-stack/src/network.ts` and `security.ts` for URL validation, private/loopback rejection, DNS-rebinding checks and redirect recording. **Do not add a new capture service.** If isolation requires a worker/utility process, record a separate ADR and any founder exception to the no-child-process rule; no app secrets or broad filesystem access reach captured content. No hidden crawler queue.

### ADR-D7: portability, identity and rights
Ninerr branding is canonical; third-party attribution and licenses are preserved. Skilit data schemas remain backward compatible until versioned import/export tests pass. Do not carry over Skilit paid plans, user auth, worker deployment assumptions or cloud billing. Imported third-party code/assets are pinned to an immutable hash and require a rights-ledger decision and reviewed notices.

### ADR-D8: one main-process egress boundary
Every main-process `fetch`/`net`/provider/import/update path must call one egress broker backed by `@ninerr/network-policy`. Strict Offline Mode maps to **`local-only`** (loopback permitted only for the studio host/MCP), not to the policy's `offline` mode (which denies loopback too). Add `mcp.local`, `export.local` and `lens.offline` to `CORE_FEATURES` when they exist. This is a design requirement; §7.2 proof is pending.

## 4. Two-track delivery: v1 now, post-v1 by milestone

### 4.1 Track R — v1 candidate (P09/P10 only)

- Finish P09 exactly as `MASTER_PLAN.md` defines: agent change undone where the person looks, layer reorder/group/reparent by pointer and keyboard, classes inspector, accessibility, text/shorthand decisions.
- Pass P10 on the exact candidate: full qualification, Linux/macOS/Windows packages, packaged journeys/resilience, security/privacy/recovery/offline evidence, parity dispositions, SBOM/notices/checksums/corresponding source, current-state agreement.
- Add **no** W1–W8 feature to v1 unless the founder explicitly reprioritizes and the tested implementation moves before the release gate.

The v1 exit is not "this spec is written" and not "the strategy changed". It is the existing P09/P10 evidence on the exact candidate.

### 4.2 Track W — post-v1 milestones (each conditional on recorded founder approval)

| Milestone | Scope | Maturity now | Estimate* |
|---|---|---|---|
| **W1 / P11** | Agent contract v2: caller `baseRevision`, idempotency, no-side-effect `dryRun`, `apply_operations`, `propose_change`, proposal panel, revert preview, explicit reapply, installed stdio/headless (#364), first parity matrix | PROPOSED | 24–36 days + helper estimate TBD |
| **W2 / P12** | Responsive layout, constraints, snapping/guides, align/distribute/rotate, local font lookup | PROPOSED | 19–28 days |
| **W3 / P13** | Token collections/modes, bindings, validation, panel, MCP reads, design system from codebase | PROPOSED | 21–30 days |
| **W4 / P14** | Component definitions, instances, variants, properties, overrides, code-bound components | PROPOSED | 26–38 days |
| **W5 / P15** | User-owned model provider, built-in agent loop, comments, typed levers, alternatives, conformance checks | PROPOSED | 24–35 days |
| **W6 / P16** | PNG/SVG/PDF export, vector paths/booleans, prototyping, collaboration decision | PROPOSED | 25–37 days |
| **W7 / M0–M4 + M3-BK** | Skilit: inventory, local pack contract/producer, Research/Lens/Assets/Design Intelligence UI+MCP, reviewable apply, Build Kits, migration qualification | PROPOSED | TBD before scheduling |
| **W8** | Consolidation decision only after M4 and founder governance | PROPOSED | TBD |

\*Estimates are from the pinned `PLAN.md` at `16f9d0f` for one engineer + agent pair, including tests/review but excluding CI waits. They are not commitments. W7/W8 have no accepted estimate yet.

**Mapping to the founder's missing capabilities:** installed stdio/headless → W1; reliable agent revert/reapply → W1; full GUI/MCP parity → W1 first slice, completed across W2–W7; PNG/SVG/PDF export → W6; Astro → W6 separate grain; Skilit packs → W7/M0–M1; Research/Lens/Assets/Design Intelligence → W7/M2–M3; Build Kits → W7/M3-BK.

### 4.3 Dependency edges

```text
R: P09 -> P10 -> release gate -> v1.0.0
W1 T11.1 -> T11.2/T11.3/T11.5/T11.6 -> T11.4 -> T11.7; T11.9 with T11.1
W6 T16.1 export depends only on the existing renderer; W6 T16.2 -> T16.3; T14.4 -> T16.4
W3 T13.1 -> T13.2 -> T13.3/T13.4 -> T14.1 -> T14.2 -> T14.3 -> T14.4
W7/M3 reference apply requires W3 tokens (T13.1–T13.3) and W4 components (T14.1–T14.3)
W1 + W3 + W4 + M3 -> W5 agent creation
W1 + W2 + W3 + W4 + W6 + M3-BK -> W8 consolidation decision
```

No exit gate may depend on a later milestone. The previous graph's missing `W3.2/W3.3 → W4.5` edge is added; the reference-apply grain cannot start before tokens/components exist.

### 4.4 Authorization gate

`G-AUTH`: no W1–W8 implementation, merge or release starts without a recorded founder approval naming the phase/task. Until then, only W0 evidence gathering (source inventory, rights ledger, fixture design) may proceed. This document does not grant approval.

## 5. Acceptance journeys and gate matrix

### 5.1 v1 journeys (SHIPPED-SCOPE only)

- **J1-v1:** install → disconnect network → create/edit supported frames → tokens/components only if already supported → keyboard edit → save → terminate → reopen → export **JSX source**. No PNG/SVG/PDF claim.
- **J2-v1:** connect an authorized agent through **authenticated loopback MCP** while the host runs → read → apply a supported operation → inspect attribution → use **Undo agent change** (revert). No dryRun, proposal, redo or headless claim.
- **J3-v1:** not applicable. No built-in model is required or shipped.
- **J4-v1:** link an authorized local JSX/TSX project → import a component → edit one style → preview minimal diff → approve/reject write-back → external change → stale refusal/reconcile. Astro is not claimed.
- **J5-v1 / J6-v1:** not applicable. No Skilit pack UI or Lens is shipped.
- **J7-v1:** a malicious workspace/document/MCP client cannot read arbitrary local files, another project, shell, password store or non-loopback network; refusals are typed.

### 5.2 Post-v1 journeys

- **J1-p:** J1-v1 plus PNG/SVG/PDF export fidelity (W6).
- **J2-p:** stdio/headless installed transport, dryRun/proposal/idempotency, revert preview and explicit reapply (W1).
- **J3-p:** user-owned model endpoint; opt-in, off by default; plan/preview/accept; refuses connection safely (W5).
- **J4-p:** Astro import/edit/write-back with byte-identity and fail-closed tests (W6 separate grain).
- **J5-p:** offline pack search → rights/confidence inspection → apply permitted token/component/flow → native edit → reference ID resolves after reopen (W7).
- **J6-p:** opt-in URL Lens with SSRF/redirect/byte limits and rights-filtered assets → return offline → cached pack works without external requests (W7).
- **J7-p:** extended isolation for packs, Lens, providers, cross-tenant export and headless host.

### 5.3 Gate matrix (no gate depends on later work)

| Gate | Milestone | Pass condition | Evidence status |
|---|---|---|---|
| A-01 Install/v1 | R | Fresh OS account: create/edit/reopen/export JSX and use loopback MCP with no account/API key. | Not run |
| A-02 Offline test target | R | Renderer/Chromium and trapped Node primitives show no non-loopback request across J1/J2/J4/J7. | Existing tests, not run here |
| A-02p Whole-process offline | R/W1 | OS packet/firewall proof on packaged app across all app processes, with a denied provider/updater/font negative control. | **Pending; no claim** |
| A-03 No founder compute | R/W | Dependency/endpoint allowlist scan plus packaged blocked-network E2E showing no account, API key or founder service. Not a source grep. | Pending |
| A-04 MCP surface/parity v1 | R | The 16 advertised tools behave as documented; every excluded GUI command is listed; denied/stale calls leave document/journal untouched. | Not run |
| A-04p Full parity target | W1+ | Every command marked "parity supported" has independently tested document/history/reference equivalence or a recorded exclusion. Never "all features" without the matrix. | Pending |
| A-05 Security | R/W | Malicious client/page/asset/URL attempts refused; no secret/file/cross-project leakage; no public bind. | Not run |
| A-06 Persistence/migration | R/W | Crash/replay/reopen and declared version matrix pass; no silent loss; v1 stays v1 until first v2 node. | Existing tests + new corpus pending |
| A-07 Design fidelity v1 | R | Existing supported frames/tokens/accessibility pass; JSX export semantics correct. No PNG/SVG/PDF/vector claim. | Not run |
| A-08 Source round-trip v1 | R | JSX/TSX byte identity on no-op, minimal diff on edit, unsupported source preserved/refused. | Not run |
| A-08p Astro | W6 | Astro corpus: zero-edit byte identity, one-node minimal diff, unsupported fail-closed. | Pending |
| A-09 Skilit local pack | W7 | 1,000-object mixed-rights pack searches/reopens; permitted IDs resolve; restricted assets never export. | Pending |
| A-10 Agent transactions | W1 | Two agents + human: one atomic commit per approval, stale rejected, revert preview correct, explicit reapply safe. | Pending |
| A-11 Performance | R/W | P08/P10 budgets plus §10 proposed budgets; 5-run reference protocol; new workloads measured before phase close. | Existing baseline only; new unmeasured |
| A-12 Competitive score | W0+ | 24-task starter corpus, exact versions, observed results, failures/unknowns. | Evidence-blocked; off critical path |
| A-13 Packaging/license | R | SBOM, checksums, notices, provenance, corresponding source, exact SHA. | Not run |
| A-14 Rights/tenant export | W7 | Missing/unknown rights fail closed; cross-tenant export denied without explicit grant; restricted IDs never appear. | Pending |
| A-15 Export fidelity | W6 | PNG pixel tolerance, SVG geometry/semantics, PDF page/font rules; no fixed-folder writes. | Pending |
| A-16 EGM approval | Program | Stages 08 and 09 complete on this revision; all blockers dispositioned; founder approval of W1–W8 recorded. | **Not run / not approved** |

## 6. Agent and MCP contract

### 6.1 v1 exact surface

- 16 tools: 9 read (`project_info`, `layer_tree`, `layer_details`, `layer_children`, `find_layers`, `selection`, `layer_code`, `guide`, `finish_task`), 6 write (`create_frame`, `set_text`, `rename_layers`, `set_styles`, `move_layers`, `duplicate_layers`), 1 consequential (`delete_layers`, person confirmation).
- Loopback HTTP only, per-document access, read-before-write, agent attribution, one transaction per write, person confirmation for consequential deletes.
- No `edit`, `apply_operations`, `propose_change`, `dryRun`, `history`, `revert`, `reapply`, import/export, codebase, project management or Research tools.
- `baseRevision` is currently overwritten with the session's current revision in `mcp.ts`; v1 must not pretend caller revisions are enforced. Fixing this is W1.

### 6.2 Post-v1 contract (W1/P11)

`AGENT_CONTRACT.md` v2 becomes normative after approval. It adds to each write tool: caller `baseRevision`, `dryRun`, `fromDryRun`, `requestId`, typed results (`committed`, `revision`, `transactionId`, `affectedNodeIds`, `operations`, `dryRunToken`, `normalized`, `ignored`, `warnings`) and typed errors (`stale-revision`, `invalid-operation`, `not-found`, `refused-by-person`, `limit`, `conflict`, `forbidden`). It adds `apply_operations`, `propose_change`, `outline`, `computed_styles`, `layer_image`, `align_layers`, `design_system`, `search_design_system`; proposal integrity (owner-only accept, operation-hash binding, revision recheck, pending limits); idempotency retention (10 minutes or 1,000 entries, keyed by actor/document/requestId); unknown-argument warnings and strict mode; review mode.

A generic `edit` tool is not added. The existing seven write tools are extended, and the two batch tools carry argument-aware classification.

### 6.3 GUI↔MCP parity matrix

| Command class | v1 | Post-v1 |
|---|---|---|
| Read document/layers/selection | Partial (different shapes); fixture parity needed | Stable read schema + oracle |
| Create/text/style/name/move/duplicate/delete | Implemented supported subset | Full constraints/classes/grouping coverage |
| Undo/redo/history/checkpoint | Human UI only; no MCP | `history`, explicit `revert`/`reapply`; checkpoint owner-only |
| Proposal/dry-run/accept/reject | None | `apply_operations`, `propose_change`, panel |
| Import/HTML review | Human UI only | MCP read/preview first; commit after human review |
| JSX export/import | JSX export only (`layer_code` partial) | Explicit export scope + import proposal |
| Codebase connect/import/write-back | Human only | Connect/import may be proposed; production write-back stays human-approved |
| Project create/open/close | Requires an already-open project | Headless project list/open under W1/#364 |
| Agents/confirmations admin | Human only | Human only; no self-grant/self-approve |
| Research/Assets/Lens/Build Kits | None | Rights-gated local catalog + MCP query under W7 |

"Full parity" is a program target, not a v1 claim. Every row is either `parity supported` with tests or an explicit exclusion.

### 6.4 Revert and reapply semantics

- **v1:** "Undo agent change" reverts the agent's latest change as the person's inverse transaction; it deletes the person's redo stack. Do not claim redo of an agent change.
- **Post-v1:** `GET /api/revert/preview` lists later human/agent changes the revert would discard; the person confirms. Reapply is a **new linked transaction** that is allowed only if the document is still safe; otherwise it refuses with structured conflicts. "Redo of a revert" is not claimed.
- Tests must cover: later human edit inside the reverted range; two agents; retry after stale; reject leaves no journal entry; acceptance hash mismatch.

## 7. Offline, security, rights and no-founder-compute gates

### 7.1 Threat table

| Asset | Actor/boundary | Control | Test | Residual risk |
|---|---|---|---|---|
| Project files | Malicious document/workspace | User-chosen root, trusted-file/ACL checks, no input-derived paths, symlink/reparse refusal | Per-OS ACL/path-race tests | OS/filesystem differences |
| Local host | Malicious web page / MCP client | Loopback bind, bearer auth, Origin/Host/CSRF checks, per-document access, read-before-write | Adversarial MCP/browser suite | A local program running as the user is outside the boundary |
| Agent writes | Stale/duplicate/malicious agent | `baseRevision`, idempotency, atomic batch, dry-run, proposal, owner approval | Stale/duplicate/atomicity tests | Model may propose harmful content; human review remains |
| Proposal UI | Agent spoofing | Operation-hash binding, owner-only accept, revision recheck | Tamper/stale accept tests | UI compromise by local user |
| URL Lens | Hostile site/redirect/DNS rebinding | Reuse import-stack validation, private/loopback denial, byte/time/redirect limits, no secrets | SSRF/redirect/oversize tests | Parser/browser 0-day |
| Reference pack | Zip bomb/traversal/symlink | Entry/size limits, SHA-256, canonical paths, atomic install/rollback, confined root | Integrity/traversal tests | Third-party compression bugs |
| Export | Restricted/cross-tenant content | Rights ledger + tenant gate, user-chosen path, no fixed folder | Restricted-ID/cross-tenant tests | Unknown rights |
| Provider | User misconfiguration | Off by default, loopback/allowlist, consent, request limits, credential refs | Stub endpoint/refused connection | User chooses a hostile endpoint |
| Update/telemetry/font | Hidden egress | Absent/disabled; Offline Mode denies; egress list | OS packet/firewall proof | **Pending measurement** |
| Prompt injection | Pack text/tool output | Untrusted-content labeling, no auto-approval, proposals | Injection fixtures | Model behavior |
| Supply chain | Dependencies | Lockfile, license register, SBOM, notices | Scans | Unknown transitive |

### 7.2 Offline mode and egress proof (pending)

- `@ninerr/network-policy` currently defines `offline` = no network and no loopback; `local-only` = loopback only. Strict Ninerr Offline Mode must map to **local-only** with loopback permitted only for the studio host/MCP.
- The desktop currently hardens Electron's `defaultSession`; main-process `fetch`, providers, imports and any updater are outside that filter. `docs/DESKTOP.md` says the desktop smoke test does not watch main-process connections.
- Required: one main-process egress broker (ADR-D8); `CORE_FEATURES` gains `mcp.local`, `export.local`, `lens.offline` when implemented; mode persistence and visible UI state; transition tests; negative controls proving a configured provider, updater, telemetry, analytics and remote font are denied in Offline Mode.
- Required proof: packaged app on each OS under an OS firewall/packet sink, covering Electron main, renderer, utility/worker and child processes, with actual destination logs. **This is pending. No absolute zero-egress claim is made in this revision.**

### 7.3 Rights ledger, ACL and cross-tenant export gates

`RIGHTS_LEDGER.json` (new, versioned) must carry per source/asset:

| Field | Rule |
|---|---|
| `sourceId`, `sourceUri`, `sourceSha256` | Exact identity; immutable pin |
| `licenseSpdx`, `licenseTextSha256`, `notices` | SPDX expression or `NOASSERTION`; required notice reference |
| `scope` | What may be copied/adapted (code, UI, content, asset, model, mark) |
| `evidenceUrl`, `verifiedBy`, `verifiedAt` | Grant artifact or contact; `verifiedBy` must be independent of the importing author |
| `allowedLocal` | May be stored/used locally |
| `allowedExport` | May leave the app in any export (PNG/SVG/PDF/code/JSON) |
| `allowedRedistribute` | May ship in sample packs, Build Kits or installers |
| `tenantId` | Owning tenant/workspace; absent means local-only |

Gate rules:
- Missing ledger row or unknown rights → `allowedLocal=false` by default; no export, no redistribute, no sample bundle.
- Export pipeline fails closed unless `allowedExport=true` **and** the active workspace tenant matches `tenantId` (or a recorded cross-tenant grant exists).
- Cross-tenant export requires an explicit, evidenced `crossTenantGrants` entry naming source, destination tenant and scope; no implicit wildcard.
- Sample/Build-Kit builds require `allowedRedistribute=true` and checked notices.
- ACL: project roots are user-chosen; the host proves owner/effective access where supported (Windows native boundary reuse), refuses symlink/reparse escapes, confines pack install and export to chosen roots, and never grants MCP a path outside the open project.
- Tests: a restricted ID never appears in PNG/SVG/PDF/code/JSON exports; a cross-tenant ID is denied; a missing ledger row denies; ACL/path-race tests per OS; unknown rights are visible, not silently shipped.

### 7.4 No founder compute

| Concern | Decision | Proof |
|---|---|---|
| Model inference | None hosted by Ninerr; user provider only | Dependency/endpoint scan + packaged blocked-network E2E with no account/key |
| Hosted database/workspace | None | Deployment/source scan |
| Relay/vector search/GPU queue | None | Architecture audit + endpoint allowlist |
| Telemetry/crash upload | None by default | Egress test |
| Static docs/installers | Allowed | Not user computation |
| User model/provider | User owns and pays | Off by default; direct from user device |

## 8. Skilit intelligence, local packs and Build Kits (post-v1)

### 8.1 Offline data path

1. **M0 inventory:** pin Ninerr and Skilit SHAs; inventory Product, ProductVersion, Artifact, Asset, Relation, Flow, Pattern, Collection, CaptureRun, AnalysisRun, ImportRecord, APIs/MCP, rights, tenancy and draft PRs #178–#188; produce a keep/adapt/retire matrix. No bulk repo merge.
2. **S0 producer:** a **build-time exporter** from a pinned Skilit commit produces `ReferencePackV1`; it may read Skilit's database/object storage during export, but the shipped app never contacts Skilit or requires PostgreSQL/Next.js/S3/R2/Redis/pgvector/login.
3. **S1 contract/store:** manifest + SHA-256 content-addressed files, stable identifiers, integrity verification, atomic install/rollback, bounded entry/size limits, path traversal/symlink/zip-bomb refusal. Reuse `packages/import-stack/src/reference-pack-file.ts` and `reference-packs.mjs` from the unmerged draft branches; reuse `persistence` `putObject`/`getObject` for content-addressed bytes. Do not create a second canonical store.
4. **S2 embedded research:** Ninerr Research/Lens/Assets/Design Intelligence UI and matching MCP reads; local image analysis offline; URL Lens opt-in using import-stack. No Skilit-branded canvas.
5. **S3 apply:** rights-qualified reference → native token/component/frame operations, human-previewed, one attributed transaction, undoable; stable reference IDs resolve after reopen.
6. **S4 Build Kits:** machine-readable source-aware bundles of rights-qualified tokens, component specs, screenshots where permitted, and generation context, indexed by stable reference URNs. Local Research only; no hosted inference. Depends on S1, S3 and the rights ledger.
7. **M4/M5:** replay representative Skilit/Ninerr workflows; verify authorized retrieval, no broken references, least privilege, offline operation and latency. Consolidation only after M4 and founder governance.

### 8.2 ReferencePackV1 minimum contract

- `schema: "ninerr.reference-pack/1"`, `packId`, `createdAt`, `producer` (tool/version/source SHA).
- `sources[]`: `sourceId`, `sourceUri`, `observedAt`, `sourceSha256`, rights object (`status`, `license`, `allowedLocal`, `allowedExport`, `allowedRedistribute`, `tenantId`, `verifiedBy`, `verifiedAt`).
- `objects[]`: `objectId`, `kind` (`screen|flow|pattern|asset|token|component`), `sourceId`, `assetSha256`, `confidence` (`observed|documented|inferred|unknown`), `transform`, optional `preview`.
- Identifier grammar: `ninerr-ref://<namespace>/<type>/<id>`, where `<id>` is a stable opaque ID, not a path.
- Limits (proposed, enforced before S1 closes): max pack 512 MiB, max object 64 MiB, max 10,000 objects, max 1,000 sources, max path depth 16; rejects absolute paths, `..`, symlinks, reparse points, duplicate IDs and hash mismatch.
- Install is atomic: stage → verify all hashes/rights → rename into the owner-chosen pack root → rollback on failure. GC removes only unreferenced, verified-installed objects and never canonical project data.
- Search starts as a bounded in-process scan over the manifest. **No SQLite/FTS5 and no embeddings** until a measured benchmark proves need; then a separate ADR and a disposable index.

### 8.3 Capability mapping

| Founder-named capability | Implementation | Gate |
|---|---|---|
| Research | Pack catalog, source-grounded search, collections, evidence/rights | S1/S2 |
| Lens | Offline local image analysis; opt-in URL capture via import-stack | S2 |
| Assets | Content-addressed assets, provenance, rights, export filter | S1/S2 |
| Design Intelligence | Deterministic local extraction/comparison + optional user model; no founder inference | S2/S3 |
| Build Kits | Rights-qualified source-aware bundles with stable URNs | S4 |

### 8.4 Rights and tenant tests

- A 1,000-object mixed-rights fixture opens, searches and reopens offline.
- Every permitted ID resolves after reinstall; no orphaned saved reference.
- Restricted and cross-tenant IDs never appear in any export or sample bundle.
- A missing/unknown ledger row denies export.
- Pack traversal, symlink, duplicate ID, oversize, hash mismatch and rollback tests pass.
- No runtime request to Skilit; no PostgreSQL/Next.js/Redis/pgvector/S3/R2 requirement.

## 9. Version and migration matrix

| Boundary | Current | Post-v1 proposal | Compatibility rule | Tests |
|---|---|---|---|---|
| Document schema | **1** (`DOCUMENT_SCHEMA_VERSION`) | **2** for tokens/`design-system`/`component-instance`; additive optional fields | Lazy upgrade on first v2 node/prop in that transaction; undo of that transaction returns v1 if no v2 content remains; old builds **refuse** v2 without modifying; **no downgrade**; no rewrite beyond the version on upgrade | Existing v1 corpus opens/edits/saves as v1; first v2 node upgrades; old-build refusal; undo; new v2 corpus |
| Project manifest | **3** (`PROJECT_SCHEMA_VERSION`) | **3** unchanged for document v2 | Project schema changes only if new files/metadata require it; then a new built-in migration and refusal rules | `tests/migration-compatibility.test.mjs`; v2-basic → v3; v3-segments |
| Journal format | **1** | **1** for document v2 (v2 adds node types/props within allowed fields) | If a future change needs new transaction/operation fields, bump to format 2 with reader refusal; do not silently extend format 1 | Journal replay/segment tests; unknown-field refusal |
| Snapshot/object store | Snapshot ref + SHA-256 objects | Unchanged | Document schema governs the stored document; objects remain content-addressed | Golden projects byte-stable |
| Renderer | No persisted schema | Reads document version; expands instances at draw time | Nothing expanded is stored; no second representation | Instance expansion/determinism tests |
| MCP contract | **1** (16 tools) | **2** (server advertises; v1 calls warn `no-base-revision`) | Unknown arguments warn, strict mode refuses; v1 clients keep working with warnings for one release | Contract tests |
| Reference pack | — | **1** | New; immutable; rights/tenant metadata required | S1 fixtures |
| Rights ledger | — | **1** | Fail closed; versioned | Rights/export tests |
| Build Kit | — | **1** | Depends on S1/S3 | S4 fixtures |

**"Reversible migration" is removed.** The only reversibility claimed is: the first v2 edit is one undoable transaction, and a v2-capable build may undo it. There is no downgrade, no v1 rewrite of a v2 document, and no bitwise equality claim across versions. A-06 compares declared fields with an explicit per-field semantic-equivalence oracle.

## 10. Tests, budgets and evidence

### 10.1 Budget gates

Existing P08/P10 budgets (unchanged, reference machine #275 five-run protocol; pass in 4/5 runs and median within budget):
- edit/undo/redo p95 ≤100 ms at 1,000 layers; ≤300 ms at 10,000 (100 ms is a goal, not claimed);
- agent edit p95 ≤400 ms at 10,000;
- documented reopen/close/recovery budgets; bounded HTML import and code write-back; ≤500 MiB growth at 50,000 layers (indicative); existing supported-size limits.

New proposed budgets (unmeasured until their workload exists; phase cannot close without measurement):

| Feature | Proposed budget |
|---|---|
| Instance expansion | ≤50 ms p95 for 1,000 instances of a 20-node component |
| Token rename | ≤300 ms p95 with 10,000 bound values |
| Snapping | ≤4 ms per pointer move at 1,000 siblings |
| Dry run | ≤1.2× the same edit's commit time |
| `outline` | ≤200 ms p95 at 50,000 layers |
| Proposal preview | ≤100 ms to draw 200 operations |
| Pack install/verify | ≤10 s for 1,000 objects / 512 MiB on the reference machine |
| Local pack search | ≤100 ms p95 at 1,000 objects |
| Pack reopen | ≤2 s at 1,000 objects |
| v2 reopen | ≤1.25× the same v1 layer-count baseline |
| PNG export | ≤1 device-pixel edge difference; ≤0.1% pixels differ; color delta ≤2/255 |
| SVG export | Geometry within 0.01 px; node count/tag/attribute semantics declared; no remote font |
| PDF export | Declared page boxes/fonts; no missing glyph; font fallback disclosed |

If a proposed budget is wrong, change it by ADR before the phase opens, not after a failure.

### 10.2 Test inventory

**Existing, not run in this docs-only revision:** `npm run check`, `npm test`, `npm run smoke`, `tests/offline-guarantee.test.mjs`, `tests/web-mode.test.mjs`, `tests/mcp-*.test.mjs`, `tests/migration-compatibility.test.mjs`, `tests/migration-corpus.test.mjs`, packaged journey/resilience scripts.

**Proposed, none implemented here:** whole-process egress (`tests/egress-main.test.mjs`), parity oracle (`tests/parity-oracle.test.mjs`), agent contract v2 (`tests/mcp-agent-contract.test.mjs`), reapply interleavings (`tests/reapply-interleaving.test.mjs`), export fidelity (`tests/export-fidelity.test.mjs`), Astro round-trip (`tests/astro-roundtrip.test.mjs`), pack integrity/rights (`tests/pack-integrity.test.mjs`, `tests/pack-rights.test.mjs`), provider (`tests/provider-local.test.mjs`), version matrix (`tests/version-matrix.test.mjs`), accessibility (`auditAccessibility` on every new panel).

Every implementation grain needs: a regression test that fails first; a negative control; exact-head CI on the owning repo; accessibility; scale; docs update. A-12 competitive evidence is blocked by the REA preflight and is off the critical path.

### 10.3 Evidence status

| Evidence | Status |
|---|---|
| P09/P10 exact-head qualification | Not passed |
| Native packages/release | Not built/certified here |
| Installed stdio/headless | Not implemented/bundled |
| PNG/SVG/PDF, Astro | Not implemented |
| Agent dryRun/proposal/reapply | Not implemented |
| Full parity | Not implemented |
| Skilit pack producer/UI/Build Kits | Not implemented; draft branches only |
| OS-level whole-process egress | Not measured |
| Rights ledger/cross-tenant export | Not implemented |
| EGM stages 08/09 | Not run |
| Founder approval W1–W8 | Not recorded |

## 11. Risks, scope controls and non-claims

- **Scope:** W1–W8 total 139–204 engineer-days for P11–P16 alone, before Skilit/Build Kits estimates. Do not present them as a few bullets. The v1 desktop/MCP core must not be buried by professional-suite scope.
- **Rights:** founder authorization is an assertion. No rebrand, redistribution, sample pack or Build Kit ships without a checked ledger row and notices.
- **Offline:** source-level policy is not proof. No absolute zero-egress or "no cloud" marketing claim until the OS-level proof in §7.2.
- **MCP identity:** v1 copies a long-lived bearer into client configuration. Do not claim zero-copy or short-lived per-session credentials; that is post-v1 W1.
- **Migration:** v2 is forward-only. Do not claim downgrade or bitwise v1↔v2 equality.
- **Skilit:** a pack producer is a real ETL/build product; without S0 there is no offline data path. Do not claim Skilit intelligence is integrated.
- **Performance:** new-feature budgets are proposals; none is measured.
- **Competitive claims:** A-12 is blocked; no superiority claim follows from planning.

**Non-claims:** no full EGM 5-stage approval; no tests passed; no release done; no P09/P10 completion; no installed stdio/headless; no PNG/SVG/PDF; no Astro; no agent redo; no full parity; no Skilit integration; no Build Kits; no verified third-party rebrand rights.

## 12. Execution register and handoff

| Item | Value |
|---|---|
| Source base SHA | `17edb22c283121c1e93bcd76d91f0fb918204ab5` |
| Prior anchors | `8cba15c` (ancestor), `25145f2` (ancestor), `CURRENT.md` `1987c77` (stale) |
| Design head SHA | **Not asserted**: `docs/designs/` is untracked and no commit was authorized in this task. The reviewer must record the commit/tree SHA at freeze. |
| Pinned PLAN | `docs/design-platform/PLAN.md` at `16f9d0f` (PR #359), absent at base |
| Design authority | This document after founder approval; `MASTER_PLAN.md` for v1 |
| EGM | 05/06/07 complete; 08/09 not run; no full approval |
| Tests | Planning text only; no test executed in this revision |
| Release | Not done; v1.0.0 not tagged |
| Code/CI/merge/push/commit/sign | None performed |
| Founder approvals | W1–W8 not approved; only v1 P09/P10 remains authorized |
| Next independent step | Stage 08 fresh-context Zoom-Out on this revision, then Stage 09 Implementation Readiness; resolve the 16 feature blockers in `EGM_05_07_RESOLUTION_MATRIX_2026-11-06.md` |
| Release decision | Explicit founder decision after gates, never implied by planning |

This revision resolves **plan-level** issues only. It does not make missing functionality exist.
