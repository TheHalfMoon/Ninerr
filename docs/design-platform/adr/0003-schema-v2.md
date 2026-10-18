# ADR-0003: Document schema v2 adds `design-system` and `component-instance`

- **Status:** proposed, 2026-10-18.
- **Context:** components, instances and tokens have no node types today. `component-definition` and `token-reference` are reserved and unused.
- **Decision:**
  - `NODE_TYPES` gains `component-instance` and `design-system`. `component-definition` gets its props (ARCHITECTURE.md §2.2).
  - `DOCUMENT_SCHEMA_VERSION` becomes 2.
  - The upgrade is lazy: a project stays v1 until the first v2 node or prop is added, in the same transaction. So older builds keep opening projects that use no v2 feature.
  - A v1 Ninerr opening a v2 project refuses it with a clear message, as the format already does for newer versions.
- **Consequences:**
  - The migration corpus gains v1 cases.
  - `docs/MIGRATION.md` documents the version.
  - `token-reference` stays reserved: bindings are `var()` values (ADR-0004).
