# Cross-product comparison and Ninerr gap analysis, 2026-10-18

Level codes: **O** observed, **D** documented, **I** inferred, **U** unknown, **S** Ninerr source-verified at main `386a247` (code read), **NX** Ninerr observed in a counterpart experiment ([NINERR_COUNTERPARTS](NINERR_COUNTERPARTS_2026-10-18.md)). Evidence IDs: [EVIDENCE](EVIDENCE_2026-10-18.md).

**The rule for every claim below:** something is "better" only when both sides were observed, or source-verified, in the **same case**. A different operation on each side is a *difference*, not a result. An undocumented or untested competitor behaviour is **unknown**, never a Ninerr advantage.

## 1. What Ninerr demonstrably does better

| Case | Ninerr | Competitor | Evidence |
|---|---|---|---|
| A batch with one invalid write | refused whole; nothing changes | Paper applied 2 of 3 moves; Figma's Plugin API kept the writes before the error | E-NX-01; E-PD-12; E-FG-15 |

One case, and a narrow one. It does not say Ninerr is the better product.

## 1a. Differences that are not same-case results

| Topic | Ninerr | Competitor | Why it is not a result |
|---|---|---|---|
| Importing HTML | the person's import: a review naming each removal; tags kept; no lookup or fetch recorded | Paper's agent `write_html`: Frame and Text only; remote images replaced by stored copies (the fetch is inferred) | different paths; Ninerr's agents cannot write HTML (E-NX-04; E-PD-05, E-PD-13) |
| What is stored | what the tool wrote, including `create_frame`'s fixed creation values | defaults filled in on read-back; style residue | different operations (E-NX-03, E-NX-05; E-PD-07, E-PD-08) |
| The unit of undo | one attributed transaction per call, reverted as a unit | Figma's Plugin API: what the caller commits (E-FG-16); Figma's agent: the whole turn (E-FG-18) | Ninerr's revert of a many-operation call was not run against either |

## 2. What competitors demonstrably do better

| Capability | Competitor | Ninerr | Evidence |
|---|---|---|---|
| Layout vocabulary: hug, fill, fixed; constraints | Figma, exact and observed | none; raw CSS fields only | E-FG-11, E-FG-12; S: `STYLE_FIELDS` |
| Components, instances, overrides, variants | Figma, observed end to end | `component-definition` type reserved, unused | E-FG-13; S: `NODE_TYPES` |
| Variables or tokens bound to properties | Figma (aliases, type checks), Paper (aliases, `var()` binding, search) | `token-reference` reserved; no token UI | E-FG-14, E-PD-10; S |
| Built-in AI creation that reuses the design system | Figma's agent reused the Button component (E-FG-18); Claude Design is documented to build with a team's real components and check its output against the design system (E-CD-09) | none built in; external agents only | E-FG-18, E-CD-09; S |
| Reporting styles that have no effect | Paper lists some ignored styles (a similar, not identical, case) | stores them silently | E-PD-06; E-NX-03 |
| Agent-facing read tools: outline, computed styles, screenshots, token hash | Paper (observed), Figma (documented) | tree, details, children, code; no computed styles or image | E-PD-01, E-FG-04; S: 16 tools |
| Image and PDF export | Paper (PNG, PDF), Figma (SVG, REST JSON, CSS observed), Claude Design (PDF, PPTX, HTML documented) | code only | E-PD-13, E-FG-19, E-CD-03; S |
| Live multi-user editing | Figma: two clients on one file, per-property last-writer-wins (a sequential stale write observed) | single writer per project folder | E-FG-17; S: session.ts |

## 3. Shared weaknesses (no one is better)

| Weakness | Who has it | Evidence |
|---|---|---|
| A stale write overwrites what the writer never saw, with no error | Ninerr and Figma (observed); Paper's write tools take no revision (inferred) | E-NX-02, E-FG-17; E-PD-01, E-PD-03 |
| Reverting an agent turn silently discards later edits inside it | Ninerr, Figma | E-NX-08, E-FG-18 |
| Link targets lost when HTML comes in | Ninerr's import (`href` and `src` go to its resource list, S: `html.ts`); Paper's `write_html` (dropped) | E-NX-04, E-PD-13 (different paths) |
| Context-free properties stored silently | Ninerr (all), Figma (`layoutGrow`) | E-NX-03, E-FG-12 |
| Unknown arguments ignored | Ninerr (not tested on the others) | E-NX-07 |

## 4. Unknown (not evidence of anything)

- Figma: whether its built-in agent's writes are atomic; its renderer, storage and offline behaviour; performance at scale.
- Claude Design: how the canvas editor writes direct edits back; whether a stale save is refused; how natural-language refinements are applied ([CLAUDE_DESIGN](CLAUDE_DESIGN_2026-10-18.md) says which of these were observed).
- Paper Desktop: its version, its undo, its offline behaviour.
- Ninerr: performance against the competitors. No competitor was measured, so no performance comparison is made.

