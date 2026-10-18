# ADR-0007: Built-in AI creation is an agent on the same contract, with a provider the person chooses

- **Status:** proposed, 2026-10-18.
- **Context:**
  - One studied product generates and refines designs from prompts, comments and sliders (E-CD-01, E-CD-02). Typed levers are documented for the Design artifact type, whose link to that product is unknown (E-CD-05).
  - Ninerr's agents already edit through MCP.
- **Decision:**
  - Built-in generation is a client of contract v2 (`outline`, `design_system`, `apply_operations` with `dryRun`, `propose_change`), with no private write path.
  - The model provider is configured by the person.
  - With none configured, generation is off, and Ninerr makes no network request for it.
  - The provider endpoint must be https or loopback, and agents cannot change it: it is a setting only the person edits.
  - The settings state what document content is sent.
  - Layer text and comments are untrusted prompt input. Whatever they cause can only be a proposal the person reviews.
- **Consequences:**
  - Generation inherits attribution, approval, undo, staleness checks and the accessibility audit of proposals.
  - The offline guarantee holds whenever generation is off. When on, the provider's endpoint is the only allowed outbound destination, named in the network policy (`packages/network-policy`).
