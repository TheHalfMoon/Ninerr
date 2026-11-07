## What this proposes

Ninerr becomes a native installed Electron design application, local-first and offline-capable, with no Ninerr-operated cloud and no founder-paid inference. Humans and external agents operate the same canonical Ninerr document through shared intent commands; agents connect by stdio or loopback MCP, with revision preconditions, dry runs, visible proposals, one-transaction commits, attribution and undo. SkilitΓÇÖs research corpus and intelligence capabilities become read-only, rights-tagged Ninerr reference packs through Research, Lens, Assets, Design Intelligence and Build Kits. Delivery is W0ΓÇôW6 with journeys J1ΓÇôJ7 and acceptance gates A-01ΓÇôA-13; P09, P10 and the existing release gate remain in force.

## How the existing system works, per this document

The current packaged Electron desktop and hardened local studio host are retained; the renderer is a UI sandbox, not a privileged filesystem or network process. The canonical Ninerr document owns IDs, schema, renderer, transactions and a snapshot plus append-only journal in a secure project folder; SQLite/FTS5 is only an optional local index cache. The existing MCP protocol, authorization and studio host are reused, and every mutating tool is supposed to share the GUI command gateway with per-document access, baseRevision, idempotency, dryRun/preview, one transaction and undo. Agents act through MCP against the open project; no server backend, hosted database or model service is introduced.

---

### 1. P11ΓÇôP16 delivery is scheduled before the approval its own ADR requires

Evidence: `SPEC:L101` calls P11ΓÇôP16 ΓÇ£unmergedΓÇ¥ and says the new directive ΓÇ£does not magically mergeΓÇ¥ them; `SPEC:L114,L120,L126,L135` then schedule W2 as ΓÇ£P11 upgradeΓÇ¥, W3 as ΓÇ£P12ΓÇôP14ΓÇ¥, W4 as ΓÇ£M0ΓÇôM4ΓÇ¥, and W5 as ΓÇ£P15ΓÇôP16ΓÇ¥. `ADR1:L6` says ΓÇ£none starts before the founder approves itΓÇ¥ and `ADR1:L7` says the proposal ΓÇ£claims no approvalΓÇ¥. `README:L3` says ΓÇ£proposal. Not approvedΓÇ¥; `README:L7` says nothing is authorized until founder approval. `SKILIT:L3` says ΓÇ£implementation proposal pending exact-head reviewΓÇ¥ and `SKILIT:L19` says it does not approve prior PRs. `SPEC:L184` calls the draft ΓÇ£a companion, not an automatic overrideΓÇ¥; `SPEC:L185` says review is NOT YET RUN.

Severity: **Blocker**. Founder product direction may be binding, but phase authorization is not recorded. No W-gate requires founder approval of P11ΓÇôP16. Add an approval record/gate or label W2ΓÇôW6 explicitly unapproved proposals.

### 2. The packaged app cannot provide the stdio MCP that J2 and A-01 require

Evidence: `SPEC:L28` requires ΓÇ£configure local stdio MCPΓÇ¥; `SPEC:L164` requires a packaged app to ΓÇ£start local MCPΓÇ¥; `SPEC:L14` says local MCP is exposed by the installed app. `PKG:L7-L8` builds with fuses so the runtime ΓÇ£can never run as a plain NodeΓÇ¥; `PKG:L158-L170` copies only app packages, runtime dependencies, and license/notices into `resources/app`; no `scripts/` or relay launcher is copied. `DOCSMCP:L19` documents stdio as `node scripts/ninerr-mcp.mjs` or `npm run mcp`, requiring Node and a source checkout. `SPEC:L65` omits `relay.ts`, `server.ts` and `scripts/ninerr-mcp.mjs` from mandatory touchpoints; `SPEC:L117` only promises documentation.

Severity: **Blocker**. A fresh install has no supported stdio MCP entry point, so J2 and A-01 cannot pass. ΓÇ£Bundled MCPΓÇ¥ is never defined. Define the packaged relay entry, install path, agent configuration and packaged E2E.

### 3. ΓÇ£Without copying secretsΓÇ¥ contradicts the only documented credential flow

Evidence: `SPEC:L14` requires MCP use ΓÇ£without copying secretsΓÇ¥; `SPEC:L15` requires no API key. `DOCSMCP:L17-L19` says Ninerr shows the agent credential once and the user sets `NINERR_MCP_TOKEN`; `RELAY:L18-L19` defines that as ΓÇ£the agent credential Ninerr showedΓÇ¥, and `RELAY:L97` sends `Authorization: Bearer`; `MCPCLI:L25-L30` reads the environment variable and refuses to start without it. `SPEC:L117` adds ΓÇ£per-client credentialsΓÇ¥ but defines no handoff.

