# P10: dogfooding run on main after the 2026-11-13 merges

The seven-project dogfooding (P10-1) run again on main after the day's merges: the editor features (align, pages, typography, auto layout, snapping, constraints, text direction, text styles), the exports (HTML, Tailwind, PNG and SVG), the Astryx integration, the agent changes (dry runs, base revisions, new MCP tools), and the style-value fixes. Method, authorization and projects: `P08_G11_DOGFOODING_2026-10-11.md`; the same pinned commits were used.

**Status: run, with no failed check on any of the seven projects.** This is evidence toward P10-1, not its pass: P10-1 is the run on the exact candidate.

- **Ninerr commit:** `0723851` (main), driver `scripts/dogfood/run.mjs` unchanged. This record is on a later commit.
- **Machine:** Windows 11, 13th Gen Intel i5-13420H, 12 threads, 16 GiB, Node v24.19.0, Microsoft Edge. One run per project, one after another. No macOS or Linux run.
- **What it drives:** the editor from source, against a studio host started as `npm start` starts it, not an installed application.
- **Command:** `node scripts/dogfood/run.mjs <pinned sources> <work folder> <project>` for each project, with the sources fetched earlier by `scripts/dogfood/fetch.mjs` at the commits in `scripts/dogfood/projects.json`.

## Results

| Project | Pinned commit | Checks passed | Checks failed |
| --- | --- | ---: | ---: |
| starter-blog | `b45bef6` | 62 | 0 |
| commerce | `3761e52` | 62 | 0 |
| shadcn-ui | `c2a6784` | 56 | 0 |
| sb-admin-2 | `f030988` | 51 | 0 |
| taxonomy | `298a885` | 62 | 0 |
| bulletproof-react | `9506629` | 62 | 0 |
| excalidraw | `4c00f31` | 55 | 0 |

Each run's checks include journey F's "the editor raised no errors", "the canvas frame is sandboxed without scripts", "no script element reached the canvas" and "the fetched project was not written". As in P09, journey D does not apply to excalidraw, sb-admin-2 and shadcn-ui, which the driver marks as not applicable rather than passed.

## #377

The intermittent `409` from `POST /api/selection` did not occur: journey F passed on all seven, including sb-admin-2, where it was seen in 2 of 7 runs before. The driver now records each refusal with its body, so a later occurrence names its cause. One clean run does not settle an intermittent issue; #377 stays open for the candidate's run.

## Logs

The full per-project output, with each check and the timings of each step, is kept on the machine that ran it (`p10-0723851-<project>.log` in the dogfooding folder), as for the P09 runs.
