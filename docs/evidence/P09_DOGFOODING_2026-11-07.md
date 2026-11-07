# P09: dogfooding rerun after the code-part changes

Master plan, P09 preamble: the dogfooding journeys it affects are run again. Method, authorization and projects: `P08_G11_DOGFOODING_2026-10-11.md`. The same pinned commits were used. The earlier record is `P09_DOGFOODING_2026-11-06.md`.

**Status: run, with no failed check on any of the seven projects.** Journey D is unsupported on excalidraw, sb-admin-2 and shadcn-ui, as the results below say. This is not a release qualification.

- **Ninerr commit:** `38c9254`, which is main `48f132b` with this driver. All seven results record a clean tree. This record itself is on a later commit.
- **Machine:** Windows 11, 13th Gen Intel i5-13420H, 8 cores and 12 threads, 16 GiB, Microsoft Edge. One run per project, one after another. No macOS or Linux run. Other test runs shared the machine during this one, so its timings are not a budget measurement.
- **What it drives:** the editor from source, against a studio host started as `npm start` starts it, not an installed application. That is P10's work.

## Why it was run again

A rerun at `48f132b` stopped on six of seven projects. The cause was the driver, not the product: it chose `{…}` code parts as the text to edit, which #380 and #385 now refuse, because such an edit never reached the source. So the passes at `dd01709` on code-only layers were passes on behaviour since removed, and these merges went in without a rerun.

## What changed in the journeys

- **B and E** choose layers that hold no code.
- **E** also checks that an agent's edit of a code part is refused and changes nothing.
- **A project with no words:** shadcn-ui's components hold only `{…}` parts, so B and E run there on a text layer the driver inserted, and its result says so. They do not exercise its own text.
- **F** accepts one refusal, by the founder's decision on #377: `project-changed` on `POST /api/selection`. The driver reads that answer and reports it. It also records refused `GET /api/document` and `GET /api/history` answers with their bodies, and those stay errors.

## #377

No refusal of any kind occurred in these seven runs. sb-admin-2, which failed 3 of 4 runs before, has now passed journey F in 15 runs on a driver that routes these requests. That does not show the race is gone, since the routing may have shifted its timing. #377 stays open, and its 409s have not been seen with bodies in this journey.

| Project | Ninerr commit | A | B | C | D | E | F | Findings | Run |
|---|---|---|---|---|---|---|---|---:|---|
| starter-blog | `38c9254` | pass 11/11 | pass 22/22 | pass 7/7 | pass 7/7 | pass 10/10 | pass 5/5 | 1 | complete |
| commerce | `38c9254` | pass 11/11 | pass 22/22 | pass 7/7 | pass 7/7 | pass 10/10 | pass 5/5 | 1 | complete |
| shadcn-ui | `38c9254` | pass 11/11 | pass 23/23 | pass 7/7 | unsupported 0/0 (1 n/a) | pass 10/10 | pass 5/5 | 1 | complete |
| sb-admin-2 | `38c9254` | pass 8/8 (4 n/a) | pass 22/22 | pass 7/7 | unsupported 0/0 (1 n/a) | pass 9/9 | pass 5/5 | 1 | complete |
| excalidraw | `38c9254` | pass 11/11 | pass 22/22 | pass 7/7 | unsupported 0/0 (1 n/a) | pass 10/10 | pass 5/5 | 1 | complete |
| taxonomy | `38c9254` | pass 11/11 | pass 22/22 | pass 7/7 | pass 7/7 | pass 10/10 | pass 5/5 | 1 | complete |
| bulletproof-react | `38c9254` | pass 11/11 | pass 22/22 | pass 7/7 | pass 7/7 | pass 10/10 | pass 5/5 | 1 | complete |

**Not applicable:**
- shadcn-ui, D: write back two independent text fields: no component brought in has two unchanged texts, one written once in its file (0 unchanged bound texts)
- sb-admin-2, A: index.html: its 1 stylesheet(s) on other sites: not fetched: an import reads only the files chosen with the page
- sb-admin-2, A: tables.html: its 1 stylesheet(s) on other sites: not fetched: an import reads only the files chosen with the page
- sb-admin-2, A: cards.html: its 1 stylesheet(s) on other sites: not fetched: an import reads only the files chosen with the page
- sb-admin-2, A: login.html: its 1 stylesheet(s) on other sites: not fetched: an import reads only the files chosen with the page
- sb-admin-2, D: write back to source: an HTML import is not linked to its file; write-back is for a connected codebase's JSX and TSX
- excalidraw, D: write back two independent text fields: no component brought in has two unchanged texts, one written once in its file (0 unchanged bound texts)