Severity: **Blocker**. Every documented stdio setup copies a bearer credential into client configuration or the environment. Define a zero-copy handoff, such as an owner-only discovery file, OS keychain, or short-lived exchange, or relax the requirement.

### 4. The W2 proposal path has no tool, store, or agreed contract

Evidence: `SPEC:L115` schedules an ΓÇ£MCP `edit`ΓÇ¥ with baseRevision, idempotency, dryRun, warnings and operation hashes; `SPEC:L116` schedules a proposal panel; `SPEC:L118` makes J2ΓÇöpropose 12 changes, dry run, acceptΓÇöthe W2 exit. `TOOLS:L9-L26` and `MCPTS:L72-L351` expose exactly 16 tools; none is `edit`, `apply_operations` or `propose_change`. `MCPTS:L592` always passes `baseRevision: session.revision`, so a client-supplied revision is ignored. `CONTRACT:L3` says contract v2 is a ΓÇ£proposal, not approvedΓÇ¥; `CONTRACT:L19-L22` lists the missing precondition, dry run, proposal and normalization; `CONTRACT:L68-L73` names `apply_operations` and `propose_change`, not `edit`.

Severity: **Blocker**. W2.1 and W2.2 schedule behavior with no public tool or proposal persistence to implement, and two contracts use different names. J2 cannot pass. Cite `AGENT_CONTRACT` and add the tools, proposal integrity, and argument-aware permissions.

### 5. W4.5 applies tokens and components before the phases that create them

Evidence: `SPEC:L131` says W4.5 converts ΓÇ£rights-qualified design tokens and componentsΓÇ¥ into native document operations. `SPEC:L122` creates token collections and modes in W3.2; `SPEC:L123` creates component definitions, instances and variants in W3.3. The graph at `SPEC:L151-L156` routes W4 as `W0.1ΓåÆW4.1ΓåÆW4.2ΓåÆW4.3ΓåÆW4.5ΓåÆW4.6`, with no edge from W3.2 or W3.3; W3 starts in parallel from W1.1.

Severity: **Major**. On the stated graph, W4.5 can start before the schema it applies, forcing a block or duplicated token/component work. Add `W3.2 + W3.3 ΓåÆ W4.5`, and `W4.4 ΓåÆ W4.5` if Lens output is applicable.

### 6. W3 cannot exit because J1 requires PDF export delivered in W5.2

Evidence: `SPEC:L27` makes J1 include ΓÇ£export SVG/PNG/PDFΓÇ¥; `SPEC:L124` makes J1 the W3 exit; `SPEC:L137` puts ΓÇ£exact exports SVG/PNG/PDFΓÇ¥ in W5.2; `SPEC:L140` lists J3 and V01ΓÇôV03 for the W5 exit, not J1. `CATALOG:L114` states: ΓÇ£Export to images, PDF and other file formats is planned.ΓÇ¥

Severity: **Blocker**. W3ΓÇÖs exit gate cannot pass using the documentΓÇÖs own sequencing, and the architecture catalog says the export capability is not delivered. Move the export requirement/gate or move J1 to W5.

### 7. Three different commits are presented as the source baseline

Evidence: `SPEC:L5` pins the target worktree base at `25145f2`; `SPEC:L183` says ΓÇ£Ninerr main `8cba15c`ΓÇ¥; `SPEC:L6` lists the canonical reads. `CURRENT:L50` says ΓÇ£Canonical main `1987c77`ΓÇ¥, while `CURRENT:L3` is last updated 2026-10-13, before the 2026-11-06 spec. `SKILIT:L4` also uses `8cba15c`.

Severity: **Major**. Exact-head gates and W0.1 pinning are undefined while three different bases are called main/target. Name one canonical base, state its relationship to `25145f2` and `8cba15c`, and refresh `CURRENT`.

### 8. The canonical PLAN.md and several gate labels are unavailable or undefined

