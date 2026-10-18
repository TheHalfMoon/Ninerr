# Cross-product comparison and Ninerr gap analysis, 2026-10-18

**Level codes:**
- **O:** observed.
- **D:** documented.
- **I:** inferred.
- **U:** unknown.
- **S:** Ninerr source-verified, at main `386a247` (code and tests read).

Evidence IDs are in [EVIDENCE](EVIDENCE_2026-10-18.md). Ninerr's column is checked against the code, with file references.

## Matrix

| Area | Paper Desktop | Figma | Claude Design | Ninerr today |
|---|---|---|---|---|
| Stored design form | styled box tree, Frame and Text, CSS semantics; HTML tags not kept (O, E-PD-05) | object tree of property maps (D, E-FG-01) | one HTML file per artboard plus a canvas index (D, E-CD-04; artifact type; link to the product unknown) | JSON node graph with HTML tag, attributes, style and text per node, schema v1 (S: `packages/document-model`) |
| Canvas and rendering | U (no window access) | U | live HTML artboards (D, E-CD-04; artifact type; link to the product unknown) | sandboxed iframe of real DOM, pan and zoom, selection, drag move and resize (S: `packages/canvas`, `packages/renderer`) |
| Layer hierarchy edits | move, reparent; batches not atomic (O, E-PD-12) | atomic parent and position property (D) | file-level edits (D, E-CD-06; artifact type; link to the product unknown) | reorder, reparent, group as one transaction each (S: #352) |
| Geometry and transforms | rotate stored as `rotate` (O, E-PD-06) | full transform set (D) | inline styles (D) | style-driven; no rotate handle; nudge and resize (S) |
| Snapping and guides | U | D (product) | `guides` per board (D, E-CD-04; artifact type; link to the product unknown) | none (S) |
| Vector editing | SVG import (I) | pen, booleans, masks (D, product) | inline SVG (D) | `vector` type reserved; renderer draws SVG; no path editing (S) |
| Layout engine | CSS flex; grid accepted (O, E-PD-09) | Auto Layout, a flex subset with hug, fill and fixed; constraints (D, E-FG-02) | CSS flex and grid (D) | CSS via styles; no layout controls or hug/fill vocabulary; no constraints (S) |
| Components | copies only (O, E-PD-11) | components, variants, typed properties, overrides (D) | design-system components mounted by name (D, E-CD-05; artifact type; link to the product unknown) | `component-definition` type reserved and unused; `design-components` contracts, variants and drift not wired (S) |
| Design tokens | typed CSS variables with aliases; no modes seen (O, E-PD-10) | variables, collections, modes (D) | installed `tokens.json` (D, E-CD-05; artifact type; link to the product unknown) | `token-reference` type reserved; imported stylesheets kept; no token UI (S) |
| Typography | font lookup tool; defaults filled in (O) | D | brand references (D) | inspector fields for font size and text colour; no font family control or font lookup (S: `STYLE_FIELDS`, app.mjs) |
| Persistence | cloud file (I) | server-authoritative (D) | files with conflict refusal (D, E-CD-06; artifact type; link to the product unknown) | local journal plus snapshots, crash recovery, migrations (S) |
| Undo and redo | not through MCP (O) | per client (D) | U | attributed per actor; Undo agent change (S: #350) |
| AI design creation | through external agents over MCP (O) | Figma Agent, `use_figma` (D) | built in: prompt, comments, levers (D) | through external agents over MCP; no built-in generation, no proposal or preview (S) |
| Agent contract | 37 tools; schema validation; token hash; partial batches (O) | about 32 tools; plugin code, no documented atomicity (D) | file writes with optimistic concurrency (D, E-CD-06; artifact type; link to the product unknown) | 16 tools; typed operations; atomic attributed transactions; person approval for deletes; no agent revision precondition (S: `mcp.ts:592`) |
| Design to code | JSX in two formats (O) | `get_design_context`, Code Connect (D) | handoff bundle (D) | JSX export; code-component import; three-way write-back with conflicts (S) |
| Code to design | U | `generate_figma_design`, `html_to_figma` (D) | codebase onboarding, web capture (D) | HTML and stylesheet import; JSX import (S) |
| Prototyping | U | D (product), motion context (D) | `is_interactive` boards (D, E-CD-04; artifact type; link to the product unknown) | `interaction` type reserved; none (S) |
| Collaboration | live canvas with agent indicators (O) | multiplayer (D) | org sharing, group chat (D) | single writer per project folder; `@ninerr/collaboration` attributes and authorizes each edit in one host, with no multi-user sync (S: session.ts) |
| Export | PNG to Downloads; PDF (O) | assets, code (D) | PDF, PPTX, HTML, Canva (D) | code only; no image or PDF export (S) |
| Offline | U | offline with reapply (D) | U (cloud) | fully offline; nothing leaves loopback (S: web-mode tests) |
| Security on import | fetches remote URLs (O, E-PD-13) | U | no network but fonts and uploads (D, E-CD-04; artifact type; link to the product unknown) | sanitized, offline, sandbox without scripts; trust checks (S) |
| Accessibility | U | U | accessible markup rules (D, E-CD-04; artifact type; link to the product unknown) | `auditAccessibility` gate on the editor UI and exports (S) |

## Gap analysis: what Ninerr lacks, and why it matters

Ranked by user value for a professional design editor, then by architectural compatibility. A lower complexity number means simpler.

| # | Gap | Justified by | Value | Complexity (1–5) | Fits the current architecture | Risk |
|---|---|---|---|---|---|---|
| 1 | Agent edits read a revision and can be checked first: revision preconditions, dry-run proposals with a diff, a report of normalizations | E-PD-03, E-PD-04, E-PD-06, E-PD-12; E-FG-05; E-CD-06 | very high: safety of AI editing | 2 | yes: `session.edit` already takes a `baseRevision` | low |
| 2 | Layout controls: flex direction, gap, padding, alignment, wrap; hug, fill and fixed sizing; constraints | E-FG-02, E-PD-09 | very high | 3 | yes: these map to CSS the renderer already draws | low |
| 3 | Components and instances with typed properties, variants and overrides | E-FG-02, E-CD-05; S: reserved type | very high | 4 | yes, through new node props and history operations | medium: migrations |
| 4 | Design tokens with collections, modes and aliases; bound per property | E-PD-10, E-FG-02, E-CD-05 | high | 3 | yes: CSS custom properties | low |
| 5 | Snapping, smart guides, alignment and distribution, rotation handles | inferred: a professional-editor norm; not evidenced in this study | high | 3 | yes: canvas only | low |
| 6 | Agent read tools: structural outline, computed styles, layer screenshot, guide resource, design-system search | E-PD-01, E-PD-02, E-FG-04 | high | 2 | yes | low |
| 7 | Design system from the connected codebase (tokens and components) | E-CD-03, E-FG-07 | high | 4 | yes: `code-ir`, `design-components`, codebase links | medium |
| 8 | Built-in AI creation: prompt to proposal to preview to apply, selection-aware; typed levers | E-CD-01, E-CD-02, E-CD-05 | high | 4 | yes, on top of item 1; the model provider is the person's choice | medium: provider, offline |
| 9 | Vector paths: pen tool, boolean operations, masks | inferred: a professional-editor norm; not evidenced in this study | medium-high | 5 | partly: `vector` type exists; needs a geometry library | medium |
| 10 | Image, SVG and PDF export, offline | E-PD-13, E-CD-03 | medium | 2 | yes: the renderer and a browser | low |
| 11 | Layer-anchored comments that agents act on | E-CD-02 | medium | 3 | yes: a new record type, outside the document | low |
| 12 | Prototyping: interactions, states, preview | E-FG-08, E-CD-04 | medium | 4 | yes: `interaction` type reserved | medium |
| 13 | Live multi-user collaboration | E-FG-01 | medium (later) | 5 | needs a design decision; the `collaboration` package is a base | high |

## What not to copy

- **Paper Desktop:**
  - partial, non-atomic batches;
  - silently dropped styles;
  - style residue from earlier states;
  - fetching remote URLs on import;
  - dropping HTML semantics and links;
  - no undo through the agent interface.
- **Figma:**
  - arbitrary plugin code as the agent write path, with "keep a backup" as the safety model.
- **The Design artifact type's format (its link to the Claude Design product is unknown):**
  - whole-file rewrites as the edit unit. Ninerr's typed operations are finer, attributable and undoable.

## Ranked opportunities

Ranked against the plan's criteria: user value, fit with Ninerr's architecture, complexity, security, testability and critical-path position.

1. **Trustworthy agent editing.** Gap 1, then gap 6. This builds on Ninerr's strongest assets (transactions, attribution, undo, approvals), and every later AI feature depends on it.
2. **Layout and tokens.** Gaps 2 and 4. These are prerequisites for components and for generation quality, and they need only CSS.
3. **Components and code-derived design systems.** Gaps 3 and 7. These are Ninerr's distinctive position: code and design in one model.
4. **Canvas precision.** Gap 5. Professional table stakes.
5. **AI-native creation.** Gap 8. It ships once 1 to 3 exist.
6. **Vectors, export, comments, prototyping.** Gaps 9 to 12.
7. **Collaboration.** Gap 13. Deferred, with an explicit design decision first.