| Project | Source files read | Components found | Brought in | Refused | Refusal reasons |
|---|---:|---:|---:|---:|---|
| starter-blog | 42 | 47 | 46 | 1 | 1 × a component does not return a JSX element Ninerr can read |
| commerce | 45 | 44 | 40 | 4 | 4 × a component does not return a JSX element Ninerr can read |
| shadcn-ui | 61 | 327 | 327 | 0 |  |
| excalidraw | 181 | 210 | 183 | 27 | 27 × a component does not return a JSX element Ninerr can read |
| taxonomy | 98 | 169 | 165 | 4 | 4 × a component does not return a JSX element Ninerr can read |
| bulletproof-react | 78 | 99 | 98 | 1 | 1 × a component does not return a JSX element Ninerr can read |

**Findings recorded by the runs:**
- starter-blog (ux): after a change committed by leaving an inspector field, Ctrl+Z in the next field is that field's text undo, not Undo
- commerce (ux): after a change committed by leaving an inspector field, Ctrl+Z in the next field is that field's text undo, not Undo
- shadcn-ui (ux): after a change committed by leaving an inspector field, Ctrl+Z in the next field is that field's text undo, not Undo
- sb-admin-2 (ux): after a change committed by leaving an inspector field, Ctrl+Z in the next field is that field's text undo, not Undo
- excalidraw (ux): after a change committed by leaving an inspector field, Ctrl+Z in the next field is that field's text undo, not Undo
- taxonomy (ux): after a change committed by leaving an inspector field, Ctrl+Z in the next field is that field's text undo, not Undo
- bulletproof-react (ux): after a change committed by leaving an inspector field, Ctrl+Z in the next field is that field's text undo, not Undo

