# Founder decision: document schema v2, 2026-11-09

On 2026-11-09 the founder approved document schema v2, so that design tokens, components, instances and variants can be built (#405).

The question asked, after the component-source work in #404, #406 and #407 had merged:

```text
Approve document schema v2 (ADR-0003 to 0005) so tokens and variants can start?
```

The founder's answer, verbatim:

```text
Approve schema v2
```

## What it approves
- **ADR-0003:** schema v2 adds the `design-system` and `component-instance` node types, gives `component-definition` its props, and upgrades a project lazily. A project stays v1, and older builds keep opening it, until its first v2 node.
- **ADR-0004:** tokens, collections and modes are props of the one `design-system` node. A style binds a token by holding `var(--name)`. An alias cycle is refused with an error that names it. A token in use is never deleted into a dangling reference.
- **ADR-0005:** an instance stores only its component, property values and overrides. The renderer expands it when drawing, and nothing expanded is stored.

## What it does not approve
- The rest of the design-platform plan: P11, P12, P15 and P16, ADR-0001, 0002, 0006 and 0007, and PR #359.
- Any network access.
- A live React preview runner.
- Importing from Aceternity UI or 21st.dev.

Each of these still needs its own decision. The approved ADRs are built in small grains, each with exact-head CI, review and Jev qualification.
