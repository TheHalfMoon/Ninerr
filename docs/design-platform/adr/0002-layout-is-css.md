# ADR-0002: Layout, sizing and constraints are CSS, not a second layout model

- **Status:** proposed, 2026-10-18.
- **Context:**
  - Auto Layout in the studied products is a flexbox subset with a hug/fill/fixed vocabulary (E-FG-02). Another product lays out with CSS flex directly (E-PD-09).
  - Ninerr draws real HTML and CSS in a browser.
- **Decision:**
  - Layout, sizing and constraints are stored only as CSS properties on nodes.
  - The inspector and agents use the design vocabulary as a *view*: a pure function `readLayout(style)` to `{ mode, gap, padding, align, wrap, sizing, constraints }`, and its inverse `writeLayout(...)` to CSS changes.
  - No layout engine other than the browser draws the canvas or the export. `yoga-layout` is rejected (REUSE.md).
- **Consequences:**
  - No migration, and no disagreement between a stored layout model and what is drawn.
  - The view must cover every combination it reads. CSS it cannot express in the vocabulary is shown as "custom", and left alone.