| Step | starter-blog | commerce | shadcn-ui | sb-admin-2 | excalidraw | taxonomy | bulletproof-react |
|---|---:|---:|---:|---:|---:|---:|---:|
| host start | 115.2 ms | 198 ms | 72.4 ms | 92.3 ms | 106.1 ms | 170.6 ms | 52.5 ms |
| editor open | 418.9 ms | 910.1 ms | 457 ms | 630.8 ms | 541.7 ms | 637.1 ms | 317.7 ms |
| codebase connect and scan | 506.9 ms | 2175.8 ms | 938 ms |  | 1573.6 ms | 928.1 ms | 760.3 ms |
| bring in (every component, host API) | 40.5 / 116.1 / 143 ms (n 47) | 95.5 / 180.3 / 314 ms (n 44) | 37.1 / 65.4 / 141.3 ms (n 327) |  | 47.2 / 90.8 / 155.6 ms (n 210) | 47 / 98.2 / 221 ms (n 169) | 36.6 / 114.2 / 231.5 ms (n 99) |
| bring in (editor) | 212.6 / 258.5 / 258.5 ms (n 3) | 286.1 / 317.9 / 317.9 ms (n 3) | 200.2 / 233.7 / 233.7 ms (n 3) |  | 283.8 / 364.7 / 364.7 ms (n 3) | 251.1 / 280.3 / 280.3 ms (n 3) | 405.3 / 422.9 / 422.9 ms (n 3) |
| edit text (inspector) | 136.9 ms | 209.2 ms | 97.4 ms | 237.2 ms | 182.9 ms | 239.3 ms | 226 ms |
| edit style (inspector) | 82.9 ms | 185.8 ms | 79.3 ms | 150.5 ms | 113.1 ms | 212.5 ms | 224 ms |
| insert box | 105 ms | 184 ms | 56.8 ms | 143.3 ms | 114.1 ms | 171.2 ms | 349 ms |
| move (drag) | 166.9 ms | 339.1 ms | 132 ms | 313.2 ms | 161.3 ms | 288.7 ms | 517.1 ms |
| resize (drag) | 120.4 ms | 408.1 ms | 121.7 ms | 256.6 ms | 234.9 ms | 256.9 ms | 632 ms |
| reorder (keyboard) | 50.7 ms | 124.8 ms | 37.4 ms | 101.5 ms | 80.3 ms | 134.1 ms | 159.8 ms |
| move into another layer (keyboard) | 41.3 ms | 135.4 ms | 36.1 ms | 117.3 ms | 56.9 ms | 54.3 ms | 163.2 ms |
| reorder (pointer) | 226.3 ms | 391.3 ms | 178.4 ms | 259 ms | 290.8 ms | 198.7 ms | 557.2 ms |
| group (keyboard) | 75.6 ms | 178.2 ms | 54.1 ms | 583.1 ms | 113.2 ms | 97.9 ms | 218.6 ms |
| edit classes (inspector) | 178.3 ms | 186.7 ms | 101.5 ms | 222.9 ms | 199.5 ms | 112.3 ms | 438 ms |
| undo | 50.9 / 59.4 / 59.4 ms (n 6) | 111.8 / 161.8 / 161.8 ms (n 6) | 72.5 / 162.8 / 162.8 ms (n 6) | 80.5 / 113.1 / 113.1 ms (n 6) | 59.4 / 98.9 / 98.9 ms (n 6) | 57.6 / 245.1 / 245.1 ms (n 6) | 98.2 / 148.4 / 148.4 ms (n 6) |
| redo | 63.9 / 65.3 / 65.3 ms (n 6) | 122.5 / 189.7 / 189.7 ms (n 6) | 57.3 / 73.6 / 73.6 ms (n 6) | 106.2 / 129.3 / 129.3 ms (n 6) | 54.2 / 67.2 / 67.2 ms (n 6) | 42.7 / 79.2 / 79.2 ms (n 6) | 132.2 / 201.8 / 201.8 ms (n 6) |
| edit text (inspector, repeated) | 182.9 / 214.1 / 214.1 ms (n 10) | 332.8 / 390.2 / 390.2 ms (n 10) | 167.3 / 202.6 / 202.6 ms (n 10) | 470.6 / 621.2 / 621.2 ms (n 10) | 168.7 / 215.2 / 215.2 ms (n 10) | 218.8 / 2827.8 / 2827.8 ms (n 10) | 370.5 / 518.3 / 518.3 ms (n 10) |
| undo (repeated) | 95.3 / 197.6 / 197.6 ms (n 10) | 191.6 / 397.9 / 397.9 ms (n 10) | 78.9 / 114 / 114 ms (n 10) | 119.7 / 178.2 / 178.2 ms (n 10) | 103.7 / 136.1 / 136.1 ms (n 10) | 117.5 / 155.1 / 155.1 ms (n 10) | 223.1 / 272.9 / 272.9 ms (n 10) |
| save | 54.5 ms | 85.2 ms | 43.8 ms | 93.6 ms | 53.4 ms | 111.3 ms | 171.3 ms |
| close project | 13 ms | 28.3 ms | 10.2 ms | 16.6 ms | 15.1 ms | 51.8 ms | 76.7 ms |
| reopen (editor) | 299 ms | 527.2 ms | 272.6 ms | 1083.3 ms | 417.5 ms | 294.9 ms | 485.9 ms |
| write-back review | 431.9 ms | 666.4 ms |  |  |  | 580.8 ms | 994.2 ms |
| write-back write | 235.7 ms | 279.1 ms |  |  |  | 187.9 ms | 446.3 ms |
| conflict: take the file's | 233.2 ms | 184.4 ms |  |  |  | 150.7 ms | 531.5 ms |
| mcp project_info | 12.3 ms | 9.3 ms | 13.8 ms | 29 ms | 40.1 ms | 9.9 ms | 37.6 ms |
| mcp layer_tree | 7.9 ms | 8.8 ms | 9.1 ms | 47 ms | 30.9 ms | 13.8 ms | 29.4 ms |
| mcp find_layers | 10.4 ms | 6.5 ms | 10.6 ms | 56.1 ms | 21.6 ms | 10.7 ms | 38.7 ms |
| mcp set_text | 22.5 / 51.3 / 51.3 ms (n 3) | 17.5 / 37.1 / 37.1 ms (n 3) | 20.5 / 37.3 / 37.3 ms (n 3) | 15.7 / 150.1 / 150.1 ms (n 2) | 21.7 / 59.4 / 59.4 ms (n 3) | 24.2 / 40.9 / 40.9 ms (n 3) | 50.3 / 87.6 / 87.6 ms (n 3) |
| mcp move_layers | 49.9 ms | 29 ms | 25.2 ms | 69.6 ms | 54.7 ms | 74.4 ms | 136.9 ms |
| mcp delete_layers | 184.1 ms | 120.5 ms | 97.2 ms | 248.4 ms | 130.6 ms | 257.1 ms | 338.4 ms |
| import review |  |  |  | 624.9 / 809.9 / 809.9 ms (n 4) |  |  |  |
| import commit and first render |  |  |  | 695 / 1076.2 / 1076.2 ms (n 4) |  |  |  |

Machine: win32 x64, 13th Gen Intel(R) Core(TM) i5-13420H (12 threads), 16 GiB, Node v24.19.0. A step measured once shows its time; a repeated step shows p50 / p95 / max and its sample count.
