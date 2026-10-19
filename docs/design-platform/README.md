# Design platform: proposed extension

**Status: proposal. Not approved.** This folder holds the plan to grow Ninerr into a professional, AI-native visual design editor.

- **Basis:** it rests on the dated study records in [`docs/research/rea-design-platforms/`](../research/rea-design-platforms/INDEX_2026-10-18.md).
- **What it does not change:** the approved program in [`docs/MASTER_PLAN.md`](../MASTER_PLAN.md). P09, P10 and the release gate, with their criteria, come first and stay as they are.
- **Approval:** nothing here is authorized for implementation until the founder approves it. Approval can cover the whole proposal or individual phases.

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | The target editor, document model, layout, components, tokens, rendering, performance and security |
| [AGENT_CONTRACT.md](AGENT_CONTRACT.md) | The agent and MCP contract, version 2: revision preconditions, dry runs, proposals, idempotency and receipts |
| [REUSE.md](REUSE.md) | What Ninerr reuses, what it adopts from open source (with licenses), and what it builds |
| [PLAN.md](PLAN.md) | Phases P11 to P16, tasks in dependency order, integration points, tests, definitions of done, estimates, the critical path and the first PR |
| [adr/](adr/) | Architecture decision records 0001 to 0007 |

**Questions the plan answers, and where:**
- **What to build:** PLAN.md, phases P11 to P16.
- **Which observed behaviour justifies each feature:** each phase's evidence line in PLAN.md, and the comparison in the study records.
- **Reuse:** REUSE.md.
- **What new architecture is strictly needed:** ARCHITECTURE.md §2, and ADRs 0002 to 0005.
- **How agents edit safely:** AGENT_CONTRACT.md.
- **Order and tests:** PLAN.md, §Critical path and each task's tests.
- **The first PR:** PLAN.md, §First PR.
