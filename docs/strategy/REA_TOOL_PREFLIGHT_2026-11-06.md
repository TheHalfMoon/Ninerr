# Ninerr REA toolchain preflight: verified and blocked
Date: 2026-11-06
Status: reproducible tool installation and configuration evidence, **not competitor REA completion**
Related Ninerr PR: #363; Skilit migration inventory: TheHalfMoon/Skilit#189

## Windows host
- Device: owner-authorized Windows host 'Abdulaziz' over Desktop Commander; Windows PowerShell.
- `opencode.cmd --version` => `opencode v2.2.5`.
- `opencode.cmd models` initially emitted `ServiceUnavailableError: Location plugins did not finish activating`; later returned an enumerated provider/model list. Model listing working does **not** prove an inference request succeeds.
- Attempted `opencode run --standalone` with read-only inspection request; no agent answer or report appeared. Another read-only preflight with explicitly free model `opencode/deepseek-v4.1-flash-free` likewise produced no result. Debug logs from a separate small test reached the `serve --stdio --port 0` startup step and emitted no completion. A subsequent preflight without `--standalone` also produced no result. The tool sessions were terminated; do not claim OpenCode completed REA.
- Do not expose OpenCode credentials, provider configuration or private user files in research reports. Do not silently substitute metered models.

## Craft Anything
- Upstream: https://github.com/storytold/craft-anything
- Pinned version: `v0.3.0`, official portable Windows x64 ZIP.
- Upstream release URL: https://github.com/storytold/craft-anything/releases/tag/v0.3.0
- Release asset: `craft-anything-0.3.0-windows-x64-portable.zip`; size 65,779,321 bytes.
- Publisher release SHA256 expected: `cf60e403c7eb33d51b8dd167335e79d031e516c39cac4a58c97fa70ef81ed6d8`.
- On-device SHA256 observed: `CF60E403C7EB33D51B8DD167335E79D031E516C39CAC4A58C97FA70EF81ED6D8`. Matches ignoring case.
- Portable CLI path: `D:\Ninerr-Tools\CraftAnything-0.3.0\unpacked\craft-anything-0.3.0-windows-x64-portable\craft-anything-cli.exe`.
- Tool `doctor`: `healthy: true`; `binary: ok`, Chromium/Edge available, MCP self-test `ok` with protocol `2025-06-18` and 29 tools listed. Note this does not establish that all advertised engine tools work on Figma/Adobe.
- Before setup `registration:opencode` said not connected; `setup --client opencode --dry-run` previewed one MCP configuration update and new skill documents; applied via `setup --client opencode --yes`. Subsequent doctor verified `registration:opencode: ok`.
- Setup backup: `C:\Users\Shehr\.config\opencode\opencode.jsonc.craft-anything.backup`; only Craft Anything's OpenCode integration was configured, not all detected clients. No unrestricted run permission was enabled.
- `doctor` notes no Craft Anything AI backend configured; only deterministic CLI and MCP self-test are qualified.
- Removed the downloaded portable ZIP after verification and extraction to avoid keeping an unnecessary duplicate.

## Blocker and next qualification
OpenCode's request/agent response must work on an explicitly free/entitled provider before claiming an OpenCode-led deep study. Diagnose plugin-service startup without deleting existing authentication/configuration; verify with a one-turn read-only response. The Figma/Adobe app experiments also require permitted user-owned sample project/session access and have **not** been executed. Until then, 2026-11-06 competitor findings are primary-document-based reconnaissance, not observed product parity.

## No unverified completion claims
No repository implementation, Skilit port, Figma or Adobe live app test, Craft Anything target examination, screenshot comparison, 24-task benchmark, model inference, release or deploy was completed in this preflight.
