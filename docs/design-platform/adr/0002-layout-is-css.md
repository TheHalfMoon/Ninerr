# ADR-0002: Layout, sizing and constraints are CSS, not a second layout model

- **Status:** proposed, 2026-10-18.
- **Context:**
  - Auto Layout is a flexbox subset with a hug/fill/fixed vocabulary (E-FG-02). Observed: its fill sizing is flex arithmetic to the pixel, its constraints keep the margins they name, and Figma presents it as CSS flex for code (E-FG-11, E-FG-12, E-FG-19). Another product studied lays out with CSS flex directly (E-PD-09).
  - Ninerr draws real HTML and CSS in a browser.
- **Decision:**
  - Layout, sizing and constraints are stored only as CSS properties on nodes.
  - The inspector and agents use the design vocabulary as a *view*: a pure function `readLayout(style)` to `{ mode, gap, padding, align, wrap, sizing, constraints }`, and its inverse `writeLayout(...)` to CSS changes.
  - No layout engine other than the browser draws the canvas or the export. `yoga-layout` is rejected (REUSE.md).
- **Consequences:**
  - No migration, and no disagreement between a stored layout model and what is drawn.
  - The view must cover every combination it reads. CSS it cannot express in the vocabulary is shown as "custom", and left alone.
