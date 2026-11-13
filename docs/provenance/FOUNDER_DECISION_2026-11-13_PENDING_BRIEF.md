# Founder decision: the pending brief is taken as written (2026-11-13)

**Decision.** On 2026-11-13 the founder answered `docs/provenance/FOUNDER_DECISIONS_PENDING_2026-11-13.md` with "Take the brief as written": each decision takes the brief's recommendation. Decision 3 (#349) was taken earlier the same day, by approving #456.

| # | Decision | Taken |
| --- | --- | --- |
| 1 | Responsive breakpoints | ADR-0008 is accepted as written, and built after 1.0 unless a dogfooded page needs it sooner. Imported pages' own `@media` rules keep drawing as they do. |
| 2 | PDF export | No PDF in 1.0; PNG and SVG copy to the clipboard (#439). After 1.0, a host route writes export files into the project's own folder. |
| 3 | #349 | Renamed through the handle (#456, merged; #349 closed). |
| 4 | Host network access | None in 1.0: registry items come only from files the person chooses, and the offline guarantee (P10-4) holds. After 1.0, fetching goes through the existing network policy. |
| 5 | A live React preview runner | None in 1.0: previews stay the static rendering the canvas draws. |
| 6 | Electron's LGPL corresponding source | A written offer under LGPL-2.1 §6, in the project owner's name, recorded in `THIRD_PARTY_NOTICES.md` and shipped with each desktop package (#457). Its owner details are filled in by the owner. |
| 7 | Aceternity UI and 21st.dev | Left out of 1.0. |
| 8 | Parity dispositions (P10-5) | #79's remainder is covered: aliases give semantic tiers, and drift against CSS custom properties is built (#452); a Tailwind config is JavaScript and would need running code. #78 is superseded by ADR-0005's component properties (variants bound to classes). |
| 9 | The candidate | Named by the founder when ready; engineering then runs P10 on it. |

**What changes.** ADR-0008's status is accepted. The completion ledger's scope rows and blockers record these; #78 and #79 close as dispositioned; #405 stays open for its post-1.0 parts. Nothing in 1.0 fetches, runs third-party code, or writes exported files outside the clipboard.
