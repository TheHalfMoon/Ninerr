# DRAFT: written offer for the Electron runtime's corresponding source

**Status: the route is decided (founder, 2026-11-13: `docs/provenance/FOUNDER_DECISION_2026-11-13_PENDING_BRIEF.md`, decision 6). The offer takes effect when the project owner fills in the bracketed fields below, and ships with the first binary release. It is the owner's own commitment, for at least three years. Not reviewed by counsel; not legal advice.**

---

## Written offer

Ninerr's desktop packages include the Electron runtime, which contains components licensed under the GNU Lesser General Public License, version 2.1 or later: Blink (from WebKit), statically linked into the Electron executable, and the separately linked `libffmpeg`.

For at least three years from the date [OWNER NAME] last distributes a given Ninerr desktop package, [OWNER NAME] will give any third party who asks, for a charge no more than the cost of physically performing the source distribution, a complete machine-readable copy of the source code corresponding to the Electron runtime in that package, on a medium customarily used for software interchange or by download, under the terms of the LGPL.

The source corresponding to each package is identified exactly in `docs/provenance/ELECTRON_CORRESPONDING_SOURCE.json`, which ships with every release: the Electron version with its git commit and tree (carrying Electron's patches to Chromium), the Chromium version and its commit and tree, and the ffmpeg revision with Electron's patch to its build file.

To ask for it, write to [CONTACT ADDRESS OR EMAIL], naming the Ninerr version and platform of the package you received.

[OWNER NAME], [DATE]

---

## What adopting it would change

- `THIRD_PARTY_NOTICES.md` and the release notes carry the offer, or point to it.
- `docs/RELEASE.md`'s "Ninerr publishes no binary release yet. Before the first one, the project owner decides …" is replaced by the route chosen.
- The release gate checks that the offer ships with each desktop package, beside `ELECTRON_CORRESPONDING_SOURCE.json`.
