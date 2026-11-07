# Framer authenticated editor access gate — 2026-11-07

**Context:** Follow-up to Ninerr [Framer Deep Craft Anything REA](./FRAMER_DEEP_CRAFT_ANYTHING_REA_2026-11-07.md). This is an **access check, not an editor benchmark**.

## Attempts and observed results

1. **Owner Windows computer:** Desktop Commander was online. Read-only process inspection found no Chrome/Edge/Opera/Firefox browser with an active top-level window and no local CDP listener on selected known debugging ports. The Opera Browser Connector separately returned **"Browser not connected"**; no browser automation session could be attached through that connector. This does **not** prove no Framer account exists or that all saved browser profiles are logged out.
2. **Owner macOS computer:** Safari was available. A read-only navigation to the official Framer dashboard entry `https://framer.com/projects/` redirected to `https://framer.com/login/?origin=framer-web&redirect=https%3A%2F%2Fframer.com%2Fprojects%2F`, with window title **"Login – Framer"**. Thus, no authenticated project/editor was available in that Safari session at check time.
3. **Desktop app discovery:** Neither a Windows Start Menu Framer app nor Framer.exe in three common Windows install paths was found; `/Applications/Framer.app` was absent on the macOS machine. These are bounded checks, **not** exhaustive app installation inventories.
4. No passwords, cookies, authentication tokens, sensitive project content or paid seats were accessed or modified. No projects were created, opened or published.

## Decision

- The public-site Deep Craft Anything pass (5 public pages, 15 responsive PNGs and local Craft Anything evidence ledger) **remains complete** with the scope limitations already recorded.
- **Authenticated Framer editor Craft Anything: BLOCKED (login required / no connected authenticated browser).**
- **No functional Framer ↔ Ninerr parity or private editor source-code claims are authorized by this access check.**

## Safe resumption gate

The owner can **sign into Framer on the open macOS Safari tab** and provide an owned, non-production test project, or enable Opera's **Allow AI connection** for a browser with an already authenticated Framer project. Do not share passwords or tokens in chat. Once the authenticated test project is accessible, run the existing 12-task benchmark with passive screen/DOM captures first, then only separately owner-authorized changes to the test project. Keep raw third-party captures untracked and preserve its project identity without copying private content unnecessarily.

Public entry: https://framer.com/projects/
Official project-link instructions: https://www.framer.com/help/articles/how-can-i-get-the-project-link/

**Verdict:** Honest blocked gate, not a failed technical implementation or a complete editor REA.
