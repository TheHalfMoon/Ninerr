# ADR-0008: A page's breakpoints are its media queries, drawn as container queries on its frame

- **Status:** accepted by the founder, 2026-11-13 (`docs/provenance/FOUNDER_DECISION_2026-11-13_PENDING_BRIEF.md`), to be built after 1.0 unless a dogfooded page needs it sooner; proposed 2026-11-13.
- **Context:**
  - Every page is drawn in one canvas frame, sized to its content (`packages/canvas`). A media query in a page's stylesheet is therefore matched against that frame's width, which follows the widest page on the canvas, not against the page's own width. The renderer already draws viewport lengths against a fixed design viewport (`DESIGN_VIEWPORT`, 1024 × 768, #283) for the same reason, and leaves media queries as written.
  - A `breakpoint` token type exists (ADR-0004, schema v2), but nothing reads it yet.
  - Layout, sizing and constraints are CSS (ADR-0002). Imported pages already carry their responsive rules as `@media` in their stylesheets.
  - CSS container queries match an element's own size, so several pages in one document can each respond to their own width.
- **Decision:**
  - **A breakpoint is a `min-width` or `max-width` media query.** It is stored as CSS, in a page's stylesheet for imported pages, and for layers as `props.responsive`: a list of `{ query, style }` overrides. `query` is a breakpoint token (`var(--md)`) or a length, and `style` holds only the declarations that differ.
  - **The canvas draws each width query as a container query on its page.** The page frame gets `container: ninerr-page / inline-size`. When the renderer draws a stylesheet or a layer's overrides, it writes `@media (min-width: 768px)` as `@container ninerr-page (min-width: 768px)`. Queries that are not about width (`prefers-color-scheme`, `print`, `hover`) stay media queries, unchanged.
  - **Viewing at a breakpoint resizes the page frame.** The toolbar's breakpoint control sets the page's width for viewing (a view setting, not a document change), and the inspector edits the overrides of the breakpoint being viewed.
  - **Export writes media queries.** The HTML export writes each override and stylesheet rule as `@media`, the Tailwind export uses the matching variant (`md:`) when a breakpoint token has Tailwind's width, and the JSX export writes the overrides as a CSS module next to the component.
- **Consequences:**
  - Each page shows its own breakpoints side by side on one canvas, and what export writes behaves the same in a browser window of that width.
  - Viewport lengths keep the design viewport (#283). With a breakpoint viewed, they use the viewed width.
  - Code import reads `@media` width rules into overrides only where they apply to one layer's own declarations. Every other rule stays in the stylesheet, drawn as above.
  - Container queries need Chromium 105 or later. Electron 44 and the supported browsers have it.
  - Rejected: one canvas frame per page. It would multiply frames and their memory, and break selection and dragging across pages.
  - Rejected: evaluating media queries in JavaScript. It would need a second CSS matcher, which ADR-0002 rules out.
