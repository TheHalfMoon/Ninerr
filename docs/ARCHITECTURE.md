# Ninerr Architecture

This document defines Ninerr's architectural boundaries.

## Packages today

The repository has 26 packages under `packages/`: `agent-events`, `agent-runtime`, `agent-supervisor`, `agent-workspace`, `architecture`, `canvas`, `code-ir`, `collaboration`, `decision-assurance`, `decision-router`, `delivery-governance`, `design-assurance`, `design-components`, `design-method`, `desktop`, `document-model`, `history`, `import-stack`, `intake`, `mcp-protocol`, `network-policy`, `persistence`, `renderer`, `studio-host`, `studio-web`, `visual-git`. `README.md` describes the main subsystems, and the architecture catalog in `packages/architecture` records every one.

## Target layout

The packages do not follow the target tree below one for one; the architecture catalog in `packages/architecture` names each subsystem's actual owner and records which subsystems are implemented, which are stubs (a delivered slice with planned work), and which are planned.

```text
apps/
  studio-web/        browser editor
  desktop/           native shell and local integrations
  mcp/               local/remote agent protocol host
  collab-server/     optional self-hosted collaboration service
  docs/              product/developer documentation

packages/
  document-model/    canonical versioned design graph
  document-codec/    deterministic serialization + migrations
  renderer/          HTML/CSS/SVG/media rendering
  canvas/            viewport, selection, transforms, snapping
  layout/            CSS layout semantics and constraints
  text/              rich text and typography model
  assets/            image/font/media asset graph
  components/        props, variants, slots, states
  tokens/            CSS variables, themes, design tokens
  history/           transactions, undo/redo, checkpoints
  persistence/       local and server storage adapters
  collaboration/     CRDT/operation transport abstraction
  code-ir/           canonical bridge between design and source ASTs
  code-adapters/     React/CSS/Tailwind/etc. adapters
  code-sync/         three-way reconciliation and patch generation
  importers/         DOM/URL/repository intake
  exporters/         code/image/video/document exports
  agents/            agent transactions, roles, attribution, policies
  mcp-protocol/      Ninerr MCP tools/resources
  plugins/           capability/plugin contracts
  security/          sandbox, sanitization, capability policy
  visual-diff/       image/node/layout diff engine
  test-fixtures/     canonical round-trip and adversarial fixtures
```

## Canonical document graph

Every editable object has a stable ID and versioned typed node representation. Rendering must never be the only source of truth.

Minimum concepts:
- document;
- page;
- frame;
- group;
- element;
- text;
- vector;
- image/media;
- code-component instance;
- component definition;
- token/theme reference;
- interaction/state;
- asset reference;
- source binding.

Node mutations occur only through transactions. Transactions are the common unit for undo/redo, collaboration, agent attribution, visual history, and audit.

An element's own text has two shapes, and both mean the same words (#235, decided in P09). Code import keeps an element's only text in the element's own `text`. HTML import gives the element a bare text layer of its own: a text layer with no tag, attributes or style. Mixed content, text between elements, is always held in text layers. A `{…}` part of imported code is code, not words, so a layer bound to one is never an element's words. `textLayerOf` in the document model names the layer that holds an element's words; agents' layer summaries show those words too. The inspector's Text field and an agent's `set_text` edit that layer, and code export folds a bare text layer into its parent, so both shapes edit, draw and export alike.

## Rendering contract

The renderer consumes the canonical graph and produces web semantics. The model stores intent; the renderer decides concrete DOM/CSS representation.

