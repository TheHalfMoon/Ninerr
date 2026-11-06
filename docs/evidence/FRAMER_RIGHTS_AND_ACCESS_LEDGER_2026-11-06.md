# Framer copying authorization and actual source access ledger
Observation date: 2026-11-06. This is an engineering provenance record, not an independent legal opinion.

## Founder declaration
The project founder explicitly reports a direct legal permission from Framer to copy, adapt, modify, rebrand and integrate Framer materials into Ninerr, including permissions that might differ from public license. This direction authorizes engineering consideration of sources that are actually delivered/accessible under that grant. It does not, by itself, deliver the private source archive or prove third-party copyright scope, mandatory notices, transferable sublicensing rights, or access to private user data. The plan must not mark unseen grant terms as independently verified.

## Source-specific record

| Target | Code availability observed | Rights evidence | Copy/read status | Release guard |
|---|---|---|---|---|
| Motion core (motiondivision/motion) | Public source pinned to 78f3ff51..., source paths/manifest inspected | MIT LICENSE.md copyright Motion B.V. 2024 | Eligible for reuse with notices, independent tests and package/license checks | Preserve copyright and full license text; check included asset/dependency rights |
| Framer plugins | Public source pinned to df96c6d0..., 32 sample folders | Repo reports MIT | Eligible to study and selectively adapt; verify copied folders/assets | Keep third-party notices; no web accounts required for Ninerr core |
| Framer agent-plugins | Public MIT integration descriptors, pinned 2fb4aa5... | Public MIT LICENSE | Study client configuration; do not substitute its remote server for Ninerr local MCP | No hosted Framer endpoint as default, no private MCP credentials |
| Framer fixfont | Public MIT source at 0e66a79... | MIT | Font QA candidate only, not core editor | Keep license and provenance, test file safety |
| Framer server-api-examples | Public code at 383b4585..., no clear repo metadata license | Founder-reported broad Framer grant but no particular text attached | Research Framer remote API contracts and optional exports | Do not assert general MIT license or introduce hosted runtime |
| Framer plugin-oauth | Public code at d6d59e5..., license not declared in metadata | Founder grant asserted; exact grant copy not present | Research only until document scope and dependencies checked | External OAuth/Cloudflare service is not an offline Ninerr requirement |
| Framer editor internal Canvas/CMS runtime and private source | NO private repo/archive provided or found in public source census | Founder grant asserted, exact source delivery and third-party grants not attached | Source-specific copy cannot be executed before legitimate source delivery | Pin archive SHA, ownership/grant scope, dependency audit, third-party asset rights and notices before integration/release |
| Framer public website and Marketplace content | Public viewing only; no private code | Website viewing is not proof of copying rights for each listing/template | Read public docs/capture for research, no private access bypass | Marketplace items may be separately owned; do not bundle without rights |
| Framer forks (14) | Public code under framer/* forks | Own upstream license (Apache/GPL/MPL/MIT etc), Framer grants may not cover third-party code | Treat separately from original Framer-authored code | Preserve upstream requirements, no presumed license override |

## Minimum grant/delivery intake for private Framer source
For an authorized archive/private repository, record: exact source owner and edition, delivery URL/archive hash/commit, permitted acts (copy/modify/redistribute/rebrand), allowed uses and geographic/time restrictions if any, trademark and assets scope, sublicensing and export terms, third-party dependencies with independent conditions, mandatory acknowledgements, confidentiality and transfer protections. Inspect *only* source delivered under the actor's actual access. Do not bypass MFA, login, access controls, license verification, DRM or backend security.

## Technical privacy policy for Ninerr
Ninerr stays a Windows/macOS/Linux installed, locally persistent design product with optional user-owned inference and a local authenticated MCP server. Never migrate Framer-hosted customer projects or private account data, introduce mandatory Framer OAuth, or republish Framer-hosted media without explicit source/object access and redistribution rights. Keep original third-party raw screenshots/dumps off public PRs.

## Current decision
Proceed with well-sourced public Motion and official plugin research and compatible local API implementations. Do not claim the complete proprietary editor was obtained, copied, ported or licensed for public redistribution. Mark missing exact grant attachments as release-evidence gaps rather than asking again before routine R&D.
