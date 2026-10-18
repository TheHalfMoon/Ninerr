# Paper Desktop (paper.design): study record, 2026-10-18

Method and boundaries: [INDEX](INDEX_2026-10-18.md). Experiment records E-PD-01 to E-PD-14: [EVIDENCE](EVIDENCE_2026-10-18.md#paper-desktop).

**Application:**
- Paper Desktop, through the MCP server its desktop app runs while a file is open.
- Its documentation (paper.design/docs/mcp, paper.design/docs/support) describes the server as an authenticated API that lets an agent "read and write to your design files", and says it starts with the desktop app once a file is open. Other observers give its local endpoint as `127.0.0.1:29979` (secondary).
- **Host:** Windows 11, observed through Claude Code.
- **App version:** Paper Desktop's version is not reported by its MCP server (**unknown**).

## What the agent contract is

**Observed: the tools (E-PD-01).** This session was given 37 tools in these groups:
- **File and page:** `list_resources`, `create_file`, `open_file`, `create_page`, `update_pages`, `arrange_pages`, `rename_resource`.
- **Reading the tree:** `get_basic_info`, `get_tree_summary`, `get_children`, `get_node_info`, `get_selection`, `find_nodes`.
- **Code and styles:** `get_jsx` (Tailwind or inline styles), `get_computed_styles`, `get_fill_image`.
- **Writing:** `create_artboard`, `write_html`, `update_styles`, `set_text_content`, `rename_nodes`, `duplicate_nodes`, `move_nodes`, `delete_nodes`.
- **Tokens:** `get_tokens`, `create_tokens`, `set_tokens`.
- **Fonts:** `get_font_family_info`.
- **Output:** `get_screenshot`, `export`, `export_combined_pdf`.
- **Comments:** comment threads.
- **Agent etiquette:** `get_guide`, `finish_working_on_nodes`.

**Observed: the guide (E-PD-02).** The server ships a guide the agent must read first. It makes the agent:
- **Brief first:** post a design brief before mutating anything.
- **Write small:** write "one visual group per tool call", so a person watches the design build up.
- **Review:** take a screenshot and critique it after each section ("MANDATORY").
- **Reuse:** clone existing nodes rather than rewrite them.
- **Release:** release a per-artboard "working" indicator when done.

**Inferred:** the product treats agent edits as live, visible collaboration on the open canvas, not as a background job.

**Observed: versioned replies (E-PD-03).** Every reply carries the file's identity and a `contentHash` of its design tokens.
- The hash changed when tokens were created: `811c9dc5` became `f7dd2f3d`.
- The guide tells agents to re-read tokens when the hash changes.
- This is optimistic concurrency for tokens only. No document revision or precondition was exposed for node edits.

**Observed: input validation (E-PD-04).**
- Inputs are validated against a schema, and a schema failure rejects the whole call with nothing applied.
- `update_styles` refused `null` as a value (`expected string` or `number`), so a style is unset with `""`.
- `export` took an undocumented shape: a map of node ID to a list of `{format, scale}`, with scale a string like `"1x"`. Two calls were refused before the shape was found.

## The design model

**Observed: two component kinds (E-PD-05).** HTML written with `write_html` becomes **Frame** and **Text** nodes, plus **Rectangle** for an `<img>`.
- **Lost:** semantic tags are not kept. `h2`, `p` and `span` export as `div`.
- **Text:** a `<script>` element became an inert Text layer showing its source, and `<b>` inside a paragraph was flattened. The guide says rich text is not supported.
- **Inferred:** the document is a styled box tree with CSS semantics, not an HTML document.

**Observed: styles interpreted in context (E-PD-06).** Paper does not store raw CSS:
- **Reported:** `flexGrow` on an absolutely positioned child was dropped, and reported under `ignoredStyles`.
- **Dropped silently:** `gap` on a Text node was dropped without being reported.
- **Positioning:** making a child absolute gave its parent `position: relative`. Its text switched from `white-space: pre-wrap` to `pre`, with `width: max-content`.
  - When the absolute positioning was removed, the text settings **stayed**. A style's history leaves residue (E-PD-07).
- **Transforms:** `transform: rotate(15deg)` was stored as `rotate: 15deg` with `transform-origin: 50% 50%`.
- **Sizing:** a width on a text node added `flexShrink: 0`.
- **Accepted:** `margin` and `display: grid` were accepted and kept, though the guide tells agents not to use them.

**Observed: defaults and normalization (E-PD-08).**
- **Text defaults:** Paper fills in line heights (24 px text got 30 px; 14 px got 18 px), font fallbacks (`"Inter", system-ui, sans-serif`), `font-synthesis: none`, `overflow-wrap: anywhere` and `box-sizing: border-box`.
- **Colours:** upper-cased (`#F4F0FF`).
- **Sizing:** sizes that depend on layout are measured. The card's height followed its content (320×112).
- **Positions:** positions are `null` until measured.

**Observed: layout (E-PD-09).** Flexbox (direction, gap, padding) is the primary layout model, and artboards default to a flex column. Absolute positioning is supported.
- No constraints model was exposed.
- No "hug, fill or fixed" sizing vocabulary was exposed beyond CSS values (`fit-content`, `flex-grow`), which the guide uses.

**Observed: tokens (E-PD-10).**
- **Format:** tokens are CSS custom properties with a type (color, spacing, radius and others), and may alias other tokens (`--color-link: var(--color-accent)`).
- **Binding:** a node's style keeps a live `var(--color-ink)` reference.
- **Search:** `find_nodes` by literal colour finds both raw uses and token-bound uses.
- **Export:** CSS, Tailwind v4 `@theme`, or JSON.
- **No modes:** no token modes (themes) were exposed.

**Observed: reuse (E-PD-11).**
- **Copies only:** `duplicate_nodes` and `<x-paper-clone>` make independent deep copies, returning a map from original to new IDs.
- **Not found:** no component, instance or override concept was found through the MCP server.

**Observed: one `move_nodes` batch was not atomic (E-PD-12).** In the one case tried, `move_nodes` applied a batch in order and stopped nothing on a failure. Of three moves, two applied and the third was refused ("Target parent … (Text) cannot have children"). The reply listed per-move errors and the resulting child lists.

## Import, export and security

**Observed: hostile input (E-PD-13).**
- **Handlers and links:** `onclick` and a `javascript:` link were dropped, and so was the link's `href` altogether. Links are not modelled.
- **Remote images:** after writing two remote URLs (`https://example.com/x.png`, `https://example.com/remote.png`), the nodes referred to new file assets under `app.paper.design/file-assets/…`. **Inferred**, from those asset URLs rather than from a network capture: the remote content was fetched and copied into the file, either by the desktop app or by Paper's cloud. Which one is **unknown**.
- **Export:** PNG export wrote `Card.png` straight into the user's Downloads folder.

**Documented: Figma import (E-PD-14).** Paper's guide describes Figma import as **agent-mediated**:
- The agent reads Figma through Figma's MCP server.
- It must resolve every variable, token and Tailwind class to a literal value before writing HTML to Paper ("Unresolved references will silently fail").
- **Inferred:** design tokens do not survive a Figma import.
- The guide confirms Figma's desktop MCP serves assets from `http://localhost:3845`.

**Persistence: inferred, from observed URLs and behaviour.**
- Files live in the user's Paper team in the cloud (`app.paper.design/file/<id>`), and the desktop app opens them.
- State persisted across all calls. This study did not test closing and reopening the desktop app.
- Offline behaviour is **unknown**.

## What this means for Ninerr

- **Strengths to learn from:**
  - an agent contract written for *visible, incremental* editing, with a guide the agent must read;
  - context-aware style interpretation that tells the agent what it ignored;
  - a fast read path (tree summary, JSX in two formats, computed styles);
  - token search across raw and bound uses.
- **Weaknesses Ninerr already avoids:**
  - non-atomic batches: every Ninerr edit is one atomic transaction;
  - lost HTML semantics and links;
  - history-dependent style residue;
  - implicit network fetches on import.
- **Weaknesses Ninerr shares today, so they are gaps:**
  - no agent-supplied revision precondition: agent writes run at the current revision, `mcp.ts:592`;
  - drops reported only as a count: the renderer counts dropped values without naming them;
  - no undo tool for agents: the person can undo an agent's change, the agent cannot.
- **Gaps in Ninerr this points at:**
  - an agent guide resource;
  - an "ignored or normalized" report on every write;
  - a cheap structural summary tool;
  - a computed-styles read tool;
  - typed design tokens with aliases;
  - an agent-facing screenshot of a layer.
