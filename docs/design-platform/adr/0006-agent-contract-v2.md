# ADR-0006: Agent writes take a base revision, can be dry-run, proposed and retried safely

- **Status:** proposed, 2026-10-18.
- **Context:**
  - MCP writes run at the session's current revision, so a stale read can overwrite unseen changes (`mcp.ts:592`).
  - Observed in the same cases: Ninerr and Figma accept a stale write (E-NX-02, E-FG-17), and the third editor's write tools take no revision at all (E-PD-01, E-PD-03); Ninerr ignores unknown arguments (E-NX-07) and stores meaningless styles silently (E-NX-03); Ninerr already refuses a partial batch, which the other two apply in part (E-NX-01, E-PD-12, E-FG-15).
- **Decision:** contract v2 (AGENT_CONTRACT.md):
  - `baseRevision` preconditions;
  - `dryRun`;
  - `propose_change` with a person's preview and decision;
  - `requestId` idempotency;
  - `normalized` and `ignored` reports;
  - typed error codes;
  - warnings for unknown arguments, refused in strict mode;
  - a revert preview naming the later edits a revert would discard.
  - Version 1 behaviour stays for one release, with a warning, then strict.
- **Consequences:**
  - Agents must read before writing.
  - Every write tool shares one path in `mcp.ts` (`edit`), so the change is local to it and to `session.ts`.
