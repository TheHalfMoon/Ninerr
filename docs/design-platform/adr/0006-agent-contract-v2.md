# ADR-0006: Agent writes take a base revision, can be dry-run, proposed and retried safely

- **Status:** proposed, 2026-10-18.
- **Context:**
  - MCP writes run at the session's current revision, so a stale read can overwrite unseen changes (`mcp.ts:592`).
  - The studied products show partial batches (E-PD-12), silent drops (E-PD-06), and writes with no documented atomicity (E-FG-05).
- **Decision:** contract v2 (AGENT_CONTRACT.md):
  - `baseRevision` preconditions;
  - `dryRun`;
  - `propose_change` with a person's preview and decision;
  - `requestId` idempotency;
  - `normalized` and `ignored` reports;
  - typed error codes.
  - Version 1 behaviour stays for one release, with a warning, then strict.
- **Consequences:**
  - Agents must read before writing.
  - Every write tool shares one path in `mcp.ts` (`edit`), so the change is local to it and to `session.ts`.
