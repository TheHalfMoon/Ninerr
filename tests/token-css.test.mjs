import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TOKEN_CSS_LIMITS, TokenCssError, tokensFromCss } from "../packages/component-sources/src/tokens-css.mjs";
import { tokenTypeOf } from "../packages/studio-host/src/component-import.ts";
import { hostPool, ok } from "./support/host-api.mjs";

// Design tokens from a CSS file a person chooses (#405, Astryx milestone D): Astryx's token rules,
// verbatim in the fixture, become Ninerr tokens with light and dark modes; what Ninerr has no
// token type for stays Astryx's CSS.

const ASTRYX_CSS = readFileSync(new URL("./fixtures/astryx/astryx-tokens.css", import.meta.url), "utf8");

test("Astryx's token CSS: light-dark() splits into light and dark, motion and sizes stay native", () => {
  const read = tokensFromCss(ASTRYX_CSS);
  assert.equal(read.source, "astryx");
  assert.deepEqual([Object.keys(read.theme).length, Object.keys(read.light).length, Object.keys(read.dark).length, read.kept.length], [105, 142, 142, 22]);
  assert.deepEqual([read.light["color-accent"], read.dark["color-accent"]], ["#0064E0", "#0171E3"]);
  // light-dark() inside a longer value: each mode takes its own argument, every time it appears.
  assert.equal(read.light["shadow-med"], "0px 1px 2px rgba(0, 0, 0, 0.1), 0px 2px 12px rgba(0, 0, 0, 0.1)");
  assert.equal(read.dark["shadow-med"], "0px 1px 2px rgba(0, 0, 0, 0.2), 0px 2px 12px rgba(0, 0, 0, 0.2)");
  assert.equal(read.theme["text-body-size"], "var(--font-size-base)");
  assert.equal(read.theme["font-family-body"], "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif");
  const kept = Object.fromEntries(read.kept.map((entry) => [entry.name, entry.reason]));
  assert.match(kept["--duration-fast"], /no motion token type/u);
  assert.match(kept["--ease-standard"], /no motion token type/u);
  assert.match(kept["--size-element-md"], /no size token type/u);
  assert.match(kept["--border-width"], /no border token type/u);
  assert.match(kept["--_chat-avatar-offset"], /private/u);
  assert.equal(read.skipped, 2, "rules for other selectors are not tokens");
});

test("dark-scheme rules, comments, strings and !important are read as CSS reads them", () => {
  const read = tokensFromCss(`
    /* :root { --commented: red; } */
    :root { --brand: #2255ff; --label: "a;b{c}"; --gap: 8px !important; }
    .dark { --brand: #99bbff; }
    @media (prefers-color-scheme: dark) { :root { --surface: #111; } }
    @media (min-width: 900px) { :root { --gap: 16px; } }
    .card { --card-pad: 4px; }
    :root[data-theme="dark"] { --label: "dark"; }
  `);
  assert.deepEqual(read.theme, { brand: "#2255ff", label: "\"a;b{c}\"", gap: "8px" });
  assert.deepEqual(read.dark, { brand: "#99bbff", surface: "#111", label: "\"dark\"" });
  assert.deepEqual(read.light, {});
  assert.equal(read.skipped, 2, "a responsive :root and a class are not the page's tokens");
  assert.equal(read.source, null);
  // Nested functions inside light-dark() stay whole.
  const nested = tokensFromCss(":root { --x: light-dark(rgb(0 0 0 / 0.1), color-mix(in srgb, red, blue)); }");
  assert.deepEqual([nested.light.x, nested.dark.x], ["rgb(0 0 0 / 0.1)", "color-mix(in srgb, red, blue)"]);
});

test("CSS that cannot be read is refused, saying why", () => {
  assert.throws(() => tokensFromCss(":root { --x: light-dark(red); }"), /light-dark\(\) takes two values/u);
  assert.throws(() => tokensFromCss(":root { --x: red;"), /unclosed block/u);
  assert.throws(() => tokensFromCss("}"), /closing brace/u);
  assert.throws(() => tokensFromCss(null), TokenCssError);
  assert.throws(() => tokensFromCss(" ".repeat(TOKEN_CSS_LIMITS.bytes + 1)), /larger than/u);
  const many = `:root { ${Array.from({ length: TOKEN_CSS_LIMITS.properties + 1 }, (_, index) => `--t${index}: 1px;`).join(" ")} }`;
  assert.throws(() => tokensFromCss(many), /more than 5000 custom properties/u);
});

