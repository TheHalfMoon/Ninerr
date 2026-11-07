# Ninerr Deep REA: Craft Anything Multi-Viewport Capture Ledger
Date: 2026-11-06
Status: **observed public-site capture evidence**. This does not qualify a logged-in editor, paid feature, source-code extraction, or functional parity.
Toolchain: Windows, OpenCode v2.2.5, DeepSeek `opencode/deepseek-v4.1-flash-free`, Craft Anything v0.3.0 Deep mode via MCP, Edge Chromium runtime. The owner Windows device was reconnected and inspected during this research.

## Evidence location and disclosure
The files were created by OpenCode/Craft Anything on the owner-authorized Windows worktree:
`D:\Ninerr-EGM-Plan\.local-evidence\rea-2026-11-06\<target>-1440-768-390\`

The `.local-evidence/` directory is gitignored. Only metadata, hashes and findings are committed here. The captures consist of one `capture.json`, one README/summary, three responsive screenshots (nominal widths 1440, 768, 390 CSS px), and one additional generated artifact per target. The committed hashes are of the raw `capture.json` local files, not the screenshots or target binaries. These can be used for on-device evidence reproducibility; they do not license redistribution of third-party imagery.

## Verified completed captures
| Public website | Evidence directory | File count | PNG viewports | `capture.json` SHA-256 |
|---|---|---:|---:|---|
| https://stacki.build/ | `stacki-1440-768-390` | 6 | 3 | `3fd271b9c5da728bb5bdecdee84d59cec4f2aa3c3a5868bae06814e9130fe5d` |
| https://paper.design/ | `paper-1440-768-390` | 6 | 3 | `56f3d16072851f2d002bb229ef0b7850b2da4867057917c1886a113f01091699` |
| https://www.pen.dev/ | `pendev-1440-768-390` | 6 | 3 | `c2b674c9c7fd892acfb8d7bee0a67d7122f8ec3b10c9ef305bf1daa3757f856` |
| https://www.framer.com/ | `framer-1440-768-390` | 6 | 3 | `2f331d3c54e0a8c7ec8b686fa83b3d3b7fc700cf1111caae3aae347b743ee2bf` |
| https://www.figma.com/ | `figma-1440-768-390` | 6 | 3 | `62c28bfc3620470f11b46f9b19e480ccaeb5af35e5d90fc3fd91ed07783002c8` |
| https://penpot.app/ | `penpot-1440-768-390` | 6 | 3 | `43cf8f31a782c20f2e0e88ae1a3552a5db5e430c644b096853aeafd4c89d67c4` |
| https://www.sketch.com/ | `sketch-1440-768-390` | 6 | 3 | `b0ec24c2fb0d0130852dfdb1742a985d15cc2ee8452f63c85d50a034ca29accb` |
| https://www.canva.com/ | `canva-1440-768-390` | 6 | 3 | `b6226f3a648cc5787ad7bd9947bd4b4185bba25aaade17f466595841c2c0401` |

All eight entries were enumerated from the real local artifact folders on 2026-11-06; the file contents and functional editor interactions were **not independently evaluated** in this ledger. A ninth `webflow-1440-768-390` folder existed with **zero files** at inspection; it is NOT counted as a completed capture. Asset rights, sessions, authentication constraints and website versions remain separate qualification items.

## OpenCode live agent and research gates
At the time this ledger was collected, the OpenCode+DeepSeek build agent was actively using the Craft Anything MCP and had invoked `web_site_open` and `web_site_capture` on the listed public websites. The log had not yet demonstrated a completed written `FINDINGS.md`, `COMPETITOR_MATRIX.md` or final competitor benchmark. Do not infer implementation knowledge or product competitiveness from the mere existence of a screenshot.

The practical next steps are: read generated `capture.json` and README, classify content with OBSERVED_TOOL vs OFFICIAL_DOC, run same-task Ninerr baseline screenshots/DOM structures, qualify actual logged-in editor workflows only when authorized accounts/test projects exist, record negative controls, and publish a matrix with explicitly unsupported or unknown features. That matrix can then justify scope and implementation task ranking.

## Safety
No login bypass, DRM removal or account data extraction is reported here. Large third-party screenshots and raw HTML are kept off the public repo. The user's declared permission must still be reconciled with asset-specific redistribution rights before upstream assets are bundled in Ninerr.
