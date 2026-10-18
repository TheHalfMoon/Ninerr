# ADR-0005: Component instances are expanded when drawn, never stored expanded

- **Status:** proposed, 2026-10-18.
- **Context:**
  - One studied product duplicates instead of instancing (E-PD-11).
  - Another has components, instances, variants, typed properties and overrides (E-FG-02).
- **Decision:**
  - An instance stores only `componentId`, property values and overrides keyed by definition node IDs.
  - The renderer expands it. A drawn element keeps `data-ninerr-id` as its definition node's ID, and gains `data-ninerr-instance` with the instance chain as an escaped JSON array. So scoped stylesheets keep matching, and node IDs need no separator.
  - Overrides are keyed by that chain and the definition node.
  - "Detach" is one transaction that writes the expansion as real nodes.
- **Consequences:**
  - One definition edit updates every instance with no fan-out writes.
  - A deleted definition node leaves its overrides stale: kept and reported, never silently removed.
  - The scale suite measures expansion cost (ARCHITECTURE.md §6).
