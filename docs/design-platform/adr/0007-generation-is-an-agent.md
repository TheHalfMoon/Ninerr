# ADR-0007: Built-in AI creation is an agent on the same contract, with a provider the person chooses

- **Status:** proposed, 2026-10-18.
- **Context:**
  - Claude Design generates and refines designs from prompts, comments, direct edits and adjustment sliders, and checks its output against the design system before showing it (E-CD-01, E-CD-02, E-CD-08, E-CD-09).
  - Figma's built-in agent applied its work directly, reused an existing component, and offered Undo for the whole turn beside its reply (E-FG-18).
  - Neither product makes a person accept a proposal before the canvas changes: observed for Figma's agent (E-FG-18); for Claude Design, its documentation describes generation straight onto the canvas (E-CD-08), and its editor was not observed.
  - Ninerr's agents already edit through MCP.
- **Decision:**
  - Built-in generation is a client of contract v2 (`outline`, `design_system`, `apply_operations` with `dryRun` and `baseRevision`), with no private write path.
  - **Revised on 2026-10-18 from the first draft:** a turn applies directly, as **one attributed transaction**, and its reply offers "Undo agent change" with the revert preview (T11.9). This is what Figma's agent was observed to do (E-FG-18), and what Claude Design documents (E-CD-08). `propose_change` is used when the person turns on review mode, and always for a turn that removes layers or was started from layer text or a comment.
  - Before a turn commits, its dry run is checked against the design system: values that bypass an existing token or component are reported to the agent, which fixes them (after E-CD-09).
  - The model provider is configured by the person.
  - With none configured, generation is off, and Ninerr makes no network request for it.
  - The provider endpoint must be https or loopback, and agents cannot change it: it is a setting only the person edits.
  - The settings state what document content is sent.
  - Layer text and comments are untrusted prompt input. A turn started from them, rather than from the person's own prompt, arrives as a proposal the person reviews (T15.3).
- **Consequences:**
  - Generation inherits attribution, approval, undo, staleness checks and the accessibility audit of every turn's result.
  - The offline guarantee holds whenever generation is off. When on, the provider's endpoint is the only allowed outbound destination, named in the network policy (`packages/network-policy`).
