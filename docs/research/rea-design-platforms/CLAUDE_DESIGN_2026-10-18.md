# Claude Design: study record, 2026-10-18

Method and boundaries: [INDEX](INDEX_2026-10-18.md). Records E-CD-01 to E-CD-13: [EVIDENCE](EVIDENCE_2026-10-18.md#claude-design).

## What the product is (documented)

Anthropic's help center settles what the first version of this record left unknown:
- **It is an artifact template** (E-CD-08). Claude Design "is one of the templates you can start an artifact from, so you can use it in any chat, in Claude Code, and from the Artifacts tab". The standalone claude.ai/design closes on 2026-12-14.
- **So the "Design" artifact type is the product's surface,** not merely a related format. It is the type this study used in Claude Code.

**Access used:**
1. Anthropic's public pages: the announcement (E-CD-01 to E-CD-03), the product page claude.com/product/design, and two help-center articles, "Get started with Claude Design" and "Set up your design system in Claude Design" (E-CD-08, E-CD-09). All were read in full on 2026-10-18.
2. **Hands-on, through Claude Code:** this session created a private Design artifact, "Ninerr REA fixture 2026-10-18", with the Artifact tool, published to it and read it back (E-CD-10 to E-CD-12).
3. **The canvas editor in the browser:** not observed (E-CD-13).

**Not published here.** The type's instruction file reaches an agent only through the Artifact tool. It is not a public document, so this record neither quotes nor summarizes it. An earlier draft did, in pull request #355, which was closed unmerged; that material never reached main. What follows is documented publicly or observed from the study's own artifact.

## Documented: how it works (E-CD-08, E-CD-09)

- **The loop:** a conversation beside a canvas. Claude generates a design on the canvas; a person refines it by chat, inline comments, or direct edits on the canvas ("drag, resize, and align elements directly"), and by "adjustment sliders Claude creates to tune spacing and color" (product page).
- **The model:** "A design is a canvas of artboards. Each artboard holds layers, such as text, shapes, and images, and a layer can hold other layers inside it."
- **Keyboard editing** is documented in detail: moving between layers, Option-arrow to move a layer or swap it with a neighbour in a row, column or grid, group and ungroup, flip, undo and redo.
- **Design systems:** built from a GitHub repository, design files, uploads or a local codebase; from Claude Code with `/design-sync`, which "reads your tokens and components directly". Claude "builds with your real design system components, checks its own output against your design system, and makes corrections before you see them". Published per organization; projects inherit the default.
- **Versions:** "Claude Design doesn't have version history yet." To keep a direction, a person asks Claude to save the current project.
- **Collaboration:** "Two or more people editing a design project at the same time is still basic and may not work reliably." Designs start private; sharing grants view, comment or edit.
- **Export:** a .zip; PDF; PPTX; Google Slides; standalone HTML; 15 named apps; handoff to Claude Code, to a local coding agent or to Claude Code on the web.
- **Known limits it documents:** comments that occasionally do not appear; lag with large codebases; adding layers by keyboard needs Claude's help.

## Observed: the artifact, from Claude Code (E-CD-10 to E-CD-12)

- **Creation (E-CD-10).** Starting from the Design type made a private artifact at version 1 with no content files of its own. The type's page and editor files are fixed on the type, not copied into the artifact.
- **Representation (E-CD-11).** The design's content is the artifact's own files: an index file and **one HTML file per artboard**, holding that artboard's whole source. (Their content was written by this session, so it shows the format the tool accepts, not what the product would generate.) The first publish (index plus one artboard) made version 2.
- **Revision (E-CD-12).** Changing one heading's text and size in the artboard file and publishing only that file made version 3. The index was kept unchanged. **Inferred:** the unit of an agent edit is a whole artboard file, and each publish is a new version of the artifact. Help-center wording ("no version history yet") suggests these versions are not yet offered as history in the product.
- **Declared capabilities:** each publish result lists the capabilities the artifact declares, among them comments and downloads. **Inferred:** comments are an artifact-platform feature the canvas builds on.

## Not observed (E-CD-13)

The canvas editor in a browser needs a signed-in claude.ai session, and none was available while the study ran: the browser pane stayed on the sign-in page. So these were **not observed**: how direct canvas edits are written back, whether a stale save is refused, how chat refinements are applied, and the product's own generation. They are unknown here, and the plan relies on none of them. A follow-up can run them in the study's artifact.

## What this means for Ninerr

- **Worth adopting, as Ninerr's own designs:**
  - a design system built **from the connected codebase**, with generated output **checked against it** before a person sees it (E-CD-09): Ninerr reads codebases and has `design-components` drift detection to build on (T13.5, T15.2);
  - **adjustment levers** generated for one design (product page): T15.4;
  - **comments on elements** an agent acts on (E-CD-08): T15.3;
  - **handoff** to coding agents: Ninerr's code export and write-back already go further, from the code side.
- **Differences, not advantages:** Claude Design edits whole artboard files and versions the artifact; Ninerr edits typed operations on a layer graph with attributed transactions. Which serves people better was not measured, so no claim is made. Claude Design documents no version history and basic multi-person editing; Ninerr has attributed history and is single-writer.
