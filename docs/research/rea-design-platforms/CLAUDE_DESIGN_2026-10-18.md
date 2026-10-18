# Claude Design: study record, 2026-10-18

Method and boundaries: [INDEX](INDEX_2026-10-18.md). Records E-CD-01 to E-CD-07: [EVIDENCE](EVIDENCE_2026-10-18.md#claude-design).

**Access.** The Claude Design product (Anthropic Labs, research preview) needs a signed-in Pro, Max, Team or Enterprise session. None was used, and the product was **not** exercised. Two sources were read:
1. Anthropic's announcement, "Introducing Claude Design by Anthropic Labs" (anthropic.com/news/claude-design-anthropic-labs, retrieved 2026-10-18). *Documented.*
2. The published instruction file (`SKILL.md`) of claude.ai's **"Design" artifact type**, release `1792190836-9749`, read from this session through the Artifact tool's type description.
   - That type is "a design canvas … live artboards laid out on a canvas".
   - Its format is documented by its publisher. Whether it is the same system as the Claude Design product is **unknown**, and every finding drawn from it is labelled so.

REA observed the announcement page passively. It declares no WebMCP tools (E-CD-07).

## The product, as announced (documented, E-CD-01 to E-CD-03)

- **Inputs (E-CD-01):**
  - a text prompt;
  - uploaded images and documents (DOCX, PPTX, XLSX);
  - a connected codebase;
  - a web capture tool that "grabs elements directly from a website".
- **Refinement (E-CD-02):**
  - conversation;
  - inline comments on elements;
  - direct text edits;
  - "custom sliders", adjustment controls for spacing, colour and layout that Claude makes for the design;
  - requests to apply a change across the whole design.
- **Design systems (E-CD-03):**
  - built during onboarding by reading a team's codebase and design files;
  - then applied to every project: colours, typography, components;
  - a team can keep and refine more than one.
- **Output:**
  - sharing inside the organization (private, view, or edit with group chat with Claude);
  - saving as a folder;
  - export to Canva, PDF, PPTX or standalone HTML.
- **Handoff:** a handoff bundle passed to Claude Code "with a single instruction".

## The Design artifact type's format (documented by its publisher, E-CD-04 to E-CD-06)

- **Canvas index (E-CD-04).**
  - One `project/canvas.json` holds `boards`: a frame `x`, `y`, `w`, `h` per artboard file, with options like `expand: "fill"` for fluid pages, `print`, `paper` and `is_interactive`.
  - It also holds `order` (back to front), `pages`, `notes` (titles and sticky notes), `launch` and `designSystems`.
- **Artboards (E-CD-04).** Each artboard is **one self-contained HTML file** (`.dc.html`), a "Design Component" page:
  - the markup sits inside `<x-dc>`;
  - page basics go in `<helmet><style>`;
  - one script block declares `class Component extends DCLogic` with `renderVals()`;
  - `{{hole}}` lookups (dotted lookups, "never an expression");
  - `<sc-for>`, `<sc-if>` and `<dc-import>` for repeats, branches and child components.
  - **Inline styles are what the properties panel edits.**
- **Tweaks (E-CD-05).** `data-props` declares typed levers with an editor kind and a default, for example `{"accent":{"editor":"color","default":"#666666"}}`.
  - Instruction text: "design levers are `data-props` tweaks, never widgets".
  - **Inferred:** this is the mechanism behind the announced "custom sliders". It is a typed parameter surface over one design, distinct from editing its structure.
- **Design systems (E-CD-05).** A design system is installed into the canvas: its `tokens.json` is copied under `project/ds/<folder>/`, with a record in `designSystems`. A system can expose real components through a bundle global, which artboards mount by name instead of drawing look-alikes.
- **Revisions and conflicts (E-CD-06).**
  - A person may edit an artboard by hand at any time.
  - A publish over a newer saved version is **refused** and names the file to re-read. The agent re-reads, re-applies its change and tries again, at most three times.
  - Only the files that changed are sent.
  - **Inferred:** optimistic concurrency at file granularity, with the agent's edits and the person's edits on the same files.
- **Constraints the format enforces:**
  - no network except Google Fonts and uploaded assets;
  - no `iframe`, `object` or `embed`;
  - no script-built UI;
  - no global key handlers;
  - accessible markup as drawn: real buttons, labels, `aria-label` on icon-only buttons;
  - contrast of 4.5:1.

## The observable workflow, separated from Ninerr's proposal

**What is documented or observed:**
1. A prompt, files, a codebase or a web capture goes in.
2. Claude writes or edits artboard HTML, typed levers and canvas layout, applying an installed design system's tokens and components.
3. A person refines the result by chat, comment, direct edit or lever.
4. Edits are file-granular, and a stale write is refused and redone.
5. The work is exported, shared or handed off to Claude Code.

**Not known:** the model's prompts, how intent is represented internally, how alternatives are generated, and how the product validates a design.

**Proposed for Ninerr (not observed in any product):**

> Prompt → structured design intent → validated operation batch → preview and diff → applied as one attributed transaction → revision → export.

Specified in `docs/design-platform/AGENT_CONTRACT.md`.

## What this means for Ninerr

- **Worth adopting, as Ninerr's own designs:**
  - **Design systems:** a first-class design system built *from the connected codebase*. Ninerr already reads codebases.
  - **Typed levers:** typed per-design levers that a person adjusts without structural edits.
  - **Comments:** comments anchored to layers that an agent can act on.
  - **Web capture:** capture a live page as layers. Ninerr's HTML import is the base, with Ninerr's own rule that nothing is fetched off the computer.
  - **Handoff:** a handoff bundle for coding agents.
- **Ninerr's stronger position:**
  - a typed operation model, rather than whole-file rewrites;
  - per-transaction attribution and undo;
  - an editable layer tree, rather than artboard source files;
  - offline operation.