Evidence: `SPEC:L6` calls `docs/design-platform/PLAN.md` (from unmerged PR #359) a canonical read. At HEAD `25145f2`, that file is absent: `docs/design-platform/` contains only `AGENT_CONTRACT.md`, `ARCHITECTURE.md`, `README.md`, `REUSE.md` and `adr/`; `README:L14`ΓÇÖs link is therefore broken here. `SPEC:L71` uses ΓÇ£P13 schema v2ΓÇ¥; `SPEC:L114/L135` use P11/P15ΓÇôP16; `SPEC:L140` uses V01ΓÇôV03; `SPEC:L126` uses M0ΓÇôM4. PLAN.md is where P11ΓÇôP16 task scope is defined; V01ΓÇôV03 and M0ΓÇôM4 are defined only in strategy documents named in `SPEC:L6`, with no links at point of use.

Severity: **Major**. Implementers cannot resolve phase/task scope or gate labels from the target. Pin or attach PLAN.md, and define or link P11ΓÇôP16, V01ΓÇôV03 and M0ΓÇôM4 inline.

### 9. Skilit storage and transport are specified two incompatible ways

Evidence: `SPEC:L74` (ADR-D3) says start with a manifest plus local content-addressed files and ΓÇ£Do not require PostgreSQL, Redis, pgvector, S3/R2, hosted crawler or login.ΓÇ¥ `SKILIT:L34` proposes `packages/design-intelligence/adapters/skilit` as ΓÇ£read-only source APIs/MCP and object-ID resolverΓÇ¥; `SKILIT:L40` says ΓÇ£SkilitΓÇÖs existing PostgreSQL and object storage may remain as internal backing providers during migrationΓÇ¥. `SPEC:L6` lists `SKILIT` as a canonical read; W4 (`SPEC:L126-L133`) does not say whether packs are exported from that database/API or built independently.

Severity: **Major**. Two incompatible Skilit models are both authoritative. The no-cloud requirement at `SPEC:L13` favors local packs, but the strategy permits PostgreSQL/object storage. Add an explicit supersession decision and the pack-production path.

### 10. Skilit source resolution, rights metadata, and two named capabilities are undefined

Evidence: `SPEC:L31` requires handing a source ID to an agent and resolving it; `SPEC:L74` gives only an example URI, `ninerr-ref://source/<id>`; `SPEC:L129` promises a ΓÇ£versioned MCP resource/tool contractΓÇ¥ without naming tools or schemas; `SPEC:L172` requires every ΓÇ£permittedΓÇ¥ ID to resolve after reinstall. `CONTRACT:L68-L79` adds no reference resolver or resource. `SPEC:L18` names Research, Lens, Assets, Design Intelligence and Build Kits; `SPEC:L129` names Research, Assets, Flow, Patterns and Lens; `SPEC:L143` names Research, Design, Inspect, Components, Assets, History, Agents and Export; no grain or gate covers Design Intelligence or Build Kits, and Lens is absent from the final UI list. `FOUNDER:L3,L8,L31` says source-specific verification is still pending.

Severity: **Major**. The resolver, URI grammar, rights/confidence manifest, orphan rules and two named capabilities are undefined, so J5 and A-09 cannot be implemented or tested. Add a reference contract and map all five capability names to work and gates.

### 11. The no-cloud contract has no acceptance test for its modes or egress list

Evidence: `SPEC:L16` requires an egress list and says strict Offline Mode blocks optional providers, update checks, analytics and web fonts. `SPEC:L165` tests J1/J2/J4/J5/J7 only, omitting J3 (user local model) and J6 (opt-in URL Lens). `SPEC:L32` says J6 downloads ΓÇ£only permitted assetsΓÇ¥ without defining permitted. A-02 says ΓÇ£no hidden ΓÇª AI callΓÇ¥ while J3 explicitly allows a provider endpoint.

Severity: **Major**. There is no test that Offline Mode blocks a configured provider, updater, analytics or font; no test of egress-list contents in Online mode; and no rights filter for J6. Add explicit mode-state tests and define the egress-list and permitted-asset predicates.

### 12. ΓÇ£Agent parityΓÇ¥ is undefined and contradicted by the current MCP surface

Evidence: `SPEC:L14` says agents are ΓÇ£first-class users with parity to visible app functionsΓÇ¥; `SPEC:L118` requires an MCP equivalent for every exposed GUI editing command; `SPEC:L167` requires ΓÇ£matching permissionsΓÇ¥. `TOOLS:L9-L26` has 16 tools, all read/write/consequential, with no project create/open/save/export/undo/redo; `MCPTS:L548` refuses calls when no project is open; `MCPTS:L562-L577` asks the person only for `delete_layers`. `DOCSMCP:L45` says tools act only on the open project. `CONTRACT:L100-L108` proposes an argument-aware permission table, owner-only proposal acceptance and review mode, but `SPEC` never adopts or links it.

Severity: **Major**. ΓÇ£ParityΓÇ¥ is undefined and false against the current surface; no GUI command inventory or permission matrix exists. Define parity scope and reconcile `AGENT_CONTRACT`ΓÇÖs proposal acceptance, argument-aware classification and review mode.

Read-only audit; no files were modified.
