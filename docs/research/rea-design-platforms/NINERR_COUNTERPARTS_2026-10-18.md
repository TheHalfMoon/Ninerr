# Ninerr counterpart experiments, 2026-10-18

Method: [INDEX](INDEX_2026-10-18.md). Records E-NX-01 to E-NX-08: [EVIDENCE](EVIDENCE_2026-10-18.md#ninerr).

A comparison needs both sides observed. Each case here runs, against Ninerr's own studio host and MCP server, a case the study ran against Paper Desktop or Figma. Where the Ninerr case is not the same operation as the competitor's, the record says so, and the comparison treats it as a difference, not as a result.

- **Script:** `scripts/research/ninerr-counterparts.mjs` starts a host in a temporary projects folder, connects two agents and runs the cases. It prints one JSON report (case C-n is E-NX-0n) and changes nothing else. It records; it asserts nothing, so it is not a test.
- **Run:** main `386a247` with this study's files added (the script itself is new), Node 24.19.0, Windows 11. The script records any `dns.lookup` of a name other than loopback and any `fetch` to one; code that imported those functions by name earlier is not covered.
- **Rerun:** `node scripts/research/ninerr-counterparts.mjs`. Cases E-NX-02, E-NX-03, E-NX-07 and E-NX-08 show gaps, and are expected to change when the proposed P11 lands.

| ID | Counterpart of | Case | Ninerr's result (observed unless marked) |
|---|---|---|---|
| E-NX-01 | E-PD-12; E-FG-15 (same case) | `move_layers` with three moves, the third a cycle | **Refused whole:** "Cannot move node … into its own subtree". Revision stayed 3; no layer moved |
| E-NX-02 | E-FG-17 (same case); E-PD-03 | agent A reads a layer at revision 3; agent B sets its background; A then sets the background | **Accepted:** A's stale write committed (revision 5, background "blue"). The tools take no revision, so no precondition is possible |
| E-NX-03 | E-PD-06, E-PD-07 (similar, not identical, styles and nodes) | `set_styles` with `position: absolute`, `flex-grow`, `gap`, `transform: rotate(15deg)` on a frame; then `position: null` | **Stored verbatim, no report:** all four kept as written; the reply lists revision and transaction only. Removing `position` removed only `position` |
| E-NX-04 | E-PD-05, E-PD-13 (**not the same path**: this is the person's HTML import; Paper's was an agent's `write_html`, and Ninerr's agents have no HTML-writing tool) | the person imports `h2`, `p`, `b`, a `javascript:` link, an `https:` link, a button with `onclick`, a remote `<img>`, a `<script>` | **A review first**, with three named warnings (unsafe URL, executable attribute, script element). Tags kept: `main`, `h2`, `p`, `b`, `a`, `button`, `img`, plus a `div`. Script, handler and `javascript:` URL removed. **Both links lost their `href`, and the image its `src`.** Source-verified (`html.ts`, the `URL_ATTRIBUTES` branch): external URLs go to the import's resource list, not onto the layer. No lookup or fetch was recorded |
| E-NX-05 | E-PD-08 (**not the same case**) | what `create_frame` stores | The tool's own fixed creation values (`tag: main`, `position: relative`, `background: #ffffff`) with the requested name and size. Nothing is added or rewritten after the write: reading the layer back returns what the tool wrote |
| E-NX-06 | E-PD-01 (no undo tool) | an agent sets a text; the person presses Undo, then Revert on the agent's change | The 16 tools include no undo. The person's **Undo** took back the person's own latest change (the HTML import of E-NX-04), not the agent's text. **Revert** of the agent's transaction removed the text, as a new attributed change |
| E-NX-07 | — (Ninerr only) | `set_text` with an extra `baseRevision: 0`; `set_styles` with the property name `"Bad Name"` | The unknown argument was **accepted and ignored**. The bad property name was refused |
| E-NX-08 | E-FG-18 (same case) | an agent creates a frame; the person renames it and, apart, another layer; the person reverts the agent's change | Revert succeeded: the frame is gone, **the person's later rename of it with it**, and the unrelated rename kept. No warning |

## What this shows

- **Same case, Ninerr better:** an invalid batch is refused whole; Paper and Figma's Plugin API applied part of one (E-NX-01; E-PD-12, E-FG-15).
- **Same case, shared weakness:**
  - a stale write is accepted with no error: Ninerr and Figma (E-NX-02, E-FG-17). Paper's write tools take no revision either (E-PD-01, E-PD-03), so it cannot refuse one (inferred; not run);
  - a revert of an agent's work silently takes later edits inside it: Ninerr and Figma (E-NX-08, E-FG-18).
- **Different operations, so differences rather than results:**
  - importing HTML: Ninerr's person-run import shows a review and recorded no fetch; Paper's agent `write_html` replaced remote images with stored copies (the fetch is inferred). Ninerr keeps tags; Paper keeps Frame and Text. Both lose link targets (E-NX-04; E-PD-05, E-PD-13);
  - what is stored: Ninerr stores what the tool wrote; Paper fills in defaults when it reads back (E-NX-05, E-PD-08);
  - context-free styles: Ninerr stores them silently; Paper reported some of the styles it ignored (E-NX-03, E-PD-06).
- **Ninerr-only gap:** unknown arguments are ignored rather than refused (E-NX-07).