Rules:
- stable node → DOM identity mapping;
- no renderer-only state that cannot be serialized;
- explicit sandbox boundary for imported or generated markup;
- deterministic layout test fixtures;
- browser-engine differences documented where exact parity is impossible;
- a style's shorthand applies before its own longhands, so a longhand always refines its shorthand, whatever order the entries are stored in (#294, decided in P09). Examples: `margin` before `margin-left`, `inset` before `top`, `gap` before `row-gap`. The canvas, code export and code write-back all take this order from the renderer, and every other entry keeps its place. Two exceptions follow CSS. A declaration marked `!important` wins over plain ones whatever their order, also where shorthands overlap (`border-top` and `border-color`). A logical side and a physical side, such as `inset-block` and `top`, are not paired, since the writing mode decides which side is which; a physical shorthand is refined by its logical parts (`margin-inline` after `margin`), each of which sets a subset of it.
- **a recorded limit (decided in P09, #369):** a layer's style is a set of properties, not the declarations as written. The store sorts its names and the canvas applies shorthands first, so two properties that overlap without one being the other's longhand can draw differently from their source: `border-top: 1px solid blue; border-color: red` draws a blue top where a browser draws red, and the same holds for `margin-left` and `margin-inline`. The HTML import review and code import say when a layer has such a pair among those in the overlap table; others, such as `margin-left` and `margin-inline-start`, or `white-space` and `text-wrap-mode`, are not reported. The host also has no property grammar, so it keeps the last value of a name even when a browser would reject it (`width: 100%; width: -moz-available`, #383); that case is not reported. Keeping written order would be a change to the document format, for its own design.

## Code synchronization

The core loop is:

```text
repository source
  → parser/AST adapter
  → Ninerr Code IR
  → design graph/source bindings
  → visual edits
  → graph diff
  → Code IR patch
  → AST-aware source patch
  → formatter/typecheck/tests
  → accepted repository change
```

A generated patch must preserve unrelated source formatting, comments, imports, and semantics wherever the adapter can prove a safe transformation. Unsafe transformations must produce a conflict/abstention instead of silently rewriting a file.

**Inline styles in code (#398):**
- **Import.** A `style` written as a string is read as CSS. A `style={{ … }}` object made only of literal values is read as the CSS it says: camelCase names become CSS names, and a number is in pixels except for React's unitless properties. Any other object (a spread, a name, a call, a template) stays code, and the import counts it in `layersWithStyleLeftOut`, never dropping it silently. An object style is code in the source: it is shown on the canvas, and a change to it is reported as not written back.
- **Export.** Export writes HTML-flavoured JSX: `style` is a CSS string and `class` is written as `className`. A string `style` is not valid on a React DOM element, so exported code needs its styles converted before React renders it. This is the dialect today, not a final decision.
- **The page imported code is placed in** is not part of the component. Exporting it, while it is still as import made it, exports the component inside it, so export, import, export settles. A page the person has changed, or one holding more than one layer, exports as itself.

## Agent runtime

Agents never mutate storage directly.

```text
agent/MCP client
  → auth + capability policy
  → intent/tool call
  → validation
  → transaction
  → document mutation
  → attribution + history
  → render/diff
```

Required controls:
- per-project permissions;
- read/write/tool capability scopes;
- cancellable operations;
- mutation size limits;
- explicit external-network permission;
- transaction provenance;
- rollback.

## Persistence

Persistence is adapter-based.

Local mode stores each project as files in its folder, with no service (`docs/MIGRATION.md`). A server database for collaboration would be optional, and local editing must not depend on it.

Document files include:
- schema version;
- content graph;
- asset references;
- source bindings;
- optional history checkpoints;
- integrity metadata.

## Collaboration

`packages/collaboration` has no CRDT library yet. Whatever transport is chosen must support:
- concurrent node edits;
- presence/cursors;
- offline queue/reconnect;
- conflict visibility;
- actor attribution;
- server-optional local mode.

## Studio host

Ninerr has one Node studio host (`@ninerr/studio-host`). It composes persistence, history, collaboration and network-policy, and is the single writer of an open project. It serves the editor and a loopback-only API (127.0.0.1, a per-launch token, Host and Origin checks), and it hosts the MCP endpoint and its stdio relay. Hosting MCP here keeps the persistence single-writer lock intact.

The host has one open project, and any tab or client can open another. The editor therefore names the project it shows in every request (`X-Ninerr-Project`, URI-encoded). The host refuses a change made for any other project with `409 project-changed` and writes nothing. It checks this when the change is applied, after its body has arrived (#260). An edit also carries the revision it was made at, and one made at an earlier revision is refused as `stale-revision`. Agents get the same protection through the rule in `docs/MCP.md`.

**One host per projects folder (#261).** Some files are shared by the whole projects folder:
- the connected agents (`.ninerr-agents.json`);
- the codebase links (`.ninerr-codebases.json`);
- the discovery file MCP relays read (`.ninerr-studio.json`).

Each host keeps them in memory and writes them back whole, so a host claims the folder when it starts (`.ninerr-host.lock`, holding its process id) and releases it when it closes. A second host on the same folder, for example `npm start` while the desktop app is open, refuses to start. Its message names the running one and how to reach it. A claim left by a process that no longer runs (a crash) is taken over.

Local web mode runs the host directly. The desktop shell starts the same host and owns its lifecycle, which is how the shell's "local MCP lifecycle" below is met.

## Desktop boundary

The desktop shell owns privileged operations. Today it owns:
- local filesystem and repository access, through the studio host it starts;
- the local MCP lifecycle;
- the sandboxed window that loads the host's editor, with no IPC to it;
- native menus and their shortcuts.

Planned: local fonts, secure credential storage and an update mechanism.

Web content must not receive unrestricted native capabilities.

## Security zones

1. Trusted Ninerr application code.
2. Imported/generated document content.
3. Third-party plugin code.
4. Agent clients.
5. Local filesystem/repositories.
6. External network/services.

Every crossing requires an explicit interface and capability decision. Imported HTML, SVG, CSS, and remote assets are treated as untrusted.

## Architecture acceptance tests

- deterministic serialization (`tests/document-serialization.test.mjs`);
- the 10,000-node edit and render budget (`tests/editor-performance.test.mjs`, `tests/performance-budgets.test.mjs`);
- undo and redo transaction properties (`tests/history-properties.test.mjs`);
- the malicious import corpus (`tests/malicious-corpus.test.mjs`);
- design to code to design round trips (`tests/code-ir.test.mjs`, `tests/code-workflow.test.mjs`);
- agent transaction attribution (`tests/mcp-server.test.mjs`);
- offline persistence and recovery (`tests/crash-recovery.test.mjs`, `tests/offline-guarantee.test.mjs`);
- source patch non-interference (`tests/codebase.test.mjs`);
- a collaboration convergence test, once a collaboration transport is chosen.
