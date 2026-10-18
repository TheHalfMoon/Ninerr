# Reuse, sources and licensing (proposal)

Status: proposal, not approved ([README](README.md)).

- **Proprietary products:** no code, asset, format or design of the studied products is adopted. They are studied as behaviour only (the records, `docs/research/rea-design-platforms/`).
- **Donors:** Ninerr's donor ledger (`docs/DONORS.md`) and the license register (`docs/provenance/LICENSE_REGISTER.json`) stay as they are. No retired donor material comes back.
- **Adopting a library:** it goes through the existing process:
  - an exact pin;
  - a `LICENSE_REGISTER.json` entry and `THIRD_PARTY_NOTICES.md`;
  - `scripts/license-policy.json`;
  - the SBOM (`scripts/sbom.mjs`);
  - its own reviewed PR.

## Reuse inside Ninerr first

| Need | Existing part | How it is reused |
|---|---|---|
| Atomic edits, inverses, undo | `packages/history` (`applyTransaction`, `applyCommittedTransaction`) | every new feature emits history operations; dry runs apply to a copy |
| Validation | `packages/document-model` (`validateNodes`, `changedPartIsValid`) | extended for the schema v2 node types |
| Drawing, sanitizing | `packages/renderer` (`planElement`, attribute and style allowlists; the shorthand order of open PR #354, if merged) | instances and tokens expand inside the plan; export reuses it |
| Canvas interaction | `packages/canvas` (`mountCanvas`, `setStyle`, `insertNode`, `reorder`) | snapping and rotation are added to it |
| Attribution, access | `@ninerr/collaboration` (used by `session.ts`) | proposals and agent writes keep using it |
| Agent surface | `packages/studio-host/src/mcp.ts`, `packages/mcp-protocol` | contract v2 is an extension, not a new server |
| Code components | `packages/design-components` (contracts, variants, drift), `packages/code-ir`, `codebase.ts` | component definitions bound to code; design system from the codebase |
| Stylesheets | the frame stylesheet path (#283, #299): sanitizer, scoping, budget | the compiled token sheet goes through it |
| Accessibility | `packages/design-assurance` (`auditAccessibility`) | audits every new panel and each generated proposal |
| Code export and write-back | `code.ts` (`exportJsx`), `codebase.ts` (three-way write-back) | instances export as component usage; tokens as CSS variables |

## Open-source candidates

Versions and licenses were read from the npm registry on 2026-10-18. Each must be re-verified at adoption.

| Package | Version | License | Use | Decision |
|---|---|---|---|---|
| `fractional-indexing` (rocicorp) | 4.0.0 | CC0-1.0 | child order keys, only if live multi-user editing is approved (P16) | **defer**; not needed for the single writer |
| `culori` | 4.0.2 | MIT | colour parsing, conversion and contrast for the tokens panel and the colour picker | **adopt in P13**, if the browser's `CSS.supports` and native colour functions are not enough (measure first) |
| `polybooljs` | 1.2.2 | MIT | boolean operations on paths (union, intersect, difference, xor) | **candidate for P16** (T16.3); evaluate against `clipper2-js` |
| `clipper2-js` | 1.2.4 | Boost Software License 1.0 | polygon clipping and offsetting (strokes to outlines) | **candidate for P16** (T16.3); BSL-1.0 needs a license-policy entry |
| `yoga-layout` | 3.2.1 | MIT | a flexbox engine outside the browser | **rejected**: the canvas and export are a real browser, and a second layout engine could disagree with it (ADR-0002) |
| `ajv` | 8.20.0 | MIT | JSON Schema validation of MCP inputs | **rejected for now**: `packages/mcp-protocol` already validates tool input; adopt only if v2 schemas outgrow it |

## Built in Ninerr, with no library

Snapping and guides, the hug/fill/fixed and constraint mapping, instance expansion, token compilation, proposals and dry runs:
- each is small, specific to Ninerr's model, and testable as a pure function;
- a library would add a second model to keep in sync.
