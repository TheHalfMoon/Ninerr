# ADR-0004: Tokens live on the `design-system` node; a binding is a `var()` value

- **Status:** proposed, 2026-10-18.
- **Context:**
  - Tokens are typed CSS custom properties with aliases in one studied product (E-PD-10).
  - Variables have collections and modes in another (E-FG-02).
  - Claude Design builds design systems with tokens from code and design files (E-CD-09).
  - Observed in Figma: type mismatches are refused, an alias cycle is ignored with no error, and deleting a variable in use leaves a dangling alias (E-FG-14).
- **Decision:**
  - Tokens, collections and modes are props of the one `design-system` node, edited by `set-props`, so they are undoable and attributed.
  - A node's style binds a token by holding `var(--name)`.
  - The renderer compiles tokens to custom properties per mode. The compiled CSS is never stored.
- **Consequences:**
  - A rename or delete is one transaction across the token and its uses. A delete asks what replaces the token's uses; it never leaves a dangling reference.
  - An alias cycle is refused with an error that names it.
  - Code export writes the compiled CSS.
  - Search finds a token's uses by scanning style values, indexed in the host.