## 5. Matrix of the areas studied

| Area | Paper Desktop | Figma | Claude Design | Ninerr today |
|---|---|---|---|---|
| Stored form | styled box tree, Frame and Text (O) | object tree of property maps (D); REST JSON (O) | an artifact of files: one index plus one HTML file per artboard, in numbered versions (O) | JSON node graph with tag, attributes, style, text; schema v1 (S) |
| Layout | CSS flex (O) | Auto Layout = flex arithmetic; constraints (O) | rows, columns and grids; drag, resize, align on the canvas (D, E-CD-08) | raw CSS; no layout controls (S) |
| Components | copies only (O) | instances with path IDs, per-field overrides, variants (O) | design-system components (D) | reserved type (S) |
| Tokens | typed, aliased CSS variables (O) | typed variables, aliases, modes (O; modes plan-gated) | design systems with tokens (D) | none (S) |
| Agent writes | 37 tools; partial batches (O) | Plugin API code; no atomicity (O) | chat, comments, direct edits (D) | 16 tools; atomic, attributed (NX) |
| Stale writes | no node revision in its tools (O); a stale write not run (I: accepted) | accepted; per-property merge (O) | U | accepted (NX) |
| Undo | not through MCP (O) | caller-committed steps; turn Undo for its agent (O) | Cmd+Z (D); "no version history yet" (D) | per actor; Revert for agents (NX) |
| HTML coming in | agent `write_html`: remote images replaced by stored copies (O); fetched (I) | U | U | the person's import: review; no lookup or fetch recorded (NX) |
| Export | PNG, PDF (O) | SVG, JSON, CSS (O) | zip, PDF, PPTX, HTML, apps (D) | code (S) |
| Offline | U | U | U (cloud) | nothing leaves loopback (NX: no lookup in any case) |

## 6. Gap analysis

Ranked by user value for a design editor, then by fit. Complexity: 1 simple to 5 hard.

| # | Gap | Evidence | Value | Complexity | Fit | Risk |
|---|---|---|---|---|---|---|
| 1 | Revision preconditions, dry runs, proposals, a report of ignored styles | E-NX-02, E-NX-03, E-NX-07; E-PD-03, E-PD-06; E-FG-17 | very high | 2 | `session.edit` already takes a revision | low |
| 2 | Layout controls: hug, fill, fixed, gap, padding, alignment, wrap; constraints | E-FG-11, E-FG-12, E-FG-19 | very high | 3 | CSS the renderer already draws | low |
| 3 | Components, instances, properties, variants, overrides | E-FG-13, E-FG-18 | very high | 4 | new node props and operations | medium |
| 4 | Tokens with aliases and modes, bound per property, cycles refused with an error | E-FG-14, E-PD-10 | high | 3 | CSS custom properties | low |
| 5 | Agent read tools: outline, computed styles, layer image | E-PD-01, E-FG-04 | high | 2 | `planElement` | low |
| 6 | Revert that shows which later edits it discards | E-NX-08, E-FG-18 | high | 2 | `session.revert` | low |
| 7 | Snapping, guides, align and distribute, rotation | professional norm; not evidenced here | high | 3 | canvas only | low |
| 8 | Design system from the connected codebase | E-CD-09, E-CD-03 | high | 4 | `code-ir`, `design-components` | medium |
| 9 | Built-in creation: one undoable transaction per turn; proposals in review mode, for removals and for comment-started turns | E-FG-18, E-CD-08 | high | 4 | on gap 1 | medium |
| 10 | Keep link targets on import (inert in the canvas) | E-NX-04 | medium | 1 | the renderer already draws `href` inertly | low |
| 11 | Image, SVG and PDF export, offline | E-PD-13, E-FG-19, E-CD-03 | medium | 2 | the editor's renderer | low |
| 12 | Layer-anchored comments agents act on | E-CD-02, E-CD-08 | medium | 3 | records outside the document | low |
| 13 | Vector paths and booleans | professional norm; not evidenced here | medium | 5 | `vector` type reserved | medium |
| 14 | Prototyping | E-FG-08 (D) | medium | 4 | `interaction` reserved | medium |
| 15 | Live multi-user editing | E-FG-17 | later | 5 | needs a decision | high |

## 7. What not to copy

- **Partial batches** (Paper, Figma's Plugin API): keep whole-transaction refusal.
- **Silent failures:** Figma's ignored alias cycle and accepted `layoutGrow`, Paper's unreported `gap` drop.
- **Dangling references:** Figma deleted a variable in use and kept the alias.
- **Fetching on import** (Paper, inferred from the stored copies).
- **Arbitrary code as the agent write path** with "keep a backup" as the safety model (Figma's `use_figma`, documented).
