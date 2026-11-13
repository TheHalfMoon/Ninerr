# Decisions pending the founder, 2026-11-13

Every product item that needs no decision is built and merged (`docs/COMPLETION_LEDGER.md`). What remains on the path to `v1.0.0` waits on the decisions below. Each gives the options, what each costs, and a recommendation, so it can be answered in a line. None is taken by engineering: each changes scope, a security boundary, a network policy, a release artifact, or a third party's rights.

## 1. Responsive breakpoints (ADR-0008, proposed)

- **Question.** Accept ADR-0008 as written, change it, or leave breakpoints out of 1.0?
- **Options.** (a) Accept: width media queries drawn as container queries on each page frame, layer overrides in `props.responsive`, viewing a breakpoint resizes the page frame, export writes media queries. (b) Change the storage (for example, overrides in the page stylesheet only). (c) Leave out of 1.0: imported pages' own `@media` rules keep drawing as they do today.
- **Cost.** (a) or (b) is a schema addition and an editor feature of several pull requests. (c) costs nothing now.
- **Recommendation.** (a), after 1.0 unless a dogfooded page needs it sooner: nothing in P10 requires breakpoints, and the design is ready when they are wanted.

## 2. PDF export

- **Question.** Where does an exported PDF go?
- **Options.** (a) A host route writes export files into the project's folder (`<project>/exports/`), size-capped, path-checked, never outside it. (b) Printing: the editor opens the system print dialog on the layer's HTML page, and the person saves it as PDF. (c) No PDF in 1.0: PNG and SVG copy to the clipboard (#439).
- **Cost.** (a) adds a write path to the host, inside the folder it already owns; the desktop's refusal of downloads stays. (b) needs the desktop's print permission and gives a print-quality, not exact, PDF. (c) costs nothing.
- **Recommendation.** (c) for 1.0, then (a): exports in the project folder are what a designer expects, and the boundary it adds is small and contained.

## 3. #349, the Windows trusted write

- **Question.** Which fix, if any, before 1.0?
- **Options.** (a) Rename the private replacement through its handle (`SetFileInformationByHandle`), adding one function to the pinned kernel32 list. (b) Refuse a projects folder that other accounts can change. (c) Keep it as it is: the swapped file is refused on the next trusted read, so it fails closed.
- **Cost.** (a) one FFI function and its test; (b) refuses some real folders (a shared drive root) that work today; (c) nothing, with a recorded limit.
- **Recommendation.** (a): it closes the gap without refusing anyone's folder, and the boundary grows by one well-understood call.

## 4. Host network access (registry fetching, #405)

- **Question.** May Ninerr fetch component registries (shadcn and the others) over the network?
- **Options.** (a) Yes, per request, through the existing network policy (allowlisted hosts, person's confirmation, recorded). (b) No: items come only from files the person chooses, as today.
- **Recommendation.** (b) for 1.0, keeping its offline guarantee (P10-4: nothing leaves loopback); (a) after, behind the policy that already exists.

## 5. A live React preview runner (#405)

- **Question.** Run components' own code to preview them?
- **Options.** (a) A sandboxed runner (no network, its own process) for previews only, never the canvas. (b) No: previews stay the static rendering the canvas draws.
- **Recommendation.** (b) for 1.0. Running third-party code is the largest boundary change on this list and is not needed for any P10 criterion.

## 6. The Electron LGPL corresponding source (P10-3, #139)

- **Question.** How is Chromium and Electron's corresponding source provided, given its size?
- **Options.** (a) A written offer (LGPL §6), with the exact versions and how to request the source. (b) A separate mirror of the source for the pinned versions. (c) A scoped archive alongside the release.
- **Recommendation.** (a), the route the license provides for exactly this case, recorded in `THIRD_PARTY_NOTICES.md`, with the pinned versions already in the release manifest.

## 7. Aceternity UI and 21st.dev

- **Question.** Seek the publishers' written permission, or leave them out?
- **Recommendation.** Leave them out of 1.0. The other sources, Astryx first, are integrated; ask the publishers when there is time.

## 8. Parity dispositions (P10-5)

- **#79 remainder.** Token tiers beyond collections, modes and aliases, and a Tailwind config as a drift source. Recommendation: dispose as covered: aliases give semantic tiers, and drift against CSS custom properties is built (#452); Tailwind configs are JavaScript and would need running code.
- **#78.** States bound to source in the P05 `design-components` library, which no product surface uses. Recommendation: dispose as superseded by ADR-0005's component properties (variants bound to classes).

## 9. The candidate and the release

- **Name the candidate commit** when the decisions above are taken; engineering then runs P10 on it: the full suite on three platforms, smoke, packaged journeys, the dogfooding, and the qualification records.
- **Founder-only steps:** the reference-machine performance runs, a clean-machine install, a real screen-reader pass (#376), then the `v1.0.0` tag and publishing, after the release gate.
