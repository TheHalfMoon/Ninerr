import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UI_COMPONENT_SOURCES,
  UI_COMPONENT_SOURCE_GROUPS,
  UI_IMPORT_POLICIES,
  searchUiComponentSources,
} from "../packages/component-sources/src/catalog.mjs";

test("all twelve requested UI ecosystems, two same-name alternatives and Astryx have stable unique IDs", () => {
  assert.equal(UI_COMPONENT_SOURCES.length, 15);
  assert.equal(new Set(UI_COMPONENT_SOURCES.map(({ id }) => id)).size, 15);
  assert.deepEqual(new Set(UI_COMPONENT_SOURCES.map(({ group }) => group)),
    new Set(["Foundation", "Specialist", "Gallery", "Marketplace"]));
  assert.equal(UI_COMPONENT_SOURCE_GROUPS[0], "All");
});

test("curated source entries have explicit, safe manual reuse gates", () => {
  for (const item of UI_COMPONENT_SOURCES) {
    assert.match(item.website, /^https:\/\//);
    assert.match(item.source, /^https:\/\//);
    assert.ok(item.usage.length > 20);
    assert.ok(item.rights.length > 15);
    assert.match(item.gate, /^(manual-install|manual-source-review|per-item-review)$/);
    assert.equal(Object.isFrozen(item), true);
  }
  const rare = UI_COMPONENT_SOURCES.find(({ id }) => id === "rareui");
  const beautiful = UI_COMPONENT_SOURCES.find(({ id }) => id === "beautiful-ui");
  assert.equal(rare.website, "https://rareui.in");
  assert.equal(beautiful.website, "https://www.beautifului.dev");
  assert.equal(Object.isFrozen(UI_COMPONENT_SOURCES), true);
});

test("each source states its license and what Ninerr may import from it", () => {
  const policy = Object.fromEntries(UI_COMPONENT_SOURCES.map(({ id, importPolicy }) => [id, importPolicy]));
  for (const item of UI_COMPONENT_SOURCES) {
    assert.ok(UI_IMPORT_POLICIES.includes(item.importPolicy), `${item.id} has a known import policy`);
    assert.equal(typeof item.license, "string");
    // A registry is named only where items may be imported, and only over HTTPS.
    if (item.registry !== null) {
      assert.match(item.registry, /^https:\/\/[^/]+\/.*\{name\}\.json$/u, `${item.id} registry pattern`);
      assert.notEqual(item.importPolicy, "permission-required", `${item.id} names no registry Ninerr may not use`);
    }
  }
  // Terms that grant nothing: nothing is imported without the publisher's permission.
  assert.equal(policy.aceternity, "permission-required");
  assert.equal(policy["21st"], "permission-required");
  // Commons Clause and an attribution condition; free items only for Notchset.
  assert.equal(policy["rareui-swami"], "allowed-with-attribution");
  assert.equal(policy["beautiful-ui-notchset"], "free-items-only");
  for (const id of ["shadcn", "base-ui", "radix-ui", "astryx", "sonner", "vaul", "cmdk", "numberflow", "beautiful-ui", "rareui", "magic-ui"]) {
    assert.equal(policy[id], "allowed", id);
    assert.equal(UI_COMPONENT_SOURCES.find((item) => item.id === id).license, "MIT", id);
  }
});

test("search is local, case-insensitive, bounded and supports group filtering", () => {
  assert.equal(searchUiComponentSources({ query: "TOAST" })[0].id, "sonner");
  assert.deepEqual(searchUiComponentSources({ group: "Specialist" }).map(({ id }) => id),
    ["sonner", "vaul", "cmdk", "numberflow"]);
  assert.equal(searchUiComponentSources({ query: "  AI interfaces " })[0].id, "beautiful-ui");
  assert.deepEqual(searchUiComponentSources({ query: "no-such-library" }), []);
  assert.throws(() => searchUiComponentSources({ query: "x".repeat(201) }), TypeError);
  assert.throws(() => searchUiComponentSources({ query: null }), TypeError);
  assert.throws(() => searchUiComponentSources({ group: "Unknown" }), TypeError);
});
