import test from "node:test";
import assert from "node:assert/strict";

import { createDocument } from "../packages/document-model/src/index.mjs";
import { tokenDrift } from "../packages/studio-host/src/token-drift.ts";

// The comparison behind token drift (#79), for the shapes a design system takes: each token in
// its own collection and modes, nothing invented on either side, spelling that draws the same.

const withSystem = (collections, tokens) => createDocument({ id: "d", nodes: [{ id: "system", type: "design-system", props: { name: "DS", collections, tokens } }] });
const statusOf = (drift, name) => drift.tokens.find((token) => token.name === name);

test("a token in a second collection is compared in that collection's own default and Dark modes", () => {
  const doc = withSystem([
    { id: "base", name: "Base", modes: [{ id: "default", name: "Default" }, { id: "dark", name: "Dark" }], defaultMode: "default" },
    { id: "brand", name: "Brand", modes: [{ id: "light", name: "Light" }, { id: "night", name: "Dark" }], defaultMode: "light" },
  ], [{ name: "--accent", type: "color", collection: "brand", values: { light: "#ffffff", night: "#000000" } }]);
  assert.deepEqual(statusOf(tokenDrift(doc, ":root { --accent: #ffffff; } .dark { --accent: #000000; }", "a.css"), "--accent"), { name: "--accent", status: "same", design: { light: "#ffffff", night: "#000000" }, code: { light: "#ffffff", night: "#000000" } });
  assert.equal(statusOf(tokenDrift(doc, ":root { --accent: #123456; }", "a.css"), "--accent").status, "changed", "a value that differs is not hidden by the modes");
  assert.equal(statusOf(tokenDrift(doc, ":root { --accent: #ffffff; } .dark { --accent: #111111; }", "a.css"), "--accent").status, "changed", "a dark value that differs");
});

test("nothing is invented: a dark-only value is compared as dark, and a collection with no Dark mode says so", () => {
  const doc = withSystem([{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }, { id: "dark", name: "Dark" }], defaultMode: "default" }], [{ name: "--bg", type: "color", collection: "base", values: { default: "#ffffff", dark: "#000000" } }]);
  assert.deepEqual(statusOf(tokenDrift(doc, ".dark { --bg: #000000; }", "a.css"), "--bg"), { name: "--bg", status: "same", design: { default: "#ffffff", dark: "#000000" }, code: { dark: "#000000" } });
  const single = withSystem([{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }], defaultMode: "default" }], [{ name: "--bg", type: "color", collection: "base", values: { default: "#ffffff" } }]);
  assert.deepEqual(statusOf(tokenDrift(single, ":root { --bg: #ffffff; } .dark { --bg: #000; }", "a.css"), "--bg").reason, "the code sets a dark value, and the token's collection has no Dark mode");
});

test("a design system whose default mode is Dark is compared, not refused", () => {
  const doc = withSystem([{ id: "base", name: "Base", modes: [{ id: "dark", name: "Dark" }, { id: "light", name: "Light" }], defaultMode: "dark" }], [{ name: "--bg", type: "color", collection: "base", values: { dark: "#000000" } }]);
  assert.equal(statusOf(tokenDrift(doc, ":root { --bg: #000000; }", "a.css"), "--bg").status, "same");
});

test("spelling that draws the same is the same; an alias that differs says it is one", () => {
  const doc = withSystem([{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }], defaultMode: "default" }], [
    { name: "--fg", type: "color", collection: "base", values: { default: "#FFF" } },
    { name: "--shadow", type: "shadow", collection: "base", values: { default: "0 1px 2px rgba(0,0,0,.2)" } },
    { name: "--link", type: "color", collection: "base", values: { default: "var(--fg)" } },
  ]);
  const drift = tokenDrift(doc, ":root { --fg: #fff; --shadow: 0  1px 2px rgba( 0 , 0 , 0 , .2 ); --link: #ffffff; }", "a.css");
  assert.deepEqual([statusOf(drift, "--fg").status, statusOf(drift, "--shadow").status], ["same", "same"]);
  assert.deepEqual([statusOf(drift, "--link").status, statusOf(drift, "--link").reason], ["changed", "the design system's value is an alias of another token"]);
});

test("with no design system, every token in the file is only in the code", () => {
  const drift = tokenDrift(createDocument({ id: "d", nodes: [] }), ":root { --a: 1px; } .dark { --a: 2px; --b: red; }", "a.css");
  assert.deepEqual(drift.tokens, [{ name: "--a", status: "only-in-code", code: { default: "1px", dark: "2px" } }, { name: "--b", status: "only-in-code", code: { dark: "red" } }]);
  assert.equal(drift.drift, true);
});