test("token types follow the name: sizes, weights and line heights are their own types", () => {
  const cases = {
    "color-accent": "color", "spacing-4": "spacing", "radius-element": "radius", "shadow-med": "shadow",
    "font-family-body": "fontFamily", "font-sans": "fontFamily", "font-size-base": "fontSize", "text-body-size": "fontSize",
    "font-weight-bold": "fontWeight", "text-heading-1-weight": "fontWeight", "text-body-leading": "lineHeight", "line-height-tight": "lineHeight",
    "letter-spacing-wide": "letterSpacing", "tracking-tight": "letterSpacing", "opacity-muted": "opacity", "breakpoint-md": "breakpoint",
  };
  for (const [name, type] of Object.entries(cases)) assert.equal(tokenTypeOf(name), type, name);
});

async function setup(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-token-css-")));
  const pool = hostPool(() => "2026-11-10T12:00:00.000Z");
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "projects"));
  const { call } = await pool.open(join(root, "projects"));
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  const documentNow = async () => (await ok(call("GET", "/api/document"), "document")).document;
  return { call, documentNow };
}

test("the person reviews Astryx's tokens, adds them in one undoable change, and a stale review is refused", async (t) => {
  const { call, documentNow } = await setup(t);
  const request = { css: ASTRYX_CSS, fileName: "astryx.css" };
  const plan = await ok(call("POST", "/api/tokens/css/plan", request), "plan");
  assert.deepEqual([plan.source, plan.fileName, plan.adds, plan.problem, plan.kept.length], ["astryx", "astryx.css", 247, null, 22]);
  assert.equal((await documentNow()).revision, 0, "a review changes nothing");
  const applied = await ok(call("POST", "/api/tokens/css/apply", { ...request, token: plan.token }), "apply");
  assert.equal(applied.added, 247);
  const document = await documentNow();
  assert.equal(document.revision, 1, "one transaction");
  const system = Object.values(document.nodes).find((node) => node.type === "design-system");
  const token = (name) => system.props.tokens.find((entry) => entry.name === name);
  assert.deepEqual(token("--color-accent").values, { default: "#0064E0", dark: "#0171E3" });
  assert.deepEqual([token("--text-body-size").type, token("--font-weight-bold").type, token("--text-body-leading").type], ["fontSize", "fontWeight", "lineHeight"]);
  assert.equal(token("--duration-fast"), undefined, "a duration stays Astryx's CSS");
  assert.ok(system.props.collections[0].modes.some((mode) => mode.id === "dark"));
  // The same review cannot be applied twice, and a new review finds every token already there.
  const again = await call("POST", "/api/tokens/css/apply", { ...request, token: plan.token });
  assert.equal(again.status, 409);
  const second = await ok(call("POST", "/api/tokens/css/plan", request), "second plan");
  assert.equal(second.adds, 0);
  assert.ok(second.tokens.every((entry) => entry.status === "same"));
  const none = await call("POST", "/api/tokens/css/apply", { ...request, token: second.token });
  assert.equal(none.status, 422);
  // Undo takes all of them back.
  await ok(call("POST", "/api/undo", { baseRevision: 1 }), "undo");
  assert.equal(Object.values((await documentNow()).nodes).some((node) => node.type === "design-system"), false);
});

test("a token already there with another value is kept; unreadable CSS and a forged review are refused", async (t) => {
  const { call } = await setup(t);
  const first = { css: ":root { --brand: #2255ff; }", fileName: "mine.css" };
  const plan = await ok(call("POST", "/api/tokens/css/plan", first), "plan");
  await ok(call("POST", "/api/tokens/css/apply", { ...first, token: plan.token }), "apply");
  const other = await ok(call("POST", "/api/tokens/css/plan", { css: ":root { --brand: light-dark(#000, #fff); --ink: #111; }" }), "other");
  assert.deepEqual(other.tokens.map((entry) => [entry.name, entry.status]).sort(), [["--brand", "conflict"], ["--ink", "new"]]);
  assert.equal(other.adds, 1);
  assert.equal((await call("POST", "/api/tokens/css/plan", { css: ":root { --x: red;" })).status, 422);
  assert.equal((await call("POST", "/api/tokens/css/plan", { css: 7 })).status, 400);
  assert.equal((await call("POST", "/api/tokens/css/apply", { css: ":root { --ink: #111; }", token: "0".repeat(64) })).status, 409);
});
